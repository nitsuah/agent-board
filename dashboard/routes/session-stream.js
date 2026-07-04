import axios from 'axios';
import { buildSystemMessages, resolveEffectiveSafetyMode } from '../safety.js';

export async function handleSessionStream(req, res, {
  sessions, LLM_CONFIG, DEVICE_PROFILE,
  resolveEndpointUrl, prepareSessionForLlmCall,
  getExperienceTools, runAgentLoop,
  upsertSessionContext, activeDockerRunnerModelRef, logStructured,
}) {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

  const { message, useSafeMode = false } = req.body;
  if (!message) return res.status(400).json({ success: false, error: 'Message is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

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
  const { llmUrl, apiStyle, apiKey } = prepared;
  const streamHeaders = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const systemMessages = buildSystemMessages({ ...session, safetyMode });
  const historyMessages = session.messages.map(m => ({ role: m.role, content: m.content }));
  const msgs = [...systemMessages, ...historyMessages];

  const experienceStreamTools = useSafeMode ? [] : getExperienceTools(session.experience);
  let fullContent = '';

  // For tool-enabled experiences, run the agentic loop then emit result as tokens
  if (experienceStreamTools.length > 0 && !useSafeMode) {
    try {
      const { content: loopContent, toolLog: loopToolLog } = await runAgentLoop(msgs, apiStyle, llmUrl, streamHeaders, experienceStreamTools, session);
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

    const STALL_TIMEOUT_MS = 30_000;
    let stallTimer = null;
    let streamEnded = false;

    const resetStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (streamEnded) return;
        streamEnded = true;
        streamResponse.data.destroy();
        if (fullContent) {
          session.messages.push({ role: 'assistant', content: fullContent, timestamp: new Date() });
          session.updatedAt = new Date();
          upsertSessionContext(session, logStructured);
          send({ type: 'done', messageCount: session.messages.length, truncated: true });
        } else {
          send({ type: 'error', message: '[Error] LLM stream stalled — no data for 30s' });
        }
        res.end();
      }, STALL_TIMEOUT_MS);
    };
    resetStallTimer();

    streamResponse.data.on('data', (chunk) => {
      resetStallTimer();
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        const text = line.startsWith('data: ') ? line.slice(6) : line;
        if (text === '[DONE]') continue;
        try {
          const parsed = JSON.parse(text);
          const token = parsed.choices?.[0]?.delta?.content ?? parsed.message?.content ?? '';
          if (token) { fullContent += token; send({ type: 'token', content: token }); }
        } catch { /* non-JSON chunk, skip */ }
      }
    });

    streamResponse.data.on('end', () => {
      if (streamEnded) return;
      streamEnded = true;
      clearTimeout(stallTimer);
      if (!fullContent) fullContent = 'No response received';
      session.messages.push({ role: 'assistant', content: fullContent, timestamp: new Date() });
      session.updatedAt = new Date();
      upsertSessionContext(session, logStructured);
      send({ type: 'done', messageCount: session.messages.length });
      res.end();
    });

    streamResponse.data.on('error', (err) => {
      if (streamEnded) return;
      streamEnded = true;
      clearTimeout(stallTimer);
      logStructured('warn', 'stream_data_error', { session_id: session.id, error: err.message });
      const errMsg = `[Error] Stream failed: ${err.message}`;
      if (!fullContent) {
        session.messages.push({ role: 'assistant', content: errMsg, timestamp: new Date() });
        session.updatedAt = new Date();
        upsertSessionContext(session, logStructured);
      } else {
        // save whatever partial content arrived
        session.messages.push({ role: 'assistant', content: fullContent, timestamp: new Date() });
        session.updatedAt = new Date();
        upsertSessionContext(session, logStructured);
      }
      send({ type: 'error', message: errMsg });
      res.end();
    });

    req.on('close', () => {
      clearTimeout(stallTimer);
      streamEnded = true;
      streamResponse.data.destroy();
      // persist whatever partial content arrived before client disconnected
      if (fullContent && !session.messages.find(m => m.role === 'assistant' && m.content === fullContent)) {
        session.messages.push({ role: 'assistant', content: fullContent, timestamp: new Date() });
        session.updatedAt = new Date();
        upsertSessionContext(session, logStructured);
      }
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
}
