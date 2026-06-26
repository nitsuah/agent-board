import {
  classifyInput, buildSystemMessages, sanitizeResponse,
  applyOutputControls, normalizePromptText, resolveEffectiveSafetyMode,
} from '../safety.js';
import { ensureToolReady, experienceToolKey } from '../modules/tool-lifecycle.js';

export async function handleSessionMessage(req, res, {
  sessions, eventBus, logStructured,
  LLM_CONFIG, MAX_OUTPUT_CHARS,
  runPromptHandlers, prepareSessionForLlmCall,
  getExperienceTools, runAgentLoop,
  upsertSessionContext, activeDockerRunnerModelRef,
  TOOL_SERVERS, serviceRegistry, dockerControlEnabled, runComposeAction,
}) {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

  const { message, useSafeMode = false } = req.body;
  if (!message) return res.status(400).json({ success: false, error: 'Message is required' });
  if (typeof useSafeMode !== 'boolean') return res.status(400).json({ success: false, error: 'useSafeMode must be a boolean' });

  if (session.useSafeModeEnabled !== useSafeMode) {
    session.useSafeModeEnabled = useSafeMode;
    eventBus.emit('safe_mode_toggled', {
      session_id: session.id, user_id: session.userId,
      model: session.model, endpoint: session.endpoint, experience: session.experience,
      metadata: { enabled: useSafeMode },
    });
  }

  const safetyMode = resolveEffectiveSafetyMode(session, useSafeMode);
  const handlerResult = await runPromptHandlers(message, session, safetyMode);

  if (handlerResult.handled) {
    session.messages.push({ role: 'user', content: normalizePromptText(message), timestamp: new Date() });
    session.messages.push({ role: 'assistant', content: handlerResult.response, timestamp: new Date(), blocked: handlerResult.blocked });
    session.updatedAt = new Date();
    upsertSessionContext(session, logStructured);
    eventBus.emit('prompt_handler_invoked', {
      session_id: session.id, user_id: session.userId,
      model: session.model, endpoint: session.endpoint, experience: session.experience,
      metadata: { reason: handlerResult.classification?.reason || null, blocked: handlerResult.blocked },
    });
    return res.json({
      success: true, response: handlerResult.response,
      classification: handlerResult.classification || { category: 'safe', reason: null },
      blocked: handlerResult.blocked,
      endpoint: useSafeMode ? `${session.endpoint} (safe)` : session.endpoint,
      messageCount: session.messages.length,
    });
  }

  const normalizedMessage = handlerResult.message || normalizePromptText(message);
  const classification = classifyInput(normalizedMessage);

  eventBus.emit('input_classified', {
    session_id: session.id, user_id: session.userId,
    model: session.model, endpoint: session.endpoint, experience: session.experience,
    metadata: { category: classification.category, reason: classification.reason },
  });

  if (classification.category === 'blocked') {
    eventBus.emit('input_blocked', {
      session_id: session.id, user_id: session.userId,
      model: session.model, endpoint: session.endpoint, experience: session.experience,
      metadata: { reason: classification.reason },
    });
    const refusal = "I'm not able to help with that. If you have a genuine question, please rephrase it and I'll do my best to assist.";
    session.messages.push({ role: 'user', content: normalizedMessage, timestamp: new Date() });
    session.messages.push({ role: 'assistant', content: refusal, timestamp: new Date(), blocked: true });
    session.updatedAt = new Date();
    upsertSessionContext(session, logStructured);
    return res.json({ success: true, response: refusal, classification, blocked: true, endpoint: session.endpoint, messageCount: session.messages.length });
  }

  session.messages.push({ role: 'user', content: normalizedMessage, timestamp: new Date() });
  upsertSessionContext(session, logStructured);

  eventBus.emit('message_sent', {
    session_id: session.id, user_id: session.userId,
    model: session.model, endpoint: session.endpoint, experience: session.experience,
    metadata: { classification: classification.category, messageLength: normalizedMessage.length },
  });

  // JIT tool lifecycle: auto-start MCP tool server if the experience requires one
  const requiredTool = experienceToolKey(session.experience, TOOL_SERVERS || {});
  if (requiredTool && TOOL_SERVERS) {
    const lifecycle = await ensureToolReady(requiredTool, TOOL_SERVERS, serviceRegistry, dockerControlEnabled, runComposeAction, logStructured);
    if (!lifecycle.ready) {
      return res.status(503).json({ success: false, error: lifecycle.error || `Tool server for ${session.experience} is unavailable` });
    }
    if (lifecycle.started) {
      eventBus.emit('tool_lifecycle_started', { toolKey: requiredTool, sessionId: session.id });
    }
  }

  const msgStart = Date.now();
  session.status = 'running';
  session.lastActivity = new Date();

  try {
    const prepared = await prepareSessionForLlmCall(session);
    if (LLM_CONFIG[session.endpoint]?.backendType === 'docker-runner') {
      activeDockerRunnerModelRef.current = { key: session.endpoint, model: session.model, at: new Date() };
    }
    const { llmUrl, apiStyle, apiKey } = prepared;
    const llmHeaders = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

    const systemMessages = buildSystemMessages({ ...session, safetyMode });
    const historyMessages = session.messages.map(m => ({ role: m.role, content: m.content }));
    const msgs = [...systemMessages, ...historyMessages];

    const experienceTools = useSafeMode ? [] : getExperienceTools(session.experience);
    const { content: assistantMessage, toolLog } = await runAgentLoop(msgs, apiStyle, llmUrl, llmHeaders, experienceTools, session);
    const latencyMs = Date.now() - msgStart;

    const sanitizedResponse = sanitizeResponse(assistantMessage, safetyMode);
    const outputControlled = applyOutputControls(sanitizedResponse.content, safetyMode, MAX_OUTPUT_CHARS);

    if (sanitizedResponse.flagged) {
      eventBus.emit('output_filtered', {
        session_id: session.id, user_id: session.userId,
        model: session.model, endpoint: session.endpoint, experience: session.experience,
        metadata: { flags: sanitizedResponse.flags, blocked: sanitizedResponse.blocked, redacted: sanitizedResponse.redacted },
      });
    }

    session.messages.push({
      role: 'assistant', content: outputControlled.content, timestamp: new Date(),
      filterFlags: sanitizedResponse.flags, blocked: sanitizedResponse.blocked,
      redacted: sanitizedResponse.redacted, toolLog: toolLog?.length ? toolLog : undefined, feedback: null,
    });
    session.status = 'idle';
    session.lastActivity = new Date();
    session.updatedAt = new Date();
    upsertSessionContext(session, logStructured);

    if (outputControlled.truncated) {
      eventBus.emit('output_control_applied', {
        session_id: session.id, user_id: session.userId,
        model: session.model, endpoint: session.endpoint, experience: session.experience,
        metadata: { type: 'truncate', maxChars: outputControlled.maxChars },
      });
    }

    eventBus.emit('message_received', {
      session_id: session.id, user_id: session.userId,
      model: session.model, endpoint: session.endpoint, experience: session.experience,
      metadata: { latencyMs, responseLength: outputControlled.content.length, filterFlags: sanitizedResponse.flags, blocked: sanitizedResponse.blocked, redacted: sanitizedResponse.redacted },
    });

    res.json({
      success: true, response: outputControlled.content, classification,
      filterFlags: sanitizedResponse.flags,
      endpoint: useSafeMode ? `${session.endpoint} (safe)` : session.endpoint,
      messageCount: session.messages.length,
      toolLog: toolLog?.length ? toolLog : undefined,
    });
  } catch (error) {
    logStructured('error', 'llm_call_failed', { sessionId: session.id, endpoint: session.endpoint, model: session.model, error: error.message });
    const errorMsg = `[Error] Could not reach the configured model service for ${session.endpoint}: ${error.message}`;
    session.messages.push({ role: 'assistant', content: errorMsg, timestamp: new Date() });
    session.status = 'error';
    session.lastActivity = new Date();
    session.errorCount = (session.errorCount || 0) + 1;
    session.updatedAt = new Date();
    upsertSessionContext(session, logStructured);
    eventBus.emit('error', {
      session_id: session.id, user_id: session.userId,
      model: session.model, endpoint: session.endpoint, experience: session.experience,
      metadata: { error: error.message, llmUrl: session.llmUrl },
    });
    res.json({ success: false, response: errorMsg, endpoint: session.endpoint, messageCount: session.messages.length });
  }
}
