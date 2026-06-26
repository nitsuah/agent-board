import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import net from 'net';
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
import { createWorkspaceRouter } from './routes/workspace.js';
import { createTasksRouter } from './routes/tasks.js';
import { createMetricsRouter } from './routes/metrics.js';
import { createDockerRouter } from './routes/docker.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createContentRouter } from './routes/content.js';
import { createModelsRouter } from './routes/models.js';
import { createWebhooksRouter } from './routes/webhooks.js';
import { createToolsRouter } from './routes/tools.js';
import { createConnectorsRouter } from './routes/connectors.js';
import { startTaskRunner } from './task-runner.js';
import outputsRouter from './routes/outputs.js';
import {
  isKnownExperience, isKnownSafetyMode, getExperienceConfig, getAllowedEndpoints,
  getPublicExperienceConfigs, isEndpointAllowed, resolveSessionEndpoint,
  resolveConfiguredSafetyMode, resolveEffectiveSafetyMode,
  classifyInput, detectPII, filterResponse, redactSensitiveText, sanitizeResponse,
  normalizePromptText, applyOutputControls, calculateAverageMessagesPerSession,
} from './safety.js';
import { logStructured } from './modules/logger.js';
import {
  isTruthyEnv,
  DOCKER_RUNNER_URL, activeDockerRunnerModelRef,
  DEVICE_PROFILES, DEVICE_PROFILE,
  LLM_CONFIG, NEMOCLAW_URL, BB_MCP_URL, BB_MCP_ENABLED, OPENLLM_ENABLED,
  TOOL_SERVERS,
} from './modules/llm-config.js';
import { parseMcpRpcResponse } from './modules/mcp-helpers.js';
import { eventBus, attachEventWebSocketServer } from './modules/event-bus.js';
import { createAgentHelpers } from './modules/agent-tools.js';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const DOCKER_CONTROL_ENABLED = isTruthyEnv(process.env.AGENT_BOARD_ENABLE_DOCKER_CONTROL);
const DOCKER_COMPOSE_FILE = process.env.DOCKER_COMPOSE_FILE || join(__dirname, '..', 'config', 'docker-compose.yml');
const DOCKER_PROJECT_DIR = process.env.DOCKER_PROJECT_DIR || join(__dirname, '..', 'config');
const DOCKER_ENV_FILE = process.env.DOCKER_ENV_FILE || join(__dirname, '..', 'config', '.env');
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || null;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || null;
const WEBSITE_OUTPUT_DIR = process.env.WEBSITE_OUTPUT_DIR || join(__dirname, '..', 'tools', 'website', 'output');

function parseUrlListEnv(rawValue, fallback = []) {
  const fromEnv = String(rawValue || '').split(',').map(s => s.trim()).filter(Boolean);
  const merged = [...fromEnv, ...fallback].map(s => String(s || '').trim().replace(/\/+$/, '')).filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const candidate of merged) {
    try {
      new URL(candidate);
      if (!seen.has(candidate)) { unique.push(candidate); seen.add(candidate); }
    } catch { /* invalid URL, skip */ }
  }
  return unique;
}

const PUBLIC_DEMO_MODE = isTruthyEnv(process.env.PUBLIC_DEMO_MODE);
const DEMO_EXPERIENCE = 'safechat';

function resolveRequestedExperience(requestedExperience) {
  return PUBLIC_DEMO_MODE ? DEMO_EXPERIENCE : requestedExperience;
}

const IN_DOCKER = existsSync('/.dockerenv');

const TOOL_CALL_TIMEOUT_MS = Number(process.env.TOOL_CALL_TIMEOUT_MS || 11 * 60_000);
const PRIMARY_LLM_URL_CANDIDATES = parseUrlListEnv(
  process.env.PRIMARY_LLM_URL_CANDIDATES,
  [
    process.env.PRIMARY_LLM_URL || 'http://ollama:8080',
    'http://localhost:8081',
    'http://localhost:11434',
  ]
);
const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS || 4000);
const MAX_OUTPUT_CHARS = Number(process.env.MAX_OUTPUT_CHARS || 5000);
const MODEL_PULL_TIMEOUT_MS = Number(process.env.MODEL_PULL_TIMEOUT_MS || 20 * 60_000);

// Session / task state
const sessions = new Map();
const sessionCounterRef = { current: 0 };
const tasks = new Map();
let taskCounter = 0;
const TASK_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'completed']);
const TASK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const pullStatus = new Map();

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
    id: task.id, title: task.title, description: task.description,
    status: task.status, priority: task.priority, sessionId: task.sessionId,
    assignedSessionName: task.assignedSessionName, assignedUserId: task.assignedUserId,
    createdAt: task.createdAt, updatedAt: task.updatedAt, completedAt: task.completedAt || null,
  };
}

function resolveTaskAssignment(sessionId) {
  if (!sessionId) return { sessionId: null, assignedSessionName: null, assignedUserId: null };
  const session = sessions.get(sessionId);
  if (!session) return null;
  return { sessionId, assignedSessionName: session.name, assignedUserId: session.userId };
}

function getNextTaskId() {
  return `task_${Date.now()}_${++taskCounter}`;
}

async function checkHttpService(url, timeoutMs = 3000) {
  await axios.get(url, { timeout: timeoutMs });
}

async function resolvePrimaryLlmUrl(timeoutMs = 1200) {
  for (const baseUrl of PRIMARY_LLM_URL_CANDIDATES) {
    try {
      await checkHttpService(`${baseUrl}/api/tags`, timeoutMs);
      return { url: baseUrl, discovered: true };
    } catch { /* try next */ }
  }
  return { url: LLM_CONFIG.primary.url, discovered: false };
}

async function resolveEndpointUrl(endpoint) {
  if (endpoint === 'primary') {
    const resolved = await resolvePrimaryLlmUrl();
    return resolved.url;
  }
  return LLM_CONFIG[endpoint]?.url || LLM_CONFIG.primary.url;
}

function getServiceRegistry() {
  return {
    ollama: {
      key: 'ollama', label: 'Ollama', backendType: 'ollama-container',
      composeService: 'ollama', ports: '8081:8080', controllable: true,
      checkType: 'http', probePath: '/api/tags', candidates: PRIMARY_LLM_URL_CANDIDATES,
    },
    nemoclaw: {
      key: 'nemoclaw', label: 'NemoClaw', backendType: 'sandbox',
      composeService: 'nemoclaw', composeProfile: 'sandbox', ports: '9000:8080',
      controllable: true, checkType: 'tcp', probePath: null, candidates: [NEMOCLAW_URL],
    },
    bb_mcp: {
      key: 'bb_mcp', label: 'Blackboard MCP', backendType: 'mcp',
      composeService: 'bb-mcp', ports: '3100:3100', controllable: BB_MCP_ENABLED,
      checkType: 'http', probePath: '/health', candidates: [BB_MCP_URL],
      disabledReason: BB_MCP_ENABLED ? null : 'BB_MCP_ENABLED=false',
    },
    llm_openllm: {
      key: 'llm_openllm', label: 'OpenLLM', backendType: 'openllm-container',
      composeService: 'llm_openllm', composeProfile: 'openllm', ports: '8082:3000',
      controllable: OPENLLM_ENABLED, checkType: 'http', probePath: '/v1/models',
      candidates: [LLM_CONFIG.openllm.url],
      disabledReason: OPENLLM_ENABLED ? null : 'OPENLLM_ENABLED=false',
    },
    tool_content_gen: {
      key: 'tool_content_gen', label: 'Content Gen', backendType: 'mcp',
      composeService: TOOL_SERVERS.content_gen.composeService, composeProfile: 'tools',
      ports: TOOL_SERVERS.content_gen.ports, controllable: true,
      checkType: 'http', probePath: '/health', candidates: [TOOL_SERVERS.content_gen.url],
    },
    tool_website: {
      key: 'tool_website', label: 'Website Agent', backendType: 'mcp',
      composeService: TOOL_SERVERS.website.composeService, composeProfile: 'tools',
      ports: TOOL_SERVERS.website.ports, controllable: true,
      checkType: 'http', probePath: '/health', candidates: [TOOL_SERVERS.website.url],
    },
  };
}

async function runComposeAction(action, serviceName, composeProfile = null) {
  const profileFlag = composeProfile ? ['--profile', composeProfile] : [];
  const actionArgs = {
    start:   ['-f', DOCKER_COMPOSE_FILE, '--project-directory', DOCKER_PROJECT_DIR, '--env-file', DOCKER_ENV_FILE, ...profileFlag, 'up', '-d', serviceName],
    stop:    ['-f', DOCKER_COMPOSE_FILE, '--project-directory', DOCKER_PROJECT_DIR, '--env-file', DOCKER_ENV_FILE, 'stop', serviceName],
    restart: ['-f', DOCKER_COMPOSE_FILE, '--project-directory', DOCKER_PROJECT_DIR, '--env-file', DOCKER_ENV_FILE, ...profileFlag, 'restart', serviceName],
  };
  const args = actionArgs[action];
  if (!args) throw new Error(`Unsupported action: ${action}`);
  let lastError = null;
  for (const [cmd, ...prefix] of [['docker', 'compose'], ['docker-compose']]) {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, [...prefix, ...args], { timeout: 60_000, maxBuffer: 1024 * 1024 });
      return { stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() };
    } catch (error) {
      lastError = error;
      const details = `${error.message || ''}\n${error.stderr || ''}`;
      const binaryMissing = error.code === 'ENOENT' || /(not found|is not recognized|docker-compose: not found|docker: not found|is not a docker command|unknown shorthand flag:\s*'f'\s*in -f)/i.test(details);
      if (!binaryMissing) throw error;
    }
  }
  throw lastError || new Error('Docker Compose CLI is not available in the dashboard container.');
}

async function checkTcpService(url, timeoutMs = 3000) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve();
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

function chooseRunnableOllamaModel(requestedModel, availableModels = [], defaultModel = '') {
  if (!Array.isArray(availableModels) || availableModels.length === 0) return null;
  const normalizedRequested = normalizeOllamaModelName(requestedModel);
  const normalizedDefault = normalizeOllamaModelName(defaultModel);
  const requestedMatch = availableModels.find(a => normalizeOllamaModelName(a) === normalizedRequested);
  if (requestedMatch) return requestedMatch;
  const defaultMatch = availableModels.find(a => normalizeOllamaModelName(a) === normalizedDefault);
  return defaultMatch || availableModels[0];
}

async function getOllamaModelNames(baseUrl) {
  const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 5000 });
  return response.data.models?.map(m => m.name).filter(Boolean) || [];
}

async function ensureRunnableModelForSession(session) {
  const endpointConfig = LLM_CONFIG[session.endpoint] || LLM_CONFIG.primary;
  if (endpointConfig.apiStyle !== 'ollama') return { adjusted: false, reason: 'non_ollama_endpoint' };
  let availableModels;
  try { availableModels = await getOllamaModelNames(session.llmUrl); }
  catch { return { adjusted: false, reason: 'no_models' }; }
  const resolvedModel = chooseRunnableOllamaModel(session.model, availableModels, endpointConfig.defaultModel);
  if (!resolvedModel) return { adjusted: false, reason: 'no_models' };
  if (session.model !== resolvedModel) {
    const previousModel = session.model;
    session.model = resolvedModel;
    return {
      adjusted: true,
      reason: normalizeOllamaModelName(previousModel) === normalizeOllamaModelName(resolvedModel) ? 'normalized_match' : 'fallback_available',
      model: resolvedModel,
    };
  }
  return { adjusted: false, model: resolvedModel };
}

async function prepareSessionForLlmCall(session) {
  let llmUrl = session.llmUrl;
  let apiStyle = LLM_CONFIG[session.endpoint]?.apiStyle || 'ollama';
  const modelResolution = await ensureRunnableModelForSession(session);
  if (modelResolution.reason === 'no_models') {
    const fallbackEndpoint = getAvailabilityFallbackEndpoint();
    if (fallbackEndpoint && fallbackEndpoint !== session.endpoint) {
      const previousEndpoint = session.endpoint;
      session.endpoint = fallbackEndpoint;
      session.llmUrl = await resolveEndpointUrl(fallbackEndpoint);
      session.model = LLM_CONFIG[fallbackEndpoint].defaultModel;
      session.updatedAt = new Date();
      llmUrl = session.llmUrl;
      apiStyle = LLM_CONFIG[fallbackEndpoint].apiStyle;
      eventBus.emit('endpoint_auto_fallback', {
        session_id: session.id, user_id: session.userId,
        model: session.model, endpoint: session.endpoint, experience: session.experience,
        metadata: { from: previousEndpoint, to: fallbackEndpoint, reason: 'ollama_no_models' },
      });
    }
  } else if (modelResolution.adjusted) {
    session.updatedAt = new Date();
    eventBus.emit('model_auto_corrected', {
      session_id: session.id, user_id: session.userId,
      model: session.model, endpoint: session.endpoint, experience: session.experience,
      metadata: { reason: modelResolution.reason, resolvedModel: modelResolution.model },
    });
  }
  const apiKey = LLM_CONFIG[session.endpoint]?.apiKey || null;
  return { llmUrl, apiStyle, modelResolution, apiKey };
}

function coerceModelForEndpoint(endpoint, requestedModel) {
  const endpointConfig = LLM_CONFIG[endpoint] || LLM_CONFIG.primary;
  if (!requestedModel) return endpointConfig.defaultModel;
  if (endpointConfig.apiStyle === 'ollama' &&
      (requestedModel.startsWith('docker.io/') || requestedModel.startsWith('ai/'))) {
    return endpointConfig.defaultModel;
  }
  return requestedModel;
}

function getAvailabilityFallbackEndpoint() {
  const candidate = Object.entries(LLM_CONFIG).find(([, config]) => config.apiStyle === 'openai');
  return candidate?.[0] || null;
}

function checkModelInRunnerList(modelsList, modelId) {
  if (!Array.isArray(modelsList) || !modelId) return false;
  const normalise = (s) => String(s).replace(/^docker\.io\//i, '').replace(/:latest$/i, '').toLowerCase();
  const target = normalise(modelId);
  return modelsList.some(m => normalise(m.id ?? m.name ?? '') === target);
}

async function fetchDockerRunnerModels(baseUrl, timeoutMs = 4000) {
  const response = await axios.get(`${baseUrl}/models`, { timeout: timeoutMs });
  return response.data?.data || [];
}

async function fetchOllamaModels(baseUrl, timeoutMs = 4000) {
  const response = await axios.get(`${baseUrl}/api/tags`, { timeout: timeoutMs });
  return (response.data?.models || []).map(m => m.name).filter(Boolean);
}

await initTracing(logStructured);
await initPersistence(logStructured);

const { getExperienceTools, runAgentLoop } = createAgentHelpers({
  WORKSPACE_ROOT, execAsync, TOOL_SERVERS, TOOL_CALL_TIMEOUT_MS,
});

async function runPromptHandlers(rawMessage, session, safetyMode) {
  const normalized = normalizePromptText(rawMessage);
  if (!normalized) {
    return { handled: true, blocked: true, classification: { category: 'blocked', reason: 'empty_message' }, response: 'Please enter a message before sending.' };
  }
  if (normalized.length > MAX_INPUT_CHARS) {
    return { handled: true, blocked: true, classification: { category: 'blocked', reason: 'message_too_long' }, response: `Your message is too long (${normalized.length} chars). Please keep it under ${MAX_INPUT_CHARS} characters.` };
  }
  if (normalized === '/safety') {
    return { handled: true, blocked: false, classification: { category: 'safe', reason: 'handler_safety' }, response: `Safety mode: ${safetyMode}. Endpoint: ${session.endpoint}. Model: ${session.model}` };
  }
  if (normalized === '/bb-health') {
    if (!BB_MCP_ENABLED) {
      return { handled: true, blocked: false, classification: { category: 'safe', reason: 'handler_bb_health_disabled' }, response: 'Blackboard MCP is disabled. Set BB_MCP_ENABLED=true to enable bb-mcp checks and proxy routes.' };
    }
    try {
      const resp = await axios.get(`${BB_MCP_URL}/health`, { timeout: 4000 });
      const status = resp.data?.status || 'unknown';
      const name = resp.data?.name || 'bb-mcp';
      return { handled: true, blocked: false, classification: { category: 'safe', reason: 'handler_bb_health' }, response: `Blackboard MCP is reachable. Service: ${name}. Status: ${status}.` };
    } catch (error) {
      return { handled: true, blocked: false, classification: { category: 'safe', reason: 'handler_bb_health' }, response: `Blackboard MCP check failed: ${error.message}` };
    }
  }
  if (normalized === '/nemoclaw-health') {
    try {
      await axios.get(`${NEMOCLAW_URL}/`, { timeout: 4000 });
      return { handled: true, blocked: false, classification: { category: 'safe', reason: 'handler_nemoclaw_health' }, response: 'NemoClaw gateway is reachable.' };
    } catch (error) {
      return { handled: true, blocked: false, classification: { category: 'safe', reason: 'handler_nemoclaw_health' }, response: `NemoClaw check failed: ${error.message}` };
    }
  }
  return { handled: false, blocked: false, message: normalized };
}

// Router instances (initialized after shared state + helpers are declared)
const tasksRouter = createTasksRouter({ tasks, sessions, eventBus, logStructured, normalizeTaskStatus, normalizeTaskPriority, buildTaskSummary, resolveTaskAssignment });
const workspaceRouter = createWorkspaceRouter(WORKSPACE_ROOT);

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logStructured('info', 'api_request', {
      method: req.method, path: req.originalUrl, statusCode: res.statusCode,
      durationMs: Date.now() - start,
      sessionId: req.params?.id || req.body?.sessionId || req.body?.session_id || null,
    });
  });
  next();
});
app.use(express.static(join(__dirname, 'dist')));

// ============ API ROUTES ============

app.use('/api', createDockerRouter({
  DOCKER_CONTROL_ENABLED, DOCKER_COMPOSE_FILE, DOCKER_PROJECT_DIR, DOCKER_ENV_FILE,
  LLM_CONFIG, DEVICE_PROFILE, DEVICE_PROFILES, PRIMARY_LLM_URL_CANDIDATES,
  DOCKER_RUNNER_URL, MODEL_PULL_TIMEOUT_MS,
  BB_MCP_ENABLED, BB_MCP_URL, NEMOCLAW_URL, IN_DOCKER, WORKSPACE_ROOT,
  getServiceRegistry, runComposeAction, resolvePrimaryLlmUrl,
  fetchOllamaModels, fetchDockerRunnerModels, checkModelInRunnerList,
  checkTcpService, checkHttpService, normalizeOllamaModelName,
  execFileAsync, pullStatus, eventBus, logStructured, activeDockerRunnerModelRef,
}));

app.use('/api', createContentRouter({ WEBSITE_OUTPUT_DIR, WORKSPACE_ROOT }));
app.use('/api', outputsRouter);

app.use('/api', createModelsRouter({
  LLM_CONFIG, resolvePrimaryLlmUrl, PRIMARY_LLM_URL_CANDIDATES,
  PUBLIC_DEMO_MODE, PORT, DOCKER_CONTROL_ENABLED, NEMOCLAW_URL,
  getPersistenceStatus, getTracingStatus, logStructured,
}));

app.get('/api/demo-mode', (req, res) => {
  res.json({
    success: true, enabled: PUBLIC_DEMO_MODE,
    enforcedExperience: PUBLIC_DEMO_MODE ? DEMO_EXPERIENCE : null,
    allowedEndpoints: PUBLIC_DEMO_MODE ? ['primary'] : Object.keys(LLM_CONFIG),
    websocketPath: '/ws/events',
  });
});

app.get('/api/persistence/status', (req, res) => {
  res.json({ success: true, persistence: getPersistenceStatus() });
});

app.get('/api/tracing/status', (req, res) => {
  res.json({ success: true, tracing: getTracingStatus() });
});

app.use('/api/sessions', createSessionsRouter({
  sessions, sessionCounterRef, eventBus, logStructured,
  LLM_CONFIG, PUBLIC_DEMO_MODE, DEMO_EXPERIENCE, MAX_INPUT_CHARS, MAX_OUTPUT_CHARS,
  DEVICE_PROFILE, resolveRequestedExperience, isKnownExperience, isKnownSafetyMode,
  resolveSessionEndpoint, resolveConfiguredSafetyMode, isEndpointAllowed,
  getExperienceConfig, getAllowedEndpoints, coerceModelForEndpoint,
  resolveEndpointUrl, prepareSessionForLlmCall, ensureRunnableModelForSession,
  getExperienceTools, runPromptHandlers, runAgentLoop,
  upsertSessionContext, markSessionEnded, persistEvent, activeDockerRunnerModelRef,
}));

app.use('/api', tasksRouter);

app.use('/api', createWebhooksRouter({
  tasks, getNextTaskId, eventBus, logStructured,
  webhookSecret: WEBHOOK_SECRET,
  normalizeTaskPriority, resolveTaskAssignment, buildTaskSummary,
}));

app.use('/api/metrics', createMetricsRouter({ sessions, eventBus }));

app.get('/api/experiences', (req, res) => {
  res.json({
    success: true,
    experiences: getPublicExperienceConfigs(PUBLIC_DEMO_MODE),
    demoMode: { enabled: PUBLIC_DEMO_MODE, enforcedExperience: PUBLIC_DEMO_MODE ? DEMO_EXPERIENCE : null },
  });
});

app.use('/api', createToolsRouter({ TOOL_SERVERS, DOCKER_CONTROL_ENABLED, eventBus, logStructured, TOOL_CALL_TIMEOUT_MS }));

app.use('/api', createConnectorsRouter({ BB_MCP_ENABLED, BB_MCP_URL, logStructured }));

app.get('/api/health', async (req, res) => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recentEvents = eventBus.getSince(fiveMinAgo);
  const recentErrors = recentEvents.filter(e => e.event_type === 'error');
  const recentMessages = recentEvents.filter(e => e.event_type === 'message_sent');
  const health = {
    status: 'ok',
    timestamp: new Date(),
    server: { uptime: process.uptime(), memory: process.memoryUsage(), platform: process.platform },
    endpoints: {},
    sessions: { active: sessions.size, totalCreated: sessionCounterRef.current },
    observability: {
      totalEvents: eventBus.getAll().length,
      recentErrors: recentErrors.length,
      recentMessages: recentMessages.length,
      errorRateLast5Min: recentMessages.length > 0
        ? Number(((recentErrors.length / recentMessages.length) * 100).toFixed(1)) : 0,
    },
  };
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

app.use('/api', workspaceRouter);

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
  chooseRunnableOllamaModel,
  classifyInput,
  coerceModelForEndpoint,
  detectPII,
  filterResponse,
  getAllowedEndpoints,
  getExperienceConfig,
  isEndpointAllowed,
  normalizePromptText,
  normalizeOllamaModelName,
  normalizeTaskPriority,
  parseMcpRpcResponse,
  TOOL_SERVERS,
  normalizeTaskStatus,
  redactSensitiveText,
  resolveConfiguredSafetyMode,
  resolveEffectiveSafetyMode,
  resolveSessionEndpoint,
  runPromptHandlers,
  sanitizeResponse,
};

if (process.env.AGENT_DASHBOARD_DISABLE_LISTEN !== '1') {
  const server = app.listen(PORT, () => {
    logStructured('info', 'server_started', {
      port: PORT,
      endpoints: Object.fromEntries(Object.entries(LLM_CONFIG).map(([key, config]) => [key, config.url])),
      nemoClawUrl: NEMOCLAW_URL,
      bbMcpEnabled: BB_MCP_ENABLED,
      bbMcpUrl: BB_MCP_URL,
      websocketPath: '/ws/events',
    });
    checkHttpService(`${DOCKER_RUNNER_URL}/models`, 3000)
      .then(() => logStructured('info', 'docker_runner_reachable', { url: DOCKER_RUNNER_URL }))
      .catch(() => logStructured('warn', 'docker_runner_unreachable', {
        url: DOCKER_RUNNER_URL,
        hint: 'Enable Docker Desktop Model Runner or set DOCKER_RUNNER_URL in .env',
      }));
  });

  attachEventWebSocketServer(server);

  // Start the background task auto-runner (picks up pending tasks by priority)
  startTaskRunner(tasks, eventBus);

  process.on('SIGTERM', async () => { await shutdownTracing(); server.close(() => process.exit(0)); });
  process.on('SIGINT', async () => { await shutdownTracing(); server.close(() => process.exit(0)); });
}
