/**
 * Shared safety pipeline for a chat turn, used by both POST /api/sessions/:id/message
 * and POST /api/sessions/:id/stream so the two paths cannot drift apart.
 *
 *   preflightTurn  — safe-mode toggle, prompt handlers, input classification,
 *                    blocking (with refusal), user-message persistence + events.
 *   ensureTurnTool — JIT start of the MCP tool server an experience needs.
 *   finalizeReply  — output sanitization (PII redaction / harmful-content block),
 *                    output controls (truncation), assistant persistence + events.
 */
import {
  classifyInput, sanitizeResponse, applyOutputControls,
  normalizePromptText, resolveEffectiveSafetyMode,
} from '../safety.js';
import { ensureToolReady, experienceToolKey } from './tool-lifecycle.js';

export const BLOCKED_INPUT_REFUSAL =
  "I'm not able to help with that. If you have a genuine question, please rephrase it and I'll do my best to assist.";

function eventBase(session) {
  return {
    session_id: session.id, user_id: session.userId,
    model: session.model, endpoint: session.endpoint, experience: session.experience,
  };
}

/**
 * Runs every check that must happen before the model sees the message.
 * Returns { kind: 'handled' | 'blocked' | 'proceed', safetyMode, ... }.
 * For 'handled' and 'blocked' the turn is already persisted and the caller only
 * has to deliver `response`; for 'proceed' the user message is persisted.
 */
export async function preflightTurn(session, message, useSafeMode, { eventBus, runPromptHandlers, upsertSessionContext, logStructured }) {
  if (session.useSafeModeEnabled !== useSafeMode) {
    session.useSafeModeEnabled = useSafeMode;
    eventBus.emit('safe_mode_toggled', { ...eventBase(session), metadata: { enabled: useSafeMode } });
  }

  const safetyMode = resolveEffectiveSafetyMode(session, useSafeMode);
  const handlerResult = await runPromptHandlers(message, session, safetyMode);

  if (handlerResult.handled) {
    session.messages.push({ role: 'user', content: normalizePromptText(message), timestamp: new Date() });
    session.messages.push({ role: 'assistant', content: handlerResult.response, timestamp: new Date(), blocked: handlerResult.blocked });
    session.updatedAt = new Date();
    upsertSessionContext(session, logStructured);
    eventBus.emit('prompt_handler_invoked', {
      ...eventBase(session),
      metadata: { reason: handlerResult.classification?.reason || null, blocked: handlerResult.blocked },
    });
    return {
      kind: 'handled', safetyMode, response: handlerResult.response, blocked: handlerResult.blocked,
      classification: handlerResult.classification || { category: 'safe', reason: null },
    };
  }

  const normalizedMessage = handlerResult.message || normalizePromptText(message);
  const classification = classifyInput(normalizedMessage, safetyMode);
  eventBus.emit('input_classified', {
    ...eventBase(session),
    metadata: { category: classification.category, reason: classification.reason },
  });

  if (classification.category === 'blocked') {
    eventBus.emit('input_blocked', { ...eventBase(session), metadata: { reason: classification.reason } });
    session.messages.push({ role: 'user', content: normalizedMessage, timestamp: new Date() });
    session.messages.push({ role: 'assistant', content: BLOCKED_INPUT_REFUSAL, timestamp: new Date(), blocked: true });
    session.updatedAt = new Date();
    upsertSessionContext(session, logStructured);
    return { kind: 'blocked', safetyMode, response: BLOCKED_INPUT_REFUSAL, blocked: true, classification };
  }

  session.messages.push({ role: 'user', content: normalizedMessage, timestamp: new Date() });
  upsertSessionContext(session, logStructured);
  eventBus.emit('message_sent', {
    ...eventBase(session),
    metadata: { classification: classification.category, messageLength: normalizedMessage.length },
  });
  return { kind: 'proceed', safetyMode, classification, normalizedMessage };
}

/** JIT tool lifecycle: auto-start the MCP tool server the experience requires. */
export async function ensureTurnTool(session, { TOOL_SERVERS, serviceRegistry, dockerControlEnabled, runComposeAction, logStructured, eventBus }) {
  const requiredTool = experienceToolKey(session.experience, TOOL_SERVERS || {});
  if (!requiredTool || !TOOL_SERVERS) return { ready: true };
  const lifecycle = await ensureToolReady(requiredTool, TOOL_SERVERS, serviceRegistry, dockerControlEnabled, runComposeAction, logStructured);
  if (!lifecycle.ready) {
    return { ready: false, error: lifecycle.error || `Tool server for ${session.experience} is unavailable` };
  }
  if (lifecycle.started) {
    eventBus.emit('tool_lifecycle_started', { session_id: session.id, metadata: { toolKey: requiredTool } });
  }
  return { ready: true };
}

/**
 * Sanitizes and persists the model's reply. Returns what the user should see.
 * `partial` marks a reply cut short (stall / client disconnect).
 */
export function finalizeReply(session, rawContent, safetyMode, { eventBus, upsertSessionContext, logStructured, MAX_OUTPUT_CHARS }, { latencyMs = null, toolLog, partial = false } = {}) {
  const sanitized = sanitizeResponse(rawContent, safetyMode);
  const controlled = applyOutputControls(sanitized.content, safetyMode, MAX_OUTPUT_CHARS);

  if (sanitized.flagged) {
    eventBus.emit('output_filtered', {
      ...eventBase(session),
      metadata: { flags: sanitized.flags, blocked: sanitized.blocked, redacted: sanitized.redacted },
    });
  }
  if (controlled.truncated) {
    eventBus.emit('output_control_applied', {
      ...eventBase(session),
      metadata: { type: 'truncate', maxChars: controlled.maxChars },
    });
  }

  session.messages.push({
    role: 'assistant', content: controlled.content, timestamp: new Date(),
    filterFlags: sanitized.flags, blocked: sanitized.blocked, redacted: sanitized.redacted,
    toolLog: toolLog?.length ? toolLog : undefined, feedback: null,
    ...(partial ? { partial: true } : {}),
  });
  session.status = 'idle';
  session.lastActivity = new Date();
  session.updatedAt = new Date();
  upsertSessionContext(session, logStructured);

  eventBus.emit('message_received', {
    ...eventBase(session),
    metadata: {
      latencyMs, responseLength: controlled.content.length, filterFlags: sanitized.flags,
      blocked: sanitized.blocked, redacted: sanitized.redacted, ...(partial ? { partial: true } : {}),
    },
  });

  return { content: controlled.content, flags: sanitized.flags, blocked: sanitized.blocked, redacted: sanitized.redacted, truncated: controlled.truncated };
}

/** Records a failed model call the same way on both paths. */
export function recordTurnError(session, errMsg, error, { eventBus, upsertSessionContext, logStructured }) {
  session.messages.push({ role: 'assistant', content: errMsg, timestamp: new Date() });
  session.status = 'error';
  session.lastActivity = new Date();
  session.errorCount = (session.errorCount || 0) + 1;
  session.updatedAt = new Date();
  upsertSessionContext(session, logStructured);
  eventBus.emit('error', { ...eventBase(session), metadata: { error: error?.message || errMsg, llmUrl: session.llmUrl } });
}
