import express from 'express';
import axios from 'axios';
import {
  classifyInput, buildSystemMessages, sanitizeResponse,
  applyOutputControls, normalizePromptText, resolveEffectiveSafetyMode,
} from '../safety.js';

export function createSessionsRouter({
  sessions,
  sessionCounterRef,
  eventBus,
  logStructured,
  LLM_CONFIG,
  PUBLIC_DEMO_MODE,
  DEMO_EXPERIENCE,
  MAX_INPUT_CHARS,
  MAX_OUTPUT_CHARS,
  DEVICE_PROFILE,
  resolveRequestedExperience,
  isKnownExperience,
  isKnownSafetyMode,
  resolveSessionEndpoint,
  resolveConfiguredSafetyMode,
  isEndpointAllowed,
  getExperienceConfig,
  getAllowedEndpoints,
  coerceModelForEndpoint,
  resolveEndpointUrl,
  prepareSessionForLlmCall,
  ensureRunnableModelForSession,
  getExperienceTools,
  runPromptHandlers,
  runAgentLoop,
  upsertSessionContext,
  markSessionEnded,
  persistEvent,
  activeDockerRunnerModelRef,
}) {
  const router = express.Router();

  /**
   * Create a new agent session
   */
  router.post('/', async (req, res) => {
    const {
      endpoint: requestedEndpoint = 'primary',
      name = `session-${++sessionCounterRef.current}`,
      userId,
      userRole,
      experience: requestedExperience = 'developer',
      safetyMode
    } = req.body;

    const experience = resolveRequestedExperience(requestedExperience);

    if (!isKnownExperience(experience)) {
      return res.status(400).json({ success: false, error: 'Invalid experience' });
    }

    if (safetyMode && !isKnownSafetyMode(safetyMode)) {
      return res.status(400).json({ success: false, error: 'Invalid safety mode' });
    }

    const endpoint = resolveSessionEndpoint(experience, requestedEndpoint);
    const endpointWasAdjusted = endpoint !== requestedEndpoint;
    const model = endpointWasAdjusted
      ? LLM_CONFIG[endpoint]?.defaultModel || LLM_CONFIG.primary.defaultModel
      : coerceModelForEndpoint(endpoint, req.body.model) || LLM_CONFIG[endpoint]?.defaultModel || LLM_CONFIG.primary.defaultModel;
    const resolvedSafetyMode = resolveConfiguredSafetyMode(experience, safetyMode);

    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const resolvedLlmUrl = await resolveEndpointUrl(endpoint);

    const session = {
      id: sessionId,
      name,
      model,
      endpoint,
      llmUrl: resolvedLlmUrl,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: userId || 'anonymous',
      userRole: userRole || null,
      experience,
      safetyMode: resolvedSafetyMode,
      useSafeModeEnabled: false
    };

    sessions.set(sessionId, session);
    upsertSessionContext(session, logStructured);

    eventBus.emit('session_start', {
      session_id: sessionId,
      user_id: session.userId,
      model,
      endpoint,
      experience,
      metadata: {
        safetyMode: resolvedSafetyMode,
        userRole: session.userRole,
        endpointAdjusted: endpointWasAdjusted,
        publicDemoMode: PUBLIC_DEMO_MODE,
        requestedExperience: requestedExperience || null,
        resolvedExperience: experience
      }
    });

    res.json({
      success: true,
      session: {
        id: sessionId,
        name,
        model,
        endpoint,
        experience,
        safetyMode: resolvedSafetyMode,
        endpointAdjusted: endpointWasAdjusted,
        createdAt: session.createdAt
      }
    });
  });

  /**
   * Get all sessions
   */
  router.get('/', (req, res) => {
    const sessionList = Array.from(sessions.values()).map(s => ({
      id: s.id,
      name: s.name,
      model: s.model,
      endpoint: s.endpoint,
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      userId: s.userId,
      experience: s.experience,
      safetyMode: s.safetyMode
    }));

    res.json({ success: true, sessions: sessionList });
  });

  /**
   * Get session details
   */
  router.get('/:id', (req, res) => {
    const session = sessions.get(req.params.id);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    res.json({
      success: true,
      session: {
        id: session.id,
        name: session.name,
        model: session.model,
        endpoint: session.endpoint,
        llmUrl: session.llmUrl,
        messages: session.messages,
        createdAt: session.createdAt,
        userId: session.userId,
        userRole: session.userRole,
        experience: session.experience,
        safetyMode: session.safetyMode,
        useSafeModeEnabled: session.useSafeModeEnabled
      }
    });
  });

  /**
   * Send message to agent and get response
   */
  router.post('/:id/message', async (req, res) => {
    const session = sessions.get(req.params.id);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const { message, useSafeMode = false } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    if (typeof useSafeMode !== 'boolean') {
      return res.status(400).json({ success: false, error: 'useSafeMode must be a boolean' });
    }

    if (session.useSafeModeEnabled !== useSafeMode) {
      session.useSafeModeEnabled = useSafeMode;
      eventBus.emit('safe_mode_toggled', {
        session_id: session.id,
        user_id: session.userId,
        model: session.model,
        endpoint: session.endpoint,
        experience: session.experience,
        metadata: { enabled: useSafeMode }
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
        session_id: session.id,
        user_id: session.userId,
        model: session.model,
        endpoint: session.endpoint,
        experience: session.experience,
        metadata: {
          reason: handlerResult.classification?.reason || null,
          blocked: handlerResult.blocked
        }
      });

      return res.json({
        success: true,
        response: handlerResult.response,
        classification: handlerResult.classification || { category: 'safe', reason: null },
        blocked: handlerResult.blocked,
        endpoint: useSafeMode ? `${session.endpoint} (safe)` : session.endpoint,
        messageCount: session.messages.length
      });
    }

    const normalizedMessage = handlerResult.message || normalizePromptText(message);

    // ── Input Classification ──────────────────────────────────────────────────
    const classification = classifyInput(normalizedMessage);

    eventBus.emit('input_classified', {
      session_id: session.id,
      user_id: session.userId,
      model: session.model,
      endpoint: session.endpoint,
      experience: session.experience,
      metadata: { category: classification.category, reason: classification.reason }
    });

    if (classification.category === 'blocked') {
      eventBus.emit('input_blocked', {
        session_id: session.id,
        user_id: session.userId,
        model: session.model,
        endpoint: session.endpoint,
        experience: session.experience,
        metadata: { reason: classification.reason }
      });

      const refusal = "I'm not able to help with that. If you have a genuine question, please rephrase it and I'll do my best to assist.";
      session.messages.push({ role: 'user', content: normalizedMessage, timestamp: new Date() });
      session.messages.push({ role: 'assistant', content: refusal, timestamp: new Date(), blocked: true });
      session.updatedAt = new Date();
      upsertSessionContext(session, logStructured);

      return res.json({
        success: true,
        response: refusal,
        classification,
        blocked: true,
        endpoint: session.endpoint,
        messageCount: session.messages.length
      });
    }

    // Add user message to history
    session.messages.push({ role: 'user', content: normalizedMessage, timestamp: new Date() });
    upsertSessionContext(session, logStructured);

    eventBus.emit('message_sent', {
      session_id: session.id,
      user_id: session.userId,
      model: session.model,
      endpoint: session.endpoint,
      experience: session.experience,
      metadata: { classification: classification.category, messageLength: normalizedMessage.length }
    });

    const msgStart = Date.now();

    try {
      const prepared = await prepareSessionForLlmCall(session);
      if (LLM_CONFIG[session.endpoint]?.backendType === 'docker-runner') {
        activeDockerRunnerModelRef.current = { key: session.endpoint, model: session.model, at: new Date() };
      }
      // NemoClaw is a WebSocket UI, not a REST API — safe mode uses primary LLM with strict filters
      const llmUrl = prepared.llmUrl;
      const apiStyle = prepared.apiStyle;
      const llmHeaders = prepared.apiKey ? { Authorization: `Bearer ${prepared.apiKey}` } : {};

      // ── Prompt Wrapping ───────────────────────────────────────────────────────
      const systemMessages = buildSystemMessages({ ...session, safetyMode });
      const historyMessages = session.messages.map(m => ({ role: m.role, content: m.content }));
      const msgs = [...systemMessages, ...historyMessages];

      const experienceTools = useSafeMode ? [] : getExperienceTools(session.experience);
      const { content: assistantMessage, toolLog } = await runAgentLoop(
        msgs, apiStyle, llmUrl, llmHeaders, experienceTools, session
      );
      const latencyMs = Date.now() - msgStart;

      // ── Response Filter ───────────────────────────────────────────────────────
      const sanitizedResponse = sanitizeResponse(assistantMessage, safetyMode);
      const outputControlled = applyOutputControls(sanitizedResponse.content, safetyMode, MAX_OUTPUT_CHARS);
      if (sanitizedResponse.flagged) {
        eventBus.emit('output_filtered', {
          session_id: session.id,
          user_id: session.userId,
          model: session.model,
          endpoint: session.endpoint,
          experience: session.experience,
          metadata: {
            flags: sanitizedResponse.flags,
            blocked: sanitizedResponse.blocked,
            redacted: sanitizedResponse.redacted
          }
        });
      }

      session.messages.push({
        role: 'assistant',
        content: outputControlled.content,
        timestamp: new Date(),
        filterFlags: sanitizedResponse.flags,
        blocked: sanitizedResponse.blocked,
        redacted: sanitizedResponse.redacted,
        toolLog: toolLog?.length ? toolLog : undefined,
        feedback: null
      });
      session.updatedAt = new Date();
      upsertSessionContext(session, logStructured);

      if (outputControlled.truncated) {
        eventBus.emit('output_control_applied', {
          session_id: session.id,
          user_id: session.userId,
          model: session.model,
          endpoint: session.endpoint,
          experience: session.experience,
          metadata: { type: 'truncate', maxChars: outputControlled.maxChars }
        });
      }

      eventBus.emit('message_received', {
        session_id: session.id,
        user_id: session.userId,
        model: session.model,
        endpoint: session.endpoint,
        experience: session.experience,
        metadata: {
          latencyMs,
          responseLength: outputControlled.content.length,
          filterFlags: sanitizedResponse.flags,
          blocked: sanitizedResponse.blocked,
          redacted: sanitizedResponse.redacted
        }
      });

      res.json({
        success: true,
        response: outputControlled.content,
        classification,
        filterFlags: sanitizedResponse.flags,
        endpoint: useSafeMode ? `${session.endpoint} (safe)` : session.endpoint,
        messageCount: session.messages.length,
        toolLog: toolLog?.length ? toolLog : undefined
      });
    } catch (error) {
      logStructured('error', 'llm_call_failed', {
        sessionId: session.id,
        endpoint: session.endpoint,
        model: session.model,
        error: error.message
      });
      const errorMsg = `[Error] Could not reach the configured model service for ${session.endpoint}: ${error.message}`;
      session.messages.push({ role: 'assistant', content: errorMsg, timestamp: new Date() });
      session.updatedAt = new Date();
      upsertSessionContext(session, logStructured);

      eventBus.emit('error', {
        session_id: session.id,
        user_id: session.userId,
        model: session.model,
        endpoint: session.endpoint,
        experience: session.experience,
        metadata: { error: error.message, llmUrl: session.llmUrl }
      });

      res.json({
        success: false,
        response: errorMsg,
        endpoint: session.endpoint,
        messageCount: session.messages.length
      });
    }
  });

  /**
   * Stream message response via Server-Sent Events (SSE)
   * POST /api/sessions/:id/stream  body: { message, useSafeMode }
   * Client receives token-by-token events:
   *   data: {"type":"token","content":"..."}
   *   data: {"type":"done","messageCount":N}
   *   data: {"type":"error","message":"..."}
   */
  router.post('/:id/stream', async (req, res) => {
    const session = sessions.get(req.params.id);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const { message, useSafeMode = false } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    // Add user message to history
    session.messages.push({ role: 'user', content: message, timestamp: new Date() });
    upsertSessionContext(session, logStructured);

  if (session.endpoint === 'primary') {
      session.llmUrl = await resolveEndpointUrl('primary');
    }

    const safetyMode = resolveEffectiveSafetyMode(session, useSafeMode);
    const prepared = await prepareSessionForLlmCall(session);
    if (LLM_CONFIG[session.endpoint]?.backendType === 'docker-runner') {
      activeDockerRunnerModelRef.current = { key: session.endpoint, model: session.model, at: new Date() };
    }
    // NemoClaw is a WebSocket UI, not a REST API — safe mode uses primary LLM with strict filters
    const llmUrl = prepared.llmUrl;
    const apiStyle = prepared.apiStyle;
    const streamHeaders = prepared.apiKey ? { Authorization: `Bearer ${prepared.apiKey}` } : {};
    const systemMessages = buildSystemMessages({ ...session, safetyMode });
    const historyMessages = session.messages.map(m => ({ role: m.role, content: m.content }));
    const msgs = [...systemMessages, ...historyMessages];

    const experienceStreamTools = useSafeMode ? [] : getExperienceTools(session.experience);
    let fullContent = '';

    // For tool-enabled experiences, run the agentic loop synchronously first,
    // then emit the result as SSE tokens so the client sees a streamed response.
    if (experienceStreamTools.length > 0 && !useSafeMode) {
      try {
        const { content: loopContent, toolLog: loopToolLog } = await runAgentLoop(
          msgs, apiStyle, llmUrl, streamHeaders, experienceStreamTools, session
        );
        fullContent = loopContent;
        if (loopToolLog?.length) {
          for (const entry of loopToolLog) {
            send({ type: 'tool_call', tool: entry.name, args: entry.args, result: entry.result });
          }
        }
        send({ type: 'token', content: fullContent });
        session.messages.push({ role: 'assistant', content: fullContent, timestamp: new Date(), toolLog: loopToolLog?.length ? loopToolLog : undefined });
        session.updatedAt = new Date();
        upsertSessionContext(session, logStructured);
        send({ type: 'done', messageCount: session.messages.length });
        res.end();
      } catch (error) {
        const errMsg = `[Error] Agent loop failed: ${error.message}`;
        session.messages.push({ role: 'assistant', content: errMsg, timestamp: new Date() });
        session.updatedAt = new Date();
        upsertSessionContext(session, logStructured);
        send({ type: 'error', message: errMsg });
        res.end();
      }
      return;
    }

    try {
      const streamResponse = await axios.post(
        apiStyle === 'openai' ? `${llmUrl}/chat/completions` : `${llmUrl}/api/chat`,
        { model: session.model, messages: msgs, stream: true },
        { headers: streamHeaders, responseType: 'stream', timeout: 120000 }
      );

      streamResponse.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
          // OpenAI SSE format: "data: {...}" or "data: [DONE]"
          const text = line.startsWith('data: ') ? line.slice(6) : line;
          if (text === '[DONE]') continue;
          try {
            const parsed = JSON.parse(text);
            // OpenAI format: choices[0].delta.content
            // Ollama format: message.content (with done flag)
            const token = parsed.choices?.[0]?.delta?.content ?? parsed.message?.content ?? '';
            if (token) {
              fullContent += token;
              send({ type: 'token', content: token });
            }
            // Ollama signals end with done:true
            if (parsed.done === true && !parsed.message) {
              // final stats object from Ollama — ignore
            }
          } catch {
            // not valid JSON, skip
          }
        }
      });

      streamResponse.data.on('end', () => {
        if (!fullContent) fullContent = 'No response received';
        session.messages.push({ role: 'assistant', content: fullContent, timestamp: new Date() });
        session.updatedAt = new Date();
        upsertSessionContext(session, logStructured);
        send({ type: 'done', messageCount: session.messages.length });
        res.end();
      });

      streamResponse.data.on('error', (err) => {
        console.error('[Stream] LLM stream error:', err.message);
        const errMsg = `[Error] Stream failed: ${err.message}`;
        if (!fullContent) {
          session.messages.push({ role: 'assistant', content: errMsg, timestamp: new Date() });
          session.updatedAt = new Date();
          upsertSessionContext(session, logStructured);
        }
        send({ type: 'error', message: errMsg });
        res.end();
      });

      req.on('close', () => {
        streamResponse.data.destroy();
      });
    } catch (error) {
      console.error('[Stream] Error starting LLM stream:', error.message);
      const backendType = LLM_CONFIG[session.endpoint]?.backendType || '';
      let errMsg;
      if (error.response?.status === 500 && backendType === 'docker-runner') {
        errMsg = `[Error] Docker Model Runner returned 500 for ${session.model}. ` +
          `The model may be too large for this device (${DEVICE_PROFILE} profile), or ` +
          `Docker Desktop's Model Runner feature may not be fully enabled. ` +
          `Try a smaller model or check Docker Desktop → Settings → Features in Development → Docker Model Runner.`;
      } else {
        errMsg = `[Error] Could not reach LLM at ${llmUrl}: ${error.message}`;
      }
      session.messages.push({ role: 'assistant', content: errMsg, timestamp: new Date() });
      session.updatedAt = new Date();
      upsertSessionContext(session, logStructured);
      send({ type: 'error', message: errMsg });
      res.end();
    }
  });

  /**
   * Switch endpoint/model in a session
   */
  router.put('/:id/model', async (req, res) => {
    const session = sessions.get(req.params.id);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const { endpoint, model } = req.body;

    if (!endpoint || !LLM_CONFIG[endpoint]) {
      return res.status(400).json({ success: false, error: 'Invalid endpoint' });
    }

    if (!isEndpointAllowed(session.experience, endpoint)) {
      return res.status(403).json({ success: false, error: 'Endpoint is not allowed for this experience' });
    }

    if (PUBLIC_DEMO_MODE && endpoint !== 'primary') {
      return res.status(403).json({ success: false, error: 'Public demo mode only allows the primary endpoint' });
    }

    const prevEndpoint = session.endpoint;
    session.endpoint = endpoint;
    session.model = coerceModelForEndpoint(endpoint, model) || LLM_CONFIG[endpoint].defaultModel;
    session.llmUrl = await resolveEndpointUrl(endpoint);
    session.updatedAt = new Date();
    upsertSessionContext(session, logStructured);

    eventBus.emit('model_switched', {
      session_id: session.id,
      user_id: session.userId,
      model: session.model,
      endpoint,
      experience: session.experience,
      metadata: { from: prevEndpoint, to: endpoint }
    });

    res.json({
      success: true,
      message: `Switched to ${LLM_CONFIG[endpoint].name}`,
      session: {
        endpoint,
        model: session.model,
        llmUrl: session.llmUrl
      }
    });
  });

  /**
   * Delete session
   */
  router.delete('/:id', (req, res) => {
    const exists = sessions.has(req.params.id);

    if (exists) {
      const session = sessions.get(req.params.id);
      session.endedAt = new Date();
      eventBus.emit('session_end', {
        session_id: req.params.id,
        user_id: session?.userId,
        model: session?.model,
        endpoint: session?.endpoint,
        experience: session?.experience,
        metadata: { messageCount: session?.messages.length }
      });
      upsertSessionContext(session, logStructured);
      markSessionEnded(req.params.id, session.endedAt, logStructured);
      sessions.delete(req.params.id);
    }

    res.json({ success: true, deleted: exists });
  });

  /**
   * Message feedback — thumbs up/down on a specific message index
   * POST /api/sessions/:id/feedback  { messageIndex, positive: true|false }
   */
  router.post('/:id/feedback', (req, res) => {
    const session = sessions.get(req.params.id);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const { messageIndex, positive } = req.body;
    if (typeof positive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'positive (boolean) is required' });
    }

    if (!Number.isInteger(messageIndex)) {
      return res.status(400).json({ success: false, error: 'messageIndex must be an integer' });
    }

    if (messageIndex < 0 || messageIndex >= session.messages.length) {
      return res.status(400).json({ success: false, error: 'messageIndex is out of range' });
    }

    if (session.messages[messageIndex]?.role !== 'assistant') {
      return res.status(400).json({ success: false, error: 'Feedback can only be recorded for assistant messages' });
    }

    if (session.messages[messageIndex]?.feedback) {
      return res.status(409).json({ success: false, error: 'Feedback already submitted for this message' });
    }

    session.messages[messageIndex].feedback = positive ? 'up' : 'down';
    session.messages[messageIndex].feedbackAt = new Date();
    session.updatedAt = new Date();
    upsertSessionContext(session, logStructured);

    const eventType = positive ? 'feedback_positive' : 'feedback_negative';
    eventBus.emit(eventType, {
      session_id: session.id,
      user_id: session.userId,
      model: session.model,
      endpoint: session.endpoint,
      experience: session.experience,
      metadata: { messageIndex }
    });

    res.json({ success: true, recorded: eventType });
  });

  return router;
}
