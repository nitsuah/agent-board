import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// LLM Configuration - Support multiple endpoints
// apiStyle: 'ollama' uses /api/chat + /api/tags; 'openai' uses /v1/chat/completions + /v1/models
// backendType: used by the UI to show how the model is served
const DOCKER_RUNNER_URL = process.env.DOCKER_RUNNER_URL || 'http://model-runner.docker.internal/engines/llama.cpp/v1';

const LLM_CONFIG = {
  primary: {
    url: process.env.PRIMARY_LLM_URL || 'http://ollama:8080',
    name: 'Ollama (local)',
    backendType: 'ollama-container',
    type: 'general',
    apiStyle: 'ollama',
    defaultModel: 'llama2:latest'
  },
  docker_runner: {
    url: DOCKER_RUNNER_URL,
    name: 'Qwen3-Coder (Docker Runner)',
    backendType: 'docker-runner',
    type: 'coding',
    apiStyle: 'openai',
    defaultModel: process.env.DOCKER_RUNNER_MODEL || 'ai/qwen3-coder:latest'
  },
  glm_flash: {
    // GLM-4.7-Flash is a docker.io/ai/* model — runs via Docker Model Runner, not a separate container.
    // Pull with: docker model pull ai/glm-4.7-flash:latest
    url: DOCKER_RUNNER_URL,
    name: 'GLM-4.7-Flash (Docker Runner)',
    backendType: 'docker-runner',
    type: 'fast',
    apiStyle: 'openai',
    defaultModel: process.env.GLM_FLASH_MODEL || 'ai/glm-4.7-flash:latest'
  }
};

const NEMOCLAW_URL = process.env.NEMOCLAW_URL || 'http://localhost:9000';
const BB_MCP_URL = process.env.BB_MCP_URL || 'http://localhost:3100';

// Session management
const sessions = new Map();
let sessionCounter = 0;

// ============ EVENT BUS ============
// Lightweight in-memory pub/sub — events fire-and-forget so they never block the UX.
// Swap the `_store` array for a DB write in persist() when Postgres is available.
const _eventStore = [];
const MAX_EVENTS = 10000;

const eventBus = {
  emit(type, data = {}) {
    const event = {
      event_id: randomUUID(),
      session_id: data.session_id || null,
      user_id: data.user_id || 'anonymous',
      timestamp: new Date().toISOString(),
      event_type: type,
      model: data.model || null,
      endpoint: data.endpoint || null,
      experience: data.experience || null,
      metadata: data.metadata || {}
    };
    _eventStore.push(event);
    if (_eventStore.length > MAX_EVENTS) _eventStore.shift();
    return event;
  },
  getAll() { return _eventStore; },
  getByType(type) { return _eventStore.filter(e => e.event_type === type); },
  getSince(iso) {
    const since = new Date(iso).getTime();
    return _eventStore.filter(e => new Date(e.timestamp).getTime() >= since);
  }
};

// ============ SAFETY & EXPERIENCES ============

const SAFETY_CONFIGS = {
  strict: {
    systemPrompt:
      'You are a safe, helpful assistant. Never provide information about self-harm, illegal activities, ' +
      'how to extract personal information, or anything that could harm the user or others. ' +
      'If asked about such topics, politely decline and redirect to appropriate resources.',
    blockedPatterns: [
      'ignore previous instructions', 'ignore all previous', 'ignore all rules',
      'jailbreak', 'you are now', 'pretend you are', 'act as if you have no restrictions',
      'disregard your instructions', 'forget your instructions', 'bypass your',
      'dan mode', 'developer mode', 'unrestricted mode'
    ],
    sensitivePatterns: [
      'how to kill', 'how to hurt', 'suicide', 'harm myself', 'self-harm',
      'drug synthesis', 'make explosives', 'hack into'
    ],
    // Keywords scanned in model output before it is shown to the user.
    // Extend this list in config when new harmful patterns are identified.
    outputHarmKeywords: [
      'suicide method', 'how to self-harm', 'how to make a bomb',
      'step-by-step guide to harm', 'instructions for making explosives'
    ],
    piiDetection: true
  },
  standard: {
    systemPrompt:
      'You are a helpful, accurate assistant. Be concise, honest, and safe. ' +
      'Do not assist with requests that involve illegal activity or harm.',
    blockedPatterns: [
      'ignore previous instructions', 'ignore all previous', 'jailbreak',
      'pretend you have no restrictions', 'dan mode'
    ],
    sensitivePatterns: [],
    outputHarmKeywords: [],
    piiDetection: false
  },
  research: {
    systemPrompt:
      'You are a research assistant. Provide thorough, accurate, and nuanced information. ' +
      'Cite your reasoning and flag areas of uncertainty.',
    blockedPatterns: [],
    sensitivePatterns: [],
    outputHarmKeywords: [],
    piiDetection: false
  }
};

const EXPERIENCE_CONFIGS = {
  developer: {
    name: 'Developer Assistant',
    description: 'Full model access, standard safety, session history.',
    icon: '💻',
    safetyMode: 'standard',
    availableEndpoints: ['primary', 'docker_runner', 'glm_flash'],
    systemPromptSuffix: 'You are assisting a software developer. Be precise, prefer code examples.'
  },
  research: {
    name: 'Research Mode',
    description: 'Long-form reasoning and document analysis. Slightly looser rails — opt-in.',
    icon: '🔬',
    safetyMode: 'research',
    availableEndpoints: ['primary', 'docker_runner', 'glm_flash'],
    systemPromptSuffix: 'You are a research assistant. Prioritise depth, cite your reasoning, and flag uncertainties.'
  },
  safechat: {
    name: 'Safe Chat',
    description: 'Strict safety, simple UI, no model switching. Built for users who don\'t know what Ollama is.',
    icon: '🛡️',
    safetyMode: 'strict',
    availableEndpoints: ['primary'],
    systemPromptSuffix: 'You are a friendly, safe assistant helping everyday users.'
  }
};

// ============ INPUT CLASSIFICATION ============

function classifyInput(text) {
  const lower = text.toLowerCase();
  const safety = SAFETY_CONFIGS.strict; // use broadest pattern set for classification

  if (safety.blockedPatterns.some(p => lower.includes(p))) {
    return { category: 'blocked', reason: 'prompt_injection_or_jailbreak' };
  }
  if (safety.sensitivePatterns.some(p => lower.includes(p))) {
    return { category: 'sensitive', reason: 'potentially_harmful_content' };
  }

  // PII in the input itself
  const pii = detectPII(text);
  if (pii.found) {
    return { category: 'sensitive', reason: 'pii_in_input', pii: pii.types };
  }

  return { category: 'safe', reason: null };
}

// ============ PII DETECTION ============

function detectPII(text) {
  // Email addresses
  const emailRe = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  // Phone: requires recognisable US/international separators to reduce false positives from other digit strings
  const phoneRe = /(?:\+?1[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
  // SSN: strict dashed format only (NNN-NN-NNNN)
  const ssnRe = /\b\d{3}-\d{2}-\d{4}\b/g;
  // Credit cards: 4-group digit pattern with consistent separators.
  // NOTE: this is a heuristic and may produce false positives; Luhn validation
  // would reduce them further but is not implemented here.
  const ccRe = /\b(?:\d{4}[-\s]){3}\d{4}\b/g;

  const emails = (text.match(emailRe) || []);
  const phones = (text.match(phoneRe) || []);
  const ssns = (text.match(ssnRe) || []);
  const ccs = (text.match(ccRe) || []);

  const types = [
    ...(emails.length ? ['email'] : []),
    ...(phones.length ? ['phone'] : []),
    ...(ssns.length ? ['ssn'] : []),
    ...(ccs.length ? ['credit_card'] : [])
  ];

  return { found: types.length > 0, types, counts: { emails: emails.length, phones: phones.length, ssns: ssns.length, ccs: ccs.length } };
}

// ============ PROMPT WRAPPER ============

function buildSystemMessages(session) {
  const experience = EXPERIENCE_CONFIGS[session.experience] || EXPERIENCE_CONFIGS.developer;
  const safetyMode = session.safetyMode || experience.safetyMode || 'standard';
  const safety = SAFETY_CONFIGS[safetyMode] || SAFETY_CONFIGS.standard;

  const systemContent = [
    safety.systemPrompt,
    experience.systemPromptSuffix,
    session.userRole ? `The user has identified as: ${session.userRole}.` : null
  ].filter(Boolean).join(' ');

  return [{ role: 'system', content: systemContent }];
}

// ============ RESPONSE FILTER ============

function filterResponse(text, safetyMode = 'standard') {
  const safety = SAFETY_CONFIGS[safetyMode] || SAFETY_CONFIGS.standard;
  const flags = [];

  if (safety.piiDetection) {
    const pii = detectPII(text);
    if (pii.found) {
      flags.push({ type: 'pii_in_output', detail: pii.types });
    }
  }

  const lowerText = text.toLowerCase();
  if ((safety.outputHarmKeywords || []).some(k => lowerText.includes(k))) {
    flags.push({ type: 'harmful_content' });
  }

  return { flags, flagged: flags.length > 0 };
}

// Middleware
app.use(cors());
app.use(express.json());

// Static files
app.use(express.static(join(__dirname, 'dist')));

// ============ API ROUTES ============

/**
 * Check service health via HTTP (no docker CLI needed inside container)
 * Ollama: GET /api/tags   Docker Model Runner (OpenAI): GET /v1/models
 */
app.get('/api/docker/status', async (req, res) => {
  // Physical service checks (containers or Docker Desktop features)
  const serviceChecks = [
    {
      name: 'ollama',
      label: 'Ollama (local)',
      url: `${LLM_CONFIG.primary.url}/api/tags`,
      ports: '8081:8080',
      backendType: 'ollama-container'
    },
    {
      name: 'docker-runner',
      label: 'Docker Model Runner',
      // Docker Model Runner: OpenAI-compatible, /v1/models lists pulled models
      url: `${DOCKER_RUNNER_URL}/models`,
      ports: 'host-internal',
      backendType: 'docker-runner'
    },
    {
      name: 'nemoclaw',
      label: 'NemoClaw (sandbox)',
      url: `${NEMOCLAW_URL}/`,
      ports: '9000:8080',
      backendType: 'sandbox'
    },
    {
      name: 'bb-mcp',
      label: 'Blackboard Learn MCP',
      url: `${BB_MCP_URL}/health`,
      ports: '3100:3100',
      backendType: 'mcp'
    },
  ];

  const containers = {};
  for (const { name, label, url, ports, backendType } of serviceChecks) {
    try {
      await axios.get(url, { timeout: 3000 });
      containers[name] = { running: true, status: 'healthy', ports, backendType, label };
    } catch {
      containers[name] = { running: false, status: 'unavailable', ports, backendType, label };
    }
  }

  // Per-endpoint LLM status — derived from the service checks above
  const runnerLive = containers['docker-runner']?.running ?? false;
  const endpoints = {};
  for (const [key, config] of Object.entries(LLM_CONFIG)) {
    const live = config.backendType === 'ollama-container'
      ? (containers['ollama']?.running ?? false)
      : config.backendType === 'docker-runner'
        ? runnerLive
        : false;
    endpoints[key] = {
      name: config.name,
      model: config.defaultModel,
      backendType: config.backendType,
      live,
      fallback: !live
    };
  }

  const dockerRunning = Object.values(containers).some(c => c.running);
  res.json({ dockerRunning, containers, endpoints, networks: { agentNetwork: true }, volumes: {}, errors: [] });
});

/**
 * Start/stop Docker containers
 */
// NOTE: Docker management from inside this container is not supported by default.
// The dashboard image does not install the Docker CLI or mount the Docker socket,
// so attempting to run `docker compose` here will fail in the default deployment.
// Control Docker from the host instead, or explicitly add in-container Docker support
// (install CLI, mount /var/run/docker.sock) with appropriate security review.
app.post('/api/docker/:action', async (req, res) => {
  const { action } = req.params;

  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid action' });
  }

  // Always return a warning unless Docker CLI is explicitly enabled in the container
  return res.status(501).json({
    success: false,
    action,
    error:
      'Docker management endpoints are disabled in this deployment. ' +
      'Please control Docker from the host or explicitly enable in-container Docker support.'
  });
});

/**
 * Get system information
 */
app.get('/api/system/info', async (req, res) => {
  try {
    const systemInfo = {
      platform: process.platform,
      nodeVersion: process.version,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: {
        port: PORT,
        llmEndpoints: Object.keys(LLM_CONFIG),
        nemoClawUrl: NEMOCLAW_URL
      }
    };

    // Check if we're running in Docker
    try {
      await execAsync('cat /proc/1/cgroup | head -1');
      systemInfo.inDocker = true;
    } catch {
      systemInfo.inDocker = false;
    }

    res.json({ success: true, system: systemInfo });
  } catch (error) {
    console.error('Error getting system info:', error);
    res.json({ success: false, error: 'Failed to get system info' });
  }
});

/**
 * Get available LLM models from all endpoints
 */
app.get('/api/models', async (req, res) => {
  try {
    const models = [];
    // Track which Docker Runner models we've already fetched (shared endpoint)
    let dockerRunnerFetched = false;
    let dockerRunnerModels = null;

    for (const [key, config] of Object.entries(LLM_CONFIG)) {
      try {
        if (config.apiStyle === 'openai') {
          // All docker-runner endpoints share the same host — fetch once
          if (!dockerRunnerFetched) {
            const response = await axios.get(`${config.url}/models`, { timeout: 5000 });
            // OpenAI format: { data: [{ id, ... }] }
            dockerRunnerModels = response.data.data?.map(m => ({
              id: key,
              endpoint: config.name,
              endpointUrl: config.url,
              backendType: config.backendType,
              type: config.type,
              name: m.id,
              model: m.id,
              size: 'unknown'
            })) || [];
            dockerRunnerFetched = true;
          }
          // Tag each runner model entry with this endpoint key
          if (dockerRunnerModels) {
            const tagged = dockerRunnerModels.map(m => ({ ...m, id: key, endpoint: config.name }));
            models.push(...tagged);
          }
        } else {
          // Ollama format: { models: [{ name, details: { parameter_size } }] }
          const response = await axios.get(`${config.url}/api/tags`, { timeout: 5000 });
          const endpointModels = response.data.models?.map(m => ({
            id: key,
            endpoint: config.name,
            endpointUrl: config.url,
            backendType: config.backendType,
            type: config.type,
            name: m.name,
            model: m.name.split(':')[0],
            size: m.details?.parameter_size || 'unknown'
          })) || [];
          models.push(...endpointModels);
        }
      } catch (error) {
        console.warn(`[WARNING] Could not reach ${config.name} (${config.url}):`, error.message);
      }
    }

    // Fallback if no models found
    if (models.length === 0) {
      for (const [key, config] of Object.entries(LLM_CONFIG)) {
        models.push({ id: key, endpoint: config.name, endpointUrl: config.url, backendType: config.backendType, type: config.type, name: config.defaultModel, model: config.defaultModel, size: 'unknown' });
      }
    }

    res.json({ success: true, models, endpoints: Object.keys(LLM_CONFIG) });
  } catch (error) {
    console.error('Error fetching models:', error.message);
    const fallback = Object.entries(LLM_CONFIG).map(([key, c]) => ({ id: key, endpoint: c.name, endpointUrl: c.url, backendType: c.backendType, type: c.type, name: c.defaultModel, model: c.defaultModel, size: 'unknown' }));
    res.json({ success: true, models: fallback, endpoints: Object.keys(LLM_CONFIG) });
  }
});

/**
 * Create a new agent session
 */
app.post('/api/sessions', (req, res) => {
  const {
    endpoint = 'primary',
    name = `session-${++sessionCounter}`,
    userId,
    userRole,
    experience = 'developer',
    safetyMode
  } = req.body;
  const model = req.body.model || LLM_CONFIG[endpoint]?.defaultModel || 'llama2:latest';

  const exp = EXPERIENCE_CONFIGS[experience] || EXPERIENCE_CONFIGS.developer;
  const resolvedSafetyMode = safetyMode || exp.safetyMode || 'standard';

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const session = {
    id: sessionId,
    name,
    model,
    endpoint,
    llmUrl: LLM_CONFIG[endpoint]?.url || LLM_CONFIG.primary.url,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: userId || 'anonymous',
    userRole: userRole || null,
    experience,
    safetyMode: resolvedSafetyMode
  };

  sessions.set(sessionId, session);

  eventBus.emit('session_start', {
    session_id: sessionId,
    user_id: session.userId,
    model,
    endpoint,
    experience,
    metadata: { safetyMode: resolvedSafetyMode, userRole: session.userRole }
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
      createdAt: session.createdAt
    }
  });
});

/**
 * Get all sessions
 */
app.get('/api/sessions', (req, res) => {
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
app.get('/api/sessions/:id', (req, res) => {
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
      createdAt: session.createdAt
    }
  });
});

/**
 * Send message to agent and get response
 */
app.post('/api/sessions/:id/message', async (req, res) => {
  const session = sessions.get(req.params.id);

  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  const { message, useSafeMode = false } = req.body;

  if (!message) {
    return res.status(400).json({ success: false, error: 'Message is required' });
  }

  const safetyMode = useSafeMode ? 'strict' : (session.safetyMode || 'standard');
  const safety = SAFETY_CONFIGS[safetyMode] || SAFETY_CONFIGS.standard;

  // ── Input Classification ──────────────────────────────────────────────────
  const classification = classifyInput(message);

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
    session.messages.push({ role: 'user', content: message, timestamp: new Date() });
    session.messages.push({ role: 'assistant', content: refusal, timestamp: new Date(), blocked: true });
    session.updatedAt = new Date();

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
  session.messages.push({ role: 'user', content: message, timestamp: new Date() });

  eventBus.emit('message_sent', {
    session_id: session.id,
    user_id: session.userId,
    model: session.model,
    endpoint: session.endpoint,
    experience: session.experience,
    metadata: { classification: classification.category, messageLength: message.length }
  });

  const msgStart = Date.now();

  try {
    const llmUrl = useSafeMode ? NEMOCLAW_URL : session.llmUrl;
    const apiStyle = useSafeMode ? 'ollama' : (LLM_CONFIG[session.endpoint]?.apiStyle || 'ollama');

    // ── Prompt Wrapping ───────────────────────────────────────────────────────
    const systemMessages = buildSystemMessages({ ...session, safetyMode });
    const historyMessages = session.messages.map(m => ({ role: m.role, content: m.content }));
    const msgs = [...systemMessages, ...historyMessages];

    let response;
    if (apiStyle === 'openai') {
      response = await axios.post(
        `${llmUrl}/chat/completions`,
        { model: session.model, messages: msgs, stream: false },
        { timeout: 60000 }
      );
    } else {
      response = await axios.post(
        `${llmUrl}/api/chat`,
        { model: session.model, messages: msgs, stream: false },
        { timeout: 60000 }
      );
    }

    const assistantMessage = response.data.message?.content || response.data.choices?.[0]?.message?.content || 'No response received';
    const latencyMs = Date.now() - msgStart;

    // ── Response Filter ───────────────────────────────────────────────────────
    const filterResult = filterResponse(assistantMessage, safetyMode);
    if (filterResult.flagged) {
      eventBus.emit('output_filtered', {
        session_id: session.id,
        user_id: session.userId,
        model: session.model,
        endpoint: session.endpoint,
        experience: session.experience,
        metadata: { flags: filterResult.flags }
      });
    }

    session.messages.push({ role: 'assistant', content: assistantMessage, timestamp: new Date(), filterFlags: filterResult.flags });
    session.updatedAt = new Date();

    eventBus.emit('message_received', {
      session_id: session.id,
      user_id: session.userId,
      model: session.model,
      endpoint: session.endpoint,
      experience: session.experience,
      metadata: { latencyMs, responseLength: assistantMessage.length, filterFlags: filterResult.flags }
    });

    res.json({
      success: true,
      response: assistantMessage,
      classification,
      filterFlags: filterResult.flags,
      endpoint: useSafeMode ? 'NemoClaw (Safe)' : session.endpoint,
      messageCount: session.messages.length
    });
  } catch (error) {
    console.error('Error calling LLM:', error.message);
    const errorMsg = `[Error] Could not reach LLM at ${session.llmUrl}: ${error.message}`;
    session.messages.push({ role: 'assistant', content: errorMsg, timestamp: new Date() });
    session.updatedAt = new Date();

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
 * Switch endpoint/model in a session
 */
app.put('/api/sessions/:id/model', (req, res) => {
  const session = sessions.get(req.params.id);

  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  const { endpoint, model } = req.body;

  if (!endpoint || !LLM_CONFIG[endpoint]) {
    return res.status(400).json({ success: false, error: 'Invalid endpoint' });
  }

  const prevEndpoint = session.endpoint;
  session.endpoint = endpoint;
  session.model = model || LLM_CONFIG[endpoint].defaultModel;
  session.llmUrl = LLM_CONFIG[endpoint].url;
  session.updatedAt = new Date();

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
app.delete('/api/sessions/:id', (req, res) => {
  const exists = sessions.has(req.params.id);

  if (exists) {
    const session = sessions.get(req.params.id);
    eventBus.emit('session_end', {
      session_id: req.params.id,
      user_id: session?.userId,
      model: session?.model,
      endpoint: session?.endpoint,
      experience: session?.experience,
      metadata: { messageCount: session?.messages.length }
    });
    sessions.delete(req.params.id);
  }

  res.json({ success: true, deleted: exists });
});

/**
 * Message feedback — thumbs up/down on a specific message index
 * POST /api/sessions/:id/feedback  { messageIndex, positive: true|false }
 */
app.post('/api/sessions/:id/feedback', (req, res) => {
  const session = sessions.get(req.params.id);

  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  const { messageIndex, positive } = req.body;
  if (typeof positive !== 'boolean') {
    return res.status(400).json({ success: false, error: 'positive (boolean) is required' });
  }

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

// ============ METRICS API ============

/**
 * GET /api/metrics/summary
 * Total sessions, messages, avg session length, model distribution, experience distribution
 */
app.get('/api/metrics/summary', (req, res) => {
  const allEvents = eventBus.getAll();
  const sessionStarts = allEvents.filter(e => e.event_type === 'session_start');
  const messagesSent = allEvents.filter(e => e.event_type === 'message_sent');

  // Model distribution from message_sent events
  const modelDist = {};
  messagesSent.forEach(e => {
    const key = e.model || 'unknown';
    modelDist[key] = (modelDist[key] || 0) + 1;
  });

  // Experience distribution
  const expDist = {};
  sessionStarts.forEach(e => {
    const key = e.experience || 'unknown';
    expDist[key] = (expDist[key] || 0) + 1;
  });

  // Avg messages per session (from active sessions)
  const sessionList = Array.from(sessions.values());
  const avgMessages = sessionList.length
    ? (sessionList.reduce((sum, s) => sum + s.messages.length, 0) / sessionList.length).toFixed(1)
    : 0;

  res.json({
    success: true,
    summary: {
      totalSessions: sessionStarts.length,
      activeSessions: sessions.size,
      totalMessages: messagesSent.length,
      avgMessagesPerSession: Number(avgMessages),
      modelDistribution: modelDist,
      experienceDistribution: expDist
    }
  });
});

/**
 * GET /api/metrics/safety
 * Input classifications, blocked inputs, output filter events over time
 */
app.get('/api/metrics/safety', (req, res) => {
  const allEvents = eventBus.getAll();

  const classified = allEvents.filter(e => e.event_type === 'input_classified');
  const blocked = allEvents.filter(e => e.event_type === 'input_blocked');
  const filtered = allEvents.filter(e => e.event_type === 'output_filtered');

  const classificationBreakdown = { safe: 0, sensitive: 0, blocked: 0 };
  classified.forEach(e => {
    const cat = e.metadata?.category || 'safe';
    classificationBreakdown[cat] = (classificationBreakdown[cat] || 0) + 1;
  });

  const blockReasons = {};
  blocked.forEach(e => {
    const reason = e.metadata?.reason || 'unknown';
    blockReasons[reason] = (blockReasons[reason] || 0) + 1;
  });

  const filterTypes = {};
  filtered.forEach(e => {
    (e.metadata?.flags || []).forEach(f => {
      filterTypes[f.type] = (filterTypes[f.type] || 0) + 1;
    });
  });

  res.json({
    success: true,
    safety: {
      totalClassified: classified.length,
      classificationBreakdown,
      totalBlocked: blocked.length,
      blockReasons,
      totalOutputsFiltered: filtered.length,
      filterTypes,
      recentBlocked: blocked.slice(-10).map(e => ({
        timestamp: e.timestamp,
        session_id: e.session_id,
        reason: e.metadata?.reason
      }))
    }
  });
});

/**
 * GET /api/metrics/feedback
 * Positive/negative ratio per model and per experience
 */
app.get('/api/metrics/feedback', (req, res) => {
  const allEvents = eventBus.getAll();
  const positive = allEvents.filter(e => e.event_type === 'feedback_positive');
  const negative = allEvents.filter(e => e.event_type === 'feedback_negative');

  const byModel = {};
  [...positive, ...negative].forEach(e => {
    const key = e.model || 'unknown';
    if (!byModel[key]) byModel[key] = { positive: 0, negative: 0 };
    if (e.event_type === 'feedback_positive') byModel[key].positive++;
    else byModel[key].negative++;
  });

  const byExperience = {};
  [...positive, ...negative].forEach(e => {
    const key = e.experience || 'unknown';
    if (!byExperience[key]) byExperience[key] = { positive: 0, negative: 0 };
    if (e.event_type === 'feedback_positive') byExperience[key].positive++;
    else byExperience[key].negative++;
  });

  res.json({
    success: true,
    feedback: {
      totalPositive: positive.length,
      totalNegative: negative.length,
      byModel,
      byExperience
    }
  });
});

/**
 * GET /api/metrics/errors
 * Error rate, error types, affected models
 */
app.get('/api/metrics/errors', (req, res) => {
  const allEvents = eventBus.getAll();
  const errors = allEvents.filter(e => e.event_type === 'error');
  const messages = allEvents.filter(e => e.event_type === 'message_sent');

  const byModel = {};
  errors.forEach(e => {
    const key = e.model || 'unknown';
    byModel[key] = (byModel[key] || 0) + 1;
  });

  const errorRate = messages.length > 0
    ? ((errors.length / messages.length) * 100).toFixed(1)
    : '0.0';

  // Errors in the last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recentErrors = eventBus.getSince(fiveMinAgo).filter(e => e.event_type === 'error');

  res.json({
    success: true,
    errors: {
      total: errors.length,
      errorRatePercent: Number(errorRate),
      byModel,
      recentCount: recentErrors.length,
      recent: recentErrors.slice(-10).map(e => ({
        timestamp: e.timestamp,
        session_id: e.session_id,
        model: e.model,
        error: e.metadata?.error
      }))
    }
  });
});

/**
 * GET /api/experiences
 * Return available experience configs for the UI
 */
app.get('/api/experiences', (req, res) => {
  res.json({ success: true, experiences: EXPERIENCE_CONFIGS });
});

/**
 * MCP Connectors — load connector definitions from config/connectors.json
 */
const CONNECTORS_PATH = join(__dirname, '..', 'config', 'connectors.json');

app.get('/api/connectors', (req, res) => {
  try {
    if (!existsSync(CONNECTORS_PATH)) {
      return res.json({ success: true, connectors: [] });
    }
    const raw = readFileSync(CONNECTORS_PATH, 'utf-8');
    const { connectors } = JSON.parse(raw);
    res.json({ success: true, connectors });
  } catch (err) {
    console.error('Error reading connectors config:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load connectors' });
  }
});

/**
 * MCP Proxy — forward requests to a named MCP connector's server.
 * POST /api/mcp/:connectorId/proxy  → proxies to <mcp_server>/mcp
 * GET  /api/mcp/:connectorId/health → proxies to <mcp_server>/health
 * GET  /api/mcp/:connectorId/metrics → proxies to <mcp_server>/metrics
 *
 * This keeps credentials (BB_MCP_URL) server-side and avoids CORS issues.
 */
function resolveConnectorUrl(connectorId) {
  if (connectorId === 'blackboard-learn') return BB_MCP_URL;
  // Extend here for additional MCP connectors
  return null;
}

app.use('/api/mcp/:connectorId', async (req, res) => {
  const { connectorId } = req.params;
  const baseUrl = resolveConnectorUrl(connectorId);

  if (!baseUrl) {
    return res.status(404).json({ success: false, error: `Unknown connector: ${connectorId}` });
  }

  // Map sub-path: /api/mcp/blackboard-learn/proxy → /mcp
  //               /api/mcp/blackboard-learn/health → /health
  //               /api/mcp/blackboard-learn/metrics → /metrics
  const subPath = req.path === '/proxy' ? '/mcp' : req.path;
  const target = `${baseUrl}${subPath}`;

  try {
    const proxyRes = await axios({
      method: req.method,
      url: target,
      headers: {
        ...req.headers,
        host: new URL(baseUrl).host,
      },
      data: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
      params: req.query,
      timeout: 30000,
      responseType: 'json',
      validateStatus: () => true, // pass all status codes through
    });

    res.status(proxyRes.status);
    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      // skip hop-by-hop headers
      if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });
    res.json(proxyRes.data);
  } catch (err) {
    console.error(`[MCP Proxy] ${connectorId} → ${target}:`, err.message);
    res.status(502).json({ success: false, error: `MCP connector unreachable: ${err.message}` });
  }
});

/**
 * Health check - Comprehensive system status including recent error rates
 */
app.get('/api/health', async (req, res) => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recentEvents = eventBus.getSince(fiveMinAgo);
  const recentErrors = recentEvents.filter(e => e.event_type === 'error');
  const recentMessages = recentEvents.filter(e => e.event_type === 'message_sent');

  const health = {
    status: 'ok',
    timestamp: new Date(),
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      platform: process.platform
    },
    endpoints: {},
    sessions: {
      active: sessions.size,
      totalCreated: sessionCounter
    },
    observability: {
      totalEvents: eventBus.getAll().length,
      recentErrors: recentErrors.length,
      recentMessages: recentMessages.length,
      errorRateLast5Min: recentMessages.length > 0
        ? Number(((recentErrors.length / recentMessages.length) * 100).toFixed(1))
        : 0
    }
  };

  // Check LLM endpoints
  const checkedRunnerUrl = new Set();
  for (const [key, config] of Object.entries(LLM_CONFIG)) {
    try {
      const healthUrl = config.apiStyle === 'openai'
        ? `${config.url}/models`
        : `${config.url}/api/tags`;
      if (checkedRunnerUrl.has(healthUrl)) {
        health.endpoints[key] = health.endpoints['docker_runner'] || 'unavailable';
        continue;
      }
      checkedRunnerUrl.add(healthUrl);
      await axios.get(healthUrl, { timeout: 3000 });
      health.endpoints[key] = 'healthy';
    } catch {
      health.endpoints[key] = 'unavailable';
      if (key === 'primary') health.status = 'critical';
      else if (health.status === 'ok') health.status = 'degraded';
    }
  }

  res.json(health);
});

// Serve SPA
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║  Agent Dashboard Server Started        ║`);
  console.log(`╠════════════════════════════════════════╣`);
  console.log(`║  🌐 Dashboard: http://localhost:${PORT}       ║`);
  console.log(`╚════════════════════════════════════════╝`);
  console.log(`\n📍 LLM Endpoints:`);
  for (const [key, config] of Object.entries(LLM_CONFIG)) {
    console.log(`   • ${config.name} (${key}): ${config.url}`);
  }
  console.log(`\n🛡️  Safe Mode URL: ${NEMOCLAW_URL}`);
  console.log(`\n🔌 MCP Connectors:`);
  console.log(`   • Blackboard Learn: ${BB_MCP_URL}`);
  console.log(`\nPress Ctrl+C to stop\n`);
});
