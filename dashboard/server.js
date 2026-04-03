import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import { WebSocketServer } from 'ws';
import {
  getStatus as getPersistenceStatus,
  initPersistence,
  markSessionEnded,
  persistEvent,
  upsertSessionContext,
} from './persistence.js';
import {
  getStatus as getTracingStatus,
  initTracing,
  withSpan,
  recordEvent,
  shutdown as shutdownTracing,
} from './tracing.js';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const execAsync = promisify(exec);

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
const BB_MCP_ENABLED = isTruthyEnv(process.env.BB_MCP_ENABLED);
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 4000);
const MAX_OUTPUT_CHARS = Number(process.env.MAX_OUTPUT_CHARS || 5000);

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

const PUBLIC_DEMO_MODE = isTruthyEnv(process.env.PUBLIC_DEMO_MODE);
const DEMO_EXPERIENCE = 'safechat';

function resolveRequestedExperience(requestedExperience) {
  if (PUBLIC_DEMO_MODE) {
    return DEMO_EXPERIENCE;
  }
  return requestedExperience;
}

// Detect Docker once at startup — this never changes at runtime
const IN_DOCKER = existsSync('/.dockerenv');

// Session management
const sessions = new Map();
let sessionCounter = 0;
const SAFETY_RANK = { research: 0, standard: 1, strict: 2 };
const tasks = new Map();
let taskCounter = 0;
const TASK_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'completed']);
const TASK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

function logStructured(level, eventType, data = {}) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    eventType,
    ...data
  });

  if (level === 'error') {
    console.error(payload);
    return;
  }

  if (level === 'warn') {
    console.warn(payload);
    return;
  }

  console.log(payload);
}

function normalizeTaskStatus(value) {
  if (!value) return 'pending';
  const normalized = String(value).toLowerCase();
  return TASK_STATUSES.has(normalized) ? normalized : null;
}

function normalizeTaskPriority(value) {
  if (!value) return 'medium';
  const normalized = String(value).toLowerCase();
  return TASK_PRIORITIES.has(normalized) ? normalized : null;
}

function buildTaskSummary(task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    sessionId: task.sessionId,
    assignedSessionName: task.assignedSessionName,
    assignedUserId: task.assignedUserId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt || null
  };
}

function resolveTaskAssignment(sessionId) {
  if (!sessionId) {
    return { sessionId: null, assignedSessionName: null, assignedUserId: null };
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  return {
    sessionId,
    assignedSessionName: session.name,
    assignedUserId: session.userId
  };
}

async function checkHttpService(url, timeoutMs = 3000) {
  await axios.get(url, { timeout: timeoutMs });
}

async function checkTcpService(url, timeoutMs = 3000) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === 'https:'
      ? 443
      : 80;

  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish());
    socket.on('timeout', () => finish(new Error('timeout')));
    socket.on('error', (error) => finish(error));
  });
}

function normalizeOllamaModelName(modelName = '') {
  return String(modelName).trim().replace(/:latest$/i, '');
}

async function getOllamaModelNames(baseUrl) {
  const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 5000 });
  return response.data.models?.map((model) => model.name).filter(Boolean) || [];
}

async function ensureRunnableModelForSession(session) {
  const endpointConfig = LLM_CONFIG[session.endpoint] || LLM_CONFIG.primary;
  if (endpointConfig.apiStyle !== 'ollama') {
    return { adjusted: false, reason: 'non_ollama_endpoint' };
  }

  const availableModels = await getOllamaModelNames(session.llmUrl);
  if (!availableModels.length) {
    return { adjusted: false, reason: 'no_models' };
  }

  const normalizedCurrent = normalizeOllamaModelName(session.model);
  const matchingModel = availableModels.find(
    (available) => normalizeOllamaModelName(available) === normalizedCurrent
  );

  if (matchingModel) {
    if (session.model !== matchingModel) {
      session.model = matchingModel;
      return { adjusted: true, reason: 'normalized_match', model: matchingModel };
    }
    return { adjusted: false };
  }

  const fallbackModel = availableModels.includes(endpointConfig.defaultModel)
    ? endpointConfig.defaultModel
    : availableModels[0];

  if (session.model !== fallbackModel) {
    session.model = fallbackModel;
    return { adjusted: true, reason: 'fallback_available', model: fallbackModel };
  }

  return { adjusted: false };
}

function coerceModelForEndpoint(endpoint, requestedModel) {
  const endpointConfig = LLM_CONFIG[endpoint] || LLM_CONFIG.primary;
  if (!requestedModel) {
    return endpointConfig.defaultModel;
  }

  if (
    endpointConfig.apiStyle === 'ollama' &&
    (requestedModel.startsWith('docker.io/') || requestedModel.startsWith('ai/'))
  ) {
    return endpointConfig.defaultModel;
  }

  return requestedModel;
}

function getAvailabilityFallbackEndpoint() {
  const candidate = Object.entries(LLM_CONFIG).find(([, config]) => config.apiStyle === 'openai');
  return candidate?.[0] || null;
}

/**
 * Pure helper — checks whether a specific model ID exists in the Docker Model Runner
 * models-list response (OpenAI /v1/models format: { data: [{ id, ... }] }).
 * Strips :latest suffix for comparison so both 'ai/foo:latest' and 'ai/foo' match.
 */
function checkModelInRunnerList(modelsList, modelId) {
  if (!Array.isArray(modelsList) || !modelId) return false;
  const normalise = (s) => String(s).replace(/:latest$/i, '').toLowerCase();
  const target = normalise(modelId);
  return modelsList.some((m) => normalise(m.id ?? m.name ?? '') === target);
}

/** Fetches the Docker Model Runner /v1/models list and returns the data array. */
async function fetchDockerRunnerModels(baseUrl, timeoutMs = 4000) {
  const response = await axios.get(`${baseUrl}/models`, { timeout: timeoutMs });
  return response.data?.data || [];
}

// ============ EVENT BUS ============
// Lightweight in-memory pub/sub — events fire-and-forget so they never block the UX.
// Swap the `_store` array for a DB write in persist() when Postgres is available.
const _eventStore = [];
const MAX_EVENTS = 10000;
const _eventSubscribers = new Set();

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

    for (const listener of _eventSubscribers) {
      try {
        listener(event);
      } catch (error) {
        logStructured('warn', 'event_subscriber_failed', { error: error.message });
      }
    }

    persistEvent(event, logStructured);

    return event;
  },
  getAll() { return _eventStore; },
  getByType(type) { return _eventStore.filter(e => e.event_type === type); },
  getSince(iso) {
    const since = new Date(iso).getTime();
    return _eventStore.filter(e => new Date(e.timestamp).getTime() >= since);
  },
  subscribe(listener) {
    _eventSubscribers.add(listener);
    return () => _eventSubscribers.delete(listener);
  }
};

await initTracing(logStructured);
await initPersistence(logStructured);

let wsEventServerAttached = false;

function attachEventWebSocketServer(server) {
  if (!server || wsEventServerAttached) {
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith('/ws/events')) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  });

  wss.on('connection', (client) => {
    client.send(JSON.stringify({ type: 'hello', timestamp: new Date().toISOString() }));
  });

  const unsubscribe = eventBus.subscribe((event) => {
    const payload = JSON.stringify({ type: 'event', event });
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    });
  });

  server.on('close', () => {
    unsubscribe();
    wss.close();
    wsEventServerAttached = false;
  });

  wsEventServerAttached = true;
}

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

function isKnownExperience(experience) {
  return Object.prototype.hasOwnProperty.call(EXPERIENCE_CONFIGS, experience);
}

function isKnownSafetyMode(safetyMode) {
  return Object.prototype.hasOwnProperty.call(SAFETY_CONFIGS, safetyMode);
}

function getExperienceConfig(experience) {
  return EXPERIENCE_CONFIGS[experience] || EXPERIENCE_CONFIGS.developer;
}

function getAllowedEndpoints(experience) {
  return getExperienceConfig(experience).availableEndpoints || ['primary'];
}

function getPublicExperienceConfigs() {
  if (!PUBLIC_DEMO_MODE) {
    return EXPERIENCE_CONFIGS;
  }

  return { safechat: EXPERIENCE_CONFIGS.safechat };
}

function isEndpointAllowed(experience, endpoint) {
  return getAllowedEndpoints(experience).includes(endpoint);
}

function resolveSessionEndpoint(experience, requestedEndpoint) {
  if (isEndpointAllowed(experience, requestedEndpoint)) {
    return requestedEndpoint;
  }

  return getAllowedEndpoints(experience)[0] || 'primary';
}

function resolveConfiguredSafetyMode(experience, requestedSafetyMode) {
  const baseSafetyMode = getExperienceConfig(experience).safetyMode || 'standard';

  if (!requestedSafetyMode) {
    return baseSafetyMode;
  }

  return SAFETY_RANK[requestedSafetyMode] >= SAFETY_RANK[baseSafetyMode]
    ? requestedSafetyMode
    : baseSafetyMode;
}

function resolveEffectiveSafetyMode(session, useSafeMode = false) {
  const configuredSafetyMode = session.safetyMode || getExperienceConfig(session.experience).safetyMode || 'standard';

  if (configuredSafetyMode === 'strict' || useSafeMode) {
    return 'strict';
  }

  return configuredSafetyMode;
}

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

function redactSensitiveText(text) {
  return text
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted email]')
    .replace(/(?:\+?1[-.\s])?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, '[redacted ssn]')
    .replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[redacted credit card]');
}

function sanitizeResponse(text, safetyMode = 'standard') {
  const filterResult = filterResponse(text, safetyMode);

  if (!filterResult.flagged) {
    return { ...filterResult, content: text, blocked: false, redacted: false };
  }

  const hasHarmfulContent = filterResult.flags.some((flag) => flag.type === 'harmful_content');
  if (hasHarmfulContent) {
    return {
      ...filterResult,
      content: "I can't provide that response. If you'd like, I can still help with a safer alternative.",
      blocked: true,
      redacted: false
    };
  }

  const redactedContent = redactSensitiveText(text);
  return {
    ...filterResult,
    content: redactedContent,
    blocked: false,
    redacted: redactedContent !== text
  };
}

function normalizePromptText(text = '') {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

async function runPromptHandlers(rawMessage, session, safetyMode) {
  const normalized = normalizePromptText(rawMessage);

  if (!normalized) {
    return {
      handled: true,
      blocked: true,
      classification: { category: 'blocked', reason: 'empty_message' },
      response: 'Please enter a message before sending.'
    };
  }

  if (normalized.length > MAX_INPUT_CHARS) {
    return {
      handled: true,
      blocked: true,
      classification: { category: 'blocked', reason: 'message_too_long' },
      response: `Your message is too long (${normalized.length} chars). Please keep it under ${MAX_INPUT_CHARS} characters.`
    };
  }

  if (normalized === '/safety') {
    return {
      handled: true,
      blocked: false,
      classification: { category: 'safe', reason: 'handler_safety' },
      response: `Safety mode: ${safetyMode}. Endpoint: ${session.endpoint}. Model: ${session.model}`
    };
  }

  if (normalized === '/bb-health') {
    if (!BB_MCP_ENABLED) {
      return {
        handled: true,
        blocked: false,
        classification: { category: 'safe', reason: 'handler_bb_health_disabled' },
        response: 'Blackboard MCP is disabled. Set BB_MCP_ENABLED=true to enable bb-mcp checks and proxy routes.'
      };
    }

    try {
      const resp = await axios.get(`${BB_MCP_URL}/health`, { timeout: 4000 });
      const status = resp.data?.status || 'unknown';
      const name = resp.data?.name || 'bb-mcp';
      return {
        handled: true,
        blocked: false,
        classification: { category: 'safe', reason: 'handler_bb_health' },
        response: `Blackboard MCP is reachable. Service: ${name}. Status: ${status}.`
      };
    } catch (error) {
      return {
        handled: true,
        blocked: false,
        classification: { category: 'safe', reason: 'handler_bb_health' },
        response: `Blackboard MCP check failed: ${error.message}`
      };
    }
  }

  if (normalized === '/nemoclaw-health') {
    try {
      await axios.get(`${NEMOCLAW_URL}/`, { timeout: 4000 });
      return {
        handled: true,
        blocked: false,
        classification: { category: 'safe', reason: 'handler_nemoclaw_health' },
        response: 'NemoClaw gateway is reachable.'
      };
    } catch (error) {
      return {
        handled: true,
        blocked: false,
        classification: { category: 'safe', reason: 'handler_nemoclaw_health' },
        response: `NemoClaw check failed: ${error.message}`
      };
    }
  }

  return { handled: false, blocked: false, message: normalized };
}

function applyOutputControls(text = '', safetyMode = 'standard') {
  const clean = String(text).replace(/\r\n/g, '\n').trim();
  const maxChars = safetyMode === 'strict' ? Math.min(MAX_OUTPUT_CHARS, 3500) : MAX_OUTPUT_CHARS;
  const truncated = clean.length > maxChars;
  const content = truncated
    ? `${clean.slice(0, maxChars)}\n\n[response truncated to ${maxChars} chars]`
    : clean;

  return { content, truncated, maxChars };
}

function calculateAverageMessagesPerSession(allEvents, activeSessions) {
  const sessionMessageCounts = new Map();

  allEvents
    .filter((event) => event.event_type === 'session_start')
    .forEach((event) => {
      sessionMessageCounts.set(event.session_id, 0);
    });

  allEvents
    .filter((event) => event.event_type === 'session_end')
    .forEach((event) => {
      sessionMessageCounts.set(event.session_id, event.metadata?.messageCount || 0);
    });

  activeSessions.forEach((session) => {
    sessionMessageCounts.set(session.id, session.messages.length);
  });

  if (sessionMessageCounts.size === 0) {
    return 0;
  }

  const totalMessages = Array.from(sessionMessageCounts.values()).reduce((sum, count) => sum + count, 0);
  return Number((totalMessages / sessionMessageCounts.size).toFixed(1));
}

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    logStructured('info', 'api_request', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      sessionId: req.params?.id || req.body?.sessionId || req.body?.session_id || null
    });
  });

  next();
});

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
      backendType: 'ollama-container',
      checkType: 'http'
    },
    {
      name: 'docker-runner',
      label: 'Docker Model Runner',
      // Docker Model Runner: OpenAI-compatible, /v1/models lists pulled models
      url: `${DOCKER_RUNNER_URL}/models`,
      ports: 'host-internal',
      backendType: 'docker-runner',
      checkType: 'http'
    },
    {
      name: 'nemoclaw',
      label: 'NemoClaw (sandbox)',
      url: `${NEMOCLAW_URL}/`,
      ports: '9000:8080',
      backendType: 'sandbox',
      checkType: 'tcp'
    }
  ];

  if (BB_MCP_ENABLED) {
    serviceChecks.push({
      name: 'bb-mcp',
      label: 'Blackboard Learn MCP',
      url: `${BB_MCP_URL}/health`,
      ports: '3100:3100',
      backendType: 'mcp',
      checkType: 'http'
    });
  }

  const containers = {};
  for (const { name, label, url, ports, backendType, checkType } of serviceChecks) {
    try {
      if (checkType === 'tcp') {
        await checkTcpService(url, 3000);
      } else {
        await checkHttpService(url, 3000);
      }
      containers[name] = { running: true, status: 'healthy', ports, backendType, label };
    } catch {
      containers[name] = { running: false, status: 'unavailable', ports, backendType, label };
    }
  }

  // Per-endpoint LLM status — derived from the service checks above
  const runnerLive = containers['docker-runner']?.running ?? false;

  // When runner is up, check each docker-runner endpoint's model is actually pulled.
  let runnerModels = [];
  if (runnerLive) {
    try { runnerModels = await fetchDockerRunnerModels(DOCKER_RUNNER_URL); } catch { /* runner up but models list unavailable */ }
  }

  const endpoints = {};
  for (const [key, config] of Object.entries(LLM_CONFIG)) {
    if (config.backendType === 'ollama-container') {
      const ollamaUp = containers['ollama']?.running ?? false;
      endpoints[key] = { name: config.name, model: config.defaultModel, backendType: config.backendType, live: ollamaUp, fallback: !ollamaUp };
    } else if (config.backendType === 'docker-runner') {
      const modelLoaded = runnerLive && checkModelInRunnerList(runnerModels, config.defaultModel);
      endpoints[key] = { name: config.name, model: config.defaultModel, backendType: config.backendType, live: modelLoaded, modelLoaded, runnerLive, fallback: !modelLoaded };
    } else {
      endpoints[key] = { name: config.name, model: config.defaultModel, backendType: config.backendType, live: false, fallback: true };
    }
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
        nemoClawUrl: NEMOCLAW_URL,
        persistence: getPersistenceStatus(),
        tracing: getTracingStatus()
      }
    };

    // Check if we're running in Docker (/.dockerenv is created by Docker daemon)
    systemInfo.inDocker = existsSync('/.dockerenv');

    res.json({ success: true, system: systemInfo });
  } catch (error) {
    logStructured('error', 'system_info_failed', { error: error.message });
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
          logStructured('warn', 'model_endpoint_unreachable', {
            endpoint: key,
            endpointName: config.name,
            error: error.message
          });
      }
    }

    // Fallback if no models found
    if (models.length === 0) {
      for (const [key, config] of Object.entries(LLM_CONFIG)) {
        models.push({ id: key, endpoint: config.name, endpointUrl: config.url, backendType: config.backendType, type: config.type, name: config.defaultModel, model: config.defaultModel, size: 'unknown' });
      }
    }

    const filteredModels = PUBLIC_DEMO_MODE
      ? models.filter((m) => m.id === 'primary')
      : models;

    const fallbackModels = filteredModels.length > 0
      ? filteredModels
      : [{
          id: 'primary',
          endpoint: LLM_CONFIG.primary.name,
          endpointUrl: LLM_CONFIG.primary.url,
          backendType: LLM_CONFIG.primary.backendType,
          type: LLM_CONFIG.primary.type,
          name: LLM_CONFIG.primary.defaultModel,
          model: LLM_CONFIG.primary.defaultModel,
          size: 'unknown'
        }];

    res.json({
      success: true,
      models: fallbackModels,
      endpoints: PUBLIC_DEMO_MODE ? ['primary'] : Object.keys(LLM_CONFIG),
      demoMode: PUBLIC_DEMO_MODE
    });
  } catch (error) {
    logStructured('error', 'models_fetch_failed', { error: error.message });
    const fallback = Object.entries(LLM_CONFIG).map(([key, c]) => ({ id: key, endpoint: c.name, endpointUrl: c.url, backendType: c.backendType, type: c.type, name: c.defaultModel, model: c.defaultModel, size: 'unknown' }));
    const filteredFallback = PUBLIC_DEMO_MODE ? fallback.filter((m) => m.id === 'primary') : fallback;
    res.json({ success: true, models: filteredFallback, endpoints: PUBLIC_DEMO_MODE ? ['primary'] : Object.keys(LLM_CONFIG), demoMode: PUBLIC_DEMO_MODE });
  }
});

app.get('/api/demo-mode', (req, res) => {
  res.json({
    success: true,
    enabled: PUBLIC_DEMO_MODE,
    enforcedExperience: PUBLIC_DEMO_MODE ? DEMO_EXPERIENCE : null,
    allowedEndpoints: PUBLIC_DEMO_MODE ? ['primary'] : Object.keys(LLM_CONFIG),
    websocketPath: '/ws/events'
  });
});

app.get('/api/persistence/status', (req, res) => {
  res.json({ success: true, persistence: getPersistenceStatus() });
});

app.get('/api/tracing/status', (req, res) => {
  res.json({ success: true, tracing: getTracingStatus() });
});

/**
 * Create a new agent session
 */
app.post('/api/sessions', (req, res) => {
  const {
    endpoint: requestedEndpoint = 'primary',
    name = `session-${++sessionCounter}`,
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
    ? LLM_CONFIG[endpoint]?.defaultModel || 'llama2:latest'
    : coerceModelForEndpoint(endpoint, req.body.model) || LLM_CONFIG[endpoint]?.defaultModel || 'llama2:latest';
  const resolvedSafetyMode = resolveConfiguredSafetyMode(experience, safetyMode);

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
app.post('/api/sessions/:id/message', async (req, res) => {
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
    let llmUrl = session.llmUrl;
    let apiStyle = LLM_CONFIG[session.endpoint]?.apiStyle || 'ollama';

    const modelResolution = await ensureRunnableModelForSession(session);
    if (modelResolution.reason === 'no_models') {
      const fallbackEndpoint = getAvailabilityFallbackEndpoint();
      if (fallbackEndpoint && fallbackEndpoint !== session.endpoint) {
        const previousEndpoint = session.endpoint;
        session.endpoint = fallbackEndpoint;
        session.llmUrl = LLM_CONFIG[fallbackEndpoint].url;
        session.model = LLM_CONFIG[fallbackEndpoint].defaultModel;
        session.updatedAt = new Date();
        llmUrl = session.llmUrl;
        apiStyle = LLM_CONFIG[fallbackEndpoint].apiStyle;

        eventBus.emit('endpoint_auto_fallback', {
          session_id: session.id,
          user_id: session.userId,
          model: session.model,
          endpoint: session.endpoint,
          experience: session.experience,
          metadata: {
            from: previousEndpoint,
            to: fallbackEndpoint,
            reason: 'ollama_no_models'
          }
        });
      }
    } else if (modelResolution.adjusted) {
      session.updatedAt = new Date();
      eventBus.emit('model_auto_corrected', {
        session_id: session.id,
        user_id: session.userId,
        model: session.model,
        endpoint: session.endpoint,
        experience: session.experience,
        metadata: {
          reason: modelResolution.reason,
          resolvedModel: modelResolution.model
        }
      });
    }

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
    const sanitizedResponse = sanitizeResponse(assistantMessage, safetyMode);
    const outputControlled = applyOutputControls(sanitizedResponse.content, safetyMode);
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
      messageCount: session.messages.length
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
app.post('/api/sessions/:id/stream', async (req, res) => {
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

  const llmUrl = useSafeMode ? NEMOCLAW_URL : session.llmUrl;
  const apiStyle = useSafeMode ? 'ollama' : (LLM_CONFIG[session.endpoint]?.apiStyle || 'ollama');
  const msgs = session.messages.map(m => ({ role: m.role, content: m.content }));

  let fullContent = '';

  try {
    const streamResponse = await axios.post(
      apiStyle === 'openai' ? `${llmUrl}/chat/completions` : `${llmUrl}/api/chat`,
      { model: session.model, messages: msgs, stream: true },
      { responseType: 'stream', timeout: 120000 }
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
      send({ type: 'done', messageCount: session.messages.length });
      res.end();
    });

    streamResponse.data.on('error', (err) => {
      console.error('[Stream] LLM stream error:', err.message);
      const errMsg = `[Error] Stream failed: ${err.message}`;
      if (!fullContent) {
        session.messages.push({ role: 'assistant', content: errMsg, timestamp: new Date() });
        session.updatedAt = new Date();
      }
      send({ type: 'error', message: errMsg });
      res.end();
    });

    req.on('close', () => {
      streamResponse.data.destroy();
    });
  } catch (error) {
    console.error('[Stream] Error starting LLM stream:', error.message);
    const errMsg = `[Error] Could not reach LLM at ${llmUrl}: ${error.message}`;
    session.messages.push({ role: 'assistant', content: errMsg, timestamp: new Date() });
    session.updatedAt = new Date();
    send({ type: 'error', message: errMsg });
    res.end();
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

  if (!isEndpointAllowed(session.experience, endpoint)) {
    return res.status(403).json({ success: false, error: 'Endpoint is not allowed for this experience' });
  }

  if (PUBLIC_DEMO_MODE && endpoint !== 'primary') {
    return res.status(403).json({ success: false, error: 'Public demo mode only allows the primary endpoint' });
  }

  const prevEndpoint = session.endpoint;
  session.endpoint = endpoint;
  session.model = coerceModelForEndpoint(endpoint, model) || LLM_CONFIG[endpoint].defaultModel;
  session.llmUrl = LLM_CONFIG[endpoint].url;
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
app.delete('/api/sessions/:id', (req, res) => {
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
app.post('/api/sessions/:id/feedback', (req, res) => {
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

/**
 * Task Queue API
 * Lightweight in-memory queue for visibility and routing.
 */

app.get('/api/tasks', (req, res) => {
  const { status, sessionId } = req.query;
  const normalizedStatus = status ? normalizeTaskStatus(status) : null;

  if (status && !normalizedStatus) {
    return res.status(400).json({ success: false, error: 'Invalid status filter' });
  }

  const items = Array.from(tasks.values())
    .filter((task) => (normalizedStatus ? task.status === normalizedStatus : true))
    .filter((task) => (sessionId ? task.sessionId === sessionId : true))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(buildTaskSummary);

  const byStatus = { pending: 0, in_progress: 0, blocked: 0, completed: 0 };
  items.forEach((task) => {
    byStatus[task.status] = (byStatus[task.status] || 0) + 1;
  });

  res.json({
    success: true,
    tasks: items,
    summary: {
      total: items.length,
      byStatus
    }
  });
});

app.post('/api/tasks', (req, res) => {
  const {
    title,
    description = '',
    priority,
    sessionId
  } = req.body || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ success: false, error: 'title is required' });
  }

  const normalizedPriority = normalizeTaskPriority(priority);
  if (!normalizedPriority) {
    return res.status(400).json({ success: false, error: 'Invalid priority' });
  }

  const assignment = resolveTaskAssignment(sessionId);
  if (sessionId && !assignment) {
    return res.status(400).json({ success: false, error: 'Assigned session does not exist' });
  }

  const taskId = `task_${Date.now()}_${++taskCounter}`;
  const now = new Date();
  const task = {
    id: taskId,
    title: title.trim().slice(0, 140),
    description: typeof description === 'string' ? description.trim().slice(0, 2000) : '',
    status: 'pending',
    priority: normalizedPriority,
    sessionId: assignment?.sessionId || null,
    assignedSessionName: assignment?.assignedSessionName || null,
    assignedUserId: assignment?.assignedUserId || null,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };

  tasks.set(taskId, task);

  eventBus.emit('task_created', {
    session_id: task.sessionId,
    user_id: task.assignedUserId || 'anonymous',
    model: null,
    endpoint: null,
    experience: null,
    metadata: {
      taskId,
      status: task.status,
      priority: task.priority,
      hasAssignment: Boolean(task.sessionId)
    }
  });

  if (task.sessionId) {
    eventBus.emit('task_routed', {
      session_id: task.sessionId,
      user_id: task.assignedUserId || 'anonymous',
      model: null,
      endpoint: null,
      experience: null,
      metadata: {
        taskId,
        toSessionId: task.sessionId
      }
    });
  }

  res.json({ success: true, task: buildTaskSummary(task) });
});

app.put('/api/tasks/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  const {
    title,
    description,
    status,
    priority,
    sessionId
  } = req.body || {};

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: 'title must be a non-empty string' });
    }
    task.title = title.trim().slice(0, 140);
  }

  if (description !== undefined) {
    if (typeof description !== 'string') {
      return res.status(400).json({ success: false, error: 'description must be a string' });
    }
    task.description = description.trim().slice(0, 2000);
  }

  if (priority !== undefined) {
    const normalizedPriority = normalizeTaskPriority(priority);
    if (!normalizedPriority) {
      return res.status(400).json({ success: false, error: 'Invalid priority' });
    }
    task.priority = normalizedPriority;
  }

  if (status !== undefined) {
    const normalizedStatus = normalizeTaskStatus(status);
    if (!normalizedStatus) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    if (task.status !== normalizedStatus) {
      task.status = normalizedStatus;
      eventBus.emit('task_status_changed', {
        session_id: task.sessionId,
        user_id: task.assignedUserId || 'anonymous',
        model: null,
        endpoint: null,
        experience: null,
        metadata: {
          taskId: task.id,
          status: normalizedStatus
        }
      });
    }
  }

  if (sessionId !== undefined) {
    const assignment = resolveTaskAssignment(sessionId);
    if (sessionId && !assignment) {
      return res.status(400).json({ success: false, error: 'Assigned session does not exist' });
    }

    const previousSessionId = task.sessionId;
    task.sessionId = assignment?.sessionId || null;
    task.assignedSessionName = assignment?.assignedSessionName || null;
    task.assignedUserId = assignment?.assignedUserId || null;

    if (previousSessionId !== task.sessionId) {
      eventBus.emit('task_routed', {
        session_id: task.sessionId,
        user_id: task.assignedUserId || 'anonymous',
        model: null,
        endpoint: null,
        experience: null,
        metadata: {
          taskId: task.id,
          fromSessionId: previousSessionId,
          toSessionId: task.sessionId
        }
      });
    }
  }

  if (task.status === 'completed' && !task.completedAt) {
    task.completedAt = new Date();
    eventBus.emit('task_completed', {
      session_id: task.sessionId,
      user_id: task.assignedUserId || 'anonymous',
      model: null,
      endpoint: null,
      experience: null,
      metadata: {
        taskId: task.id,
        priority: task.priority
      }
    });
  }

  if (task.status !== 'completed') {
    task.completedAt = null;
  }

  task.updatedAt = new Date();
  tasks.set(task.id, task);

  res.json({ success: true, task: buildTaskSummary(task) });
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  tasks.delete(req.params.id);
  eventBus.emit('task_deleted', {
    session_id: task.sessionId,
    user_id: task.assignedUserId || 'anonymous',
    model: null,
    endpoint: null,
    experience: null,
    metadata: {
      taskId: task.id,
      status: task.status
    }
  });

  res.json({ success: true, deleted: true });
});

/**
 * GET /api/sessions/:id/tasks
 * Convenience: return only tasks assigned to a specific session.
 */
app.get('/api/sessions/:id/tasks', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  const sessionTasks = Array.from(tasks.values())
    .filter((t) => t.sessionId === req.params.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(buildTaskSummary);

  const byStatus = { pending: 0, in_progress: 0, blocked: 0, completed: 0 };
  sessionTasks.forEach((t) => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });

  res.json({ success: true, tasks: sessionTasks, summary: { total: sessionTasks.length, byStatus } });
});

// ============ WEBHOOKS ============

const ALLOWED_WEBHOOK_EVENTS = new Set([
  'ci_pass', 'ci_fail', 'deploy', 'deploy_fail',
  'alert', 'review_requested', 'pr_merged', 'custom'
]);

/**
 * POST /api/webhooks/trigger
 * Receive an external trigger, emit a webhook_received event, and optionally
 * create a task from the payload.
 *
 * Body: { event, source, payload?, createTask?: { title, priority, sessionId? } }
 */
app.post('/api/webhooks/trigger', (req, res) => {
  const { event: eventName, source = 'external', payload = {}, createTask: taskSpec } = req.body || {};

  if (!eventName || typeof eventName !== 'string' || !eventName.trim()) {
    return res.status(400).json({ success: false, error: 'event is required' });
  }

  const normalizedEvent = eventName.trim().toLowerCase();
  if (!ALLOWED_WEBHOOK_EVENTS.has(normalizedEvent)) {
    return res.status(400).json({
      success: false,
      error: `Unknown event type '${normalizedEvent}'. Allowed: ${Array.from(ALLOWED_WEBHOOK_EVENTS).join(', ')}`
    });
  }

  if (typeof source !== 'string' || source.length > 80) {
    return res.status(400).json({ success: false, error: 'source must be a string ≤ 80 chars' });
  }

  if (payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
    return res.status(400).json({ success: false, error: 'payload must be an object' });
  }

  const webhookEvent = eventBus.emit('webhook_received', {
    session_id: null,
    user_id: 'webhook',
    model: null,
    endpoint: null,
    experience: null,
    metadata: {
      webhookEvent: normalizedEvent,
      source,
      payload
    }
  });

  let createdTask = null;
  if (taskSpec !== undefined && taskSpec !== null) {
    if (typeof taskSpec !== 'object' || Array.isArray(taskSpec)) {
      return res.status(400).json({ success: false, error: 'createTask must be an object' });
    }
    if (typeof taskSpec.title !== 'string' || !taskSpec.title.trim()) {
      return res.status(400).json({ success: false, error: 'createTask.title must be a non-empty string' });
    }
    const priority = taskSpec.priority === undefined ? 'medium' : normalizeTaskPriority(taskSpec.priority);
    if (!priority) {
      return res.status(400).json({ success: false, error: 'createTask.priority must be one of: low, medium, high, urgent' });
    }
    const assignment = taskSpec.sessionId ? resolveTaskAssignment(taskSpec.sessionId) : null;

    if (taskSpec.sessionId && !assignment) {
      return res.status(400).json({ success: false, error: 'createTask.sessionId does not match a live session' });
    }

    const taskId = `task_${Date.now()}_${++taskCounter}`;
    const now = new Date();
    const task = {
      id: taskId,
      title: taskSpec.title.trim().slice(0, 140),
      description: `Created by webhook: ${normalizedEvent} from ${source}`,
      status: 'pending',
      priority,
      sessionId: assignment?.sessionId || null,
      assignedSessionName: assignment?.assignedSessionName || null,
      assignedUserId: assignment?.assignedUserId || null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };
    tasks.set(taskId, task);
    createdTask = buildTaskSummary(task);

    eventBus.emit('task_created', {
      session_id: task.sessionId,
      user_id: 'webhook',
      model: null,
      endpoint: null,
      experience: null,
      metadata: { taskId, status: 'pending', priority, source: 'webhook', webhookEvent: normalizedEvent }
    });
  }

  logStructured('info', 'webhook_received', { event: normalizedEvent, source, hasTaskCreate: Boolean(createdTask) });

  res.json({
    success: true,
    received: {
      event: normalizedEvent,
      source,
      eventId: webhookEvent.event_id,
      timestamp: webhookEvent.timestamp
    },
    task: createdTask
  });
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
  const avgMessages = calculateAverageMessagesPerSession(allEvents, sessionList);

  res.json({
    success: true,
    summary: {
      totalSessions: new Set(sessionStarts.map((event) => event.session_id)).size,
      activeSessions: sessions.size,
      totalMessages: messagesSent.length,
      avgMessagesPerSession: avgMessages,
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
  res.json({
    success: true,
    experiences: getPublicExperienceConfigs(),
    demoMode: {
      enabled: PUBLIC_DEMO_MODE,
      enforcedExperience: PUBLIC_DEMO_MODE ? DEMO_EXPERIENCE : null
    }
  });
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
    const filteredConnectors = (connectors || []).filter((connector) => {
      if (connector?.id !== 'blackboard-learn') {
        return true;
      }
      return BB_MCP_ENABLED;
    });
    res.json({ success: true, connectors: filteredConnectors });
  } catch (err) {
    logStructured('error', 'connectors_read_failed', { error: err.message });
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
  if (connectorId === 'blackboard-learn') {
    return BB_MCP_ENABLED ? BB_MCP_URL : null;
  }
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
    logStructured('error', 'mcp_proxy_failed', {
      connectorId,
      target,
      error: err.message
    });
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

  // Check LLM endpoints — for Docker Runner endpoints verify the specific model is pulled,
  // not just that the runner process is reachable.
  let cachedRunnerModels = null;
  for (const [key, config] of Object.entries(LLM_CONFIG)) {
    try {
      if (config.apiStyle === 'openai') {
        if (cachedRunnerModels === null) {
          const r = await axios.get(`${config.url}/models`, { timeout: 3000 });
          cachedRunnerModels = r.data?.data || [];
        }
        const modelLoaded = checkModelInRunnerList(cachedRunnerModels, config.defaultModel);
        health.endpoints[key] = modelLoaded ? 'healthy' : 'runner_up_model_not_loaded';
        if (!modelLoaded && health.status === 'ok') health.status = 'degraded';
      } else {
        await axios.get(`${config.url}/api/tags`, { timeout: 3000 });
        health.endpoints[key] = 'healthy';
      }
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

export {
  attachEventWebSocketServer,
  applyOutputControls,
  app,
  calculateAverageMessagesPerSession,
  checkModelInRunnerList,
  classifyInput,
  coerceModelForEndpoint,
  detectPII,
  filterResponse,
  getAllowedEndpoints,
  isEndpointAllowed,
  normalizePromptText,
  normalizeOllamaModelName,
  normalizeTaskPriority,
  normalizeTaskStatus,
  redactSensitiveText,
  resolveConfiguredSafetyMode,
  resolveEffectiveSafetyMode,
  resolveSessionEndpoint,
  runPromptHandlers,
  sanitizeResponse
};

if (process.env.AGENT_DASHBOARD_DISABLE_LISTEN !== '1') {
  const server = app.listen(PORT, () => {
    logStructured('info', 'server_started', {
      port: PORT,
      endpoints: Object.fromEntries(Object.entries(LLM_CONFIG).map(([key, config]) => [key, config.url])),
      nemoClawUrl: NEMOCLAW_URL,
      bbMcpEnabled: BB_MCP_ENABLED,
      bbMcpUrl: BB_MCP_URL,
      websocketPath: '/ws/events'
    });
  });

  attachEventWebSocketServer(server);

  // Graceful shutdown: flush OTel spans before exit
  process.on('SIGTERM', async () => {
    await shutdownTracing();
    server.close(() => process.exit(0));
  });
  process.on('SIGINT', async () => {
    await shutdownTracing();
    server.close(() => process.exit(0));
  });
}
