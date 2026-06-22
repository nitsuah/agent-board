import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, resolve as resolvePath, relative as relativePath } from 'path';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { readdir, readFile, writeFile, mkdir, stat, unlink, rm } from 'fs/promises';
import { randomUUID } from 'crypto';
import { exec, execFile } from 'child_process';
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
import { createWorkspaceRouter } from './routes/workspace.js';
import { createTasksRouter } from './routes/tasks.js';
import { createMetricsRouter } from './routes/metrics.js';
import { createDockerRouter } from './routes/docker.js';
import { createSessionsRouter } from './routes/sessions.js';
import {
  SAFETY_CONFIGS, EXPERIENCE_CONFIGS, SAFETY_RANK,
  isKnownExperience, isKnownSafetyMode, getExperienceConfig, getAllowedEndpoints,
  getPublicExperienceConfigs, isEndpointAllowed, resolveSessionEndpoint,
  resolveConfiguredSafetyMode, resolveEffectiveSafetyMode,
  normalizeForMatching, classifyInput, detectPII, buildSystemMessages,
  filterResponse, redactSensitiveText, sanitizeResponse, normalizePromptText,
  applyOutputControls, calculateAverageMessagesPerSession,
} from './safety.js';
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

// Workspace file I/O — user-mounted directory the agent can read/write/git-commit.
// Set WORKSPACE_ROOT to the path inside the container (default /workspace).
// Apply config/docker-compose.workspace.yml overlay to mount a host folder there.
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || null;
const WEBSITE_OUTPUT_DIR = process.env.WEBSITE_OUTPUT_DIR || join(__dirname, '..', 'tools', 'website', 'output');

// LLM Configuration - Support multiple endpoints
// apiStyle: 'ollama' uses /api/chat + /api/tags; 'openai' uses /v1/chat/completions + /v1/models
// backendType: used by the UI to show how the model is served
const DOCKER_RUNNER_URL = process.env.DOCKER_RUNNER_URL || 'http://model-runner.docker.internal/engines/llama.cpp/v1';

// Track which Docker Runner model was most recently used so the UI can show it
const activeDockerRunnerModelRef = { current: null };

// ── Device profile system ─────────────────────────────────────────────────────
// Hardware-tier profiles drive default model selection when PRIMARY_LLM_MODEL is
// not explicitly set. Run scripts/detect-profile.ps1 to detect your hardware and
// write DEVICE_PROFILE to .env. See config/device-profiles.json for thresholds.
//
// Profiles: minimal (CPU-only / <4GB VRAM)
//           laptop  (mid-GPU ≥4GB VRAM, e.g. RTX 3070 TPD-locked, 12-20GB RAM)
//           desktop (high-GPU ≥16GB VRAM, e.g. RTX 4080, 24+ GB RAM)
const DEVICE_PROFILES = {
  minimal: { gpu: false, models: { general: 'llama3.2:1b',  coding: 'llama3.2:1b',         fast: 'llama3.2:1b' } },
  laptop:  { gpu: true,  models: { general: 'llama3.2:3b',  coding: 'qwen2.5-coder:7b',    fast: 'llama3.2:1b' } },
  desktop: { gpu: true,  models: { general: 'llama3.1:8b',  coding: 'qwen2.5-coder:14b',   fast: 'llama3.2:3b' } },
};
const DEVICE_PROFILE = (process.env.DEVICE_PROFILE || 'minimal').toLowerCase();
const activeProfile = DEVICE_PROFILES[DEVICE_PROFILE] || DEVICE_PROFILES.minimal;

const LLM_CONFIG = {
  primary: {
    url: process.env.PRIMARY_LLM_URL || 'http://ollama:8080',
    name: 'Ollama (local)',
    backendType: 'ollama-container',
    type: 'general',
    apiStyle: 'ollama',
    // Defaults to the profile's general-task model; overridden by PRIMARY_LLM_MODEL.
    defaultModel: process.env.PRIMARY_LLM_MODEL || activeProfile.models.general
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
  },
  openllm: {
    // OpenLLM (BentoML) — opt-in second OpenAI-compatible endpoint for custom
    // or fine-tuned HuggingFace models. Enable via the `openllm` compose
    // profile and OPENLLM_ENABLED=true. See AI_STACK_STRATEGY.md.
    url: process.env.OPENLLM_URL || 'http://llm_openllm:3000',
    name: 'OpenLLM (custom models)',
    backendType: 'openllm-container',
    type: 'custom',
    apiStyle: 'openai',
    defaultModel: process.env.OPENLLM_MODEL || ''
  }
};

// ── Custom endpoint registry ──────────────────────────────────────────────────
// Register additional OpenAI-compatible endpoints (OpenRouter, vLLM, LM Studio,
// etc.) via CUSTOM_LLM_ENDPOINTS as a JSON array. Each entry merges into
// LLM_CONFIG so all routing, fallback, and status logic applies automatically.
//
// Example .env entry:
//   CUSTOM_LLM_ENDPOINTS=[{"key":"openrouter","name":"OpenRouter","url":"https://openrouter.ai/api/v1","apiKey":"sk-or-v1-...","defaultModel":"anthropic/claude-3-haiku","type":"cloud"}]
//
// Supported fields per entry:
//   key          string  (required) — unique identifier used as the endpoint key
//   url          string  (required) — base URL of the OpenAI-compatible API
//   name         string  — display name shown in the UI
//   apiKey       string  — Bearer token (for cloud APIs like OpenRouter)
//   defaultModel string  — default model name for this endpoint
//   type         string  — hint for the UI: 'cloud', 'custom', 'coding', etc.
//   apiStyle     string  — 'openai' (default) or 'ollama'
(function loadCustomEndpoints() {
  const raw = process.env.CUSTOM_LLM_ENDPOINTS;
  if (!raw) return;
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (e) {
    console.error('[config] CUSTOM_LLM_ENDPOINTS is not valid JSON:', e.message);
    return;
  }
  if (!Array.isArray(entries)) {
    console.error('[config] CUSTOM_LLM_ENDPOINTS must be a JSON array');
    return;
  }
  for (const ep of entries) {
    if (!ep.key || !ep.url) {
      console.warn('[config] Skipping custom endpoint missing key or url:', ep);
      continue;
    }
    LLM_CONFIG[ep.key] = {
      url: ep.url,
      name: ep.name || ep.key,
      backendType: 'custom',
      type: ep.type || 'custom',
      apiStyle: ep.apiStyle || 'openai',
      defaultModel: ep.defaultModel || '',
      apiKey: ep.apiKey || '',
    };
  }
})();

const NEMOCLAW_URL = process.env.NEMOCLAW_URL || 'http://localhost:9000';
const BB_MCP_URL = process.env.BB_MCP_URL || 'http://localhost:3100';
const BB_MCP_ENABLED = isTruthyEnv(process.env.BB_MCP_ENABLED);
const OPENLLM_ENABLED = isTruthyEnv(process.env.OPENLLM_ENABLED);

// MCP tool servers backing the tool-driven experiences (content_gen, website).
// Both run behind the `tools` compose profile and speak Streamable HTTP MCP on /mcp.
const TOOL_CONTENT_GEN_URL = process.env.TOOL_CONTENT_GEN_URL || 'http://tool-content-gen:3200';
const TOOL_WEBSITE_URL = process.env.TOOL_WEBSITE_URL || 'http://tool-website:3201';

const TOOL_SERVERS = {
  content_gen: {
    key: 'content_gen',
    name: 'Content Gen (AI video)',
    description: 'Wraps MoneyPrinterTurbo — generate AI short videos from a topic.',
    url: TOOL_CONTENT_GEN_URL,
    serviceKey: 'tool_content_gen',
    composeService: 'tool-content-gen',
    ports: '3200:3200',
  },
  website: {
    key: 'website',
    name: 'Website Agent (B2B sites)',
    description: 'Lead discovery, client site generation, Netlify deploys, invoicing.',
    url: TOOL_WEBSITE_URL,
    serviceKey: 'tool_website',
    composeService: 'tool-website',
    ports: '3201:3201',
  },
};

// ── Agent tool definitions (passed to LLM for tool-enabled experiences) ─────────

const DEVELOPER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command inside WORKSPACE_ROOT. Returns stdout and stderr. Use for file ops, git, npm, node, etc.',
      parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to run.' } }, required: ['command'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file in the workspace and return its text content.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path inside workspace.' } }, required: ['path'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path inside workspace.' },
          content: { type: 'string', description: 'Content to write.' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories at a path inside the workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path (default: workspace root).', default: '' } } }
    }
  }
];

const RESEARCH_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web via DuckDuckGo Instant Answers. Returns abstract, related topics, and direct answer if available.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query.' } }, required: ['query'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_artifact',
      description: 'Save a research artifact (notes, outline, summary) to workspace/artifacts/.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Artifact filename (e.g. "report.md").' },
          content: { type: 'string', description: 'Artifact text content.' }
        },
        required: ['filename', 'content']
      }
    }
  }
];

const WEBSITE_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'discover_leads',
      description: 'Find local businesses in a location that may need a website.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City/area to search (e.g. "Austin TX").' },
          business_type: { type: 'string', description: 'Category of business (e.g. "restaurant").' }
        },
        required: ['location']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_website_file',
      description: 'Save a generated HTML/CSS/JS file for a client site under their slug.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Client slug (e.g. "joes-pizza-90210").' },
          filename: { type: 'string', description: 'File to save (e.g. "index.html").' },
          content: { type: 'string', description: 'File content.' }
        },
        required: ['slug', 'filename', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_website_files',
      description: 'List saved files for a client site slug.',
      parameters: {
        type: 'object',
        properties: { slug: { type: 'string', description: 'Client slug.' } },
        required: ['slug']
      }
    }
  }
];

// generate_video polls MoneyPrinterTurbo for up to 10 minutes server-side, so
// tool calls need a much longer budget than chat requests.
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

// Model pulls (Ollama `ollama pull` / Docker Model Runner `docker model pull`)
// can take many minutes for multi-GB models on slow connections.
const MODEL_PULL_TIMEOUT_MS = Number(process.env.MODEL_PULL_TIMEOUT_MS || 20 * 60_000);

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function parseUrlListEnv(rawValue, fallback = []) {
  const fromEnv = String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const merged = [...fromEnv, ...fallback]
    .map((item) => String(item || '').trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const seen = new Set();
  const unique = [];
  for (const candidate of merged) {
    try {
      // Validate URL shape while preserving normalized string.
      new URL(candidate);
      if (!seen.has(candidate)) {
        unique.push(candidate);
        seen.add(candidate);
      }
    } catch {
      // Ignore invalid URL candidate.
    }
  }

  return unique;
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
const sessionCounterRef = { current: 0 };
const tasks = new Map();
let taskCounter = 0;
const TASK_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'completed']);
const TASK_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

// Model pull status, keyed by `${endpoint}:${model}`.
const pullStatus = new Map();

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

async function resolvePrimaryLlmUrl(timeoutMs = 1200) {
  for (const baseUrl of PRIMARY_LLM_URL_CANDIDATES) {
    try {
      await checkHttpService(`${baseUrl}/api/tags`, timeoutMs);
      return { url: baseUrl, discovered: true };
    } catch {
      // Continue to next candidate.
    }
  }

  return {
    url: LLM_CONFIG.primary.url,
    discovered: false,
  };
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
      key: 'ollama',
      label: 'Ollama',
      backendType: 'ollama-container',
      composeService: 'ollama',
      ports: '8081:8080',
      controllable: true,
      checkType: 'http',
      probePath: '/api/tags',
      candidates: PRIMARY_LLM_URL_CANDIDATES,
    },
    nemoclaw: {
      key: 'nemoclaw',
      label: 'NemoClaw',
      backendType: 'sandbox',
      composeService: 'nemoclaw',
      composeProfile: 'sandbox',
      ports: '9000:8080',
      controllable: true,
      checkType: 'tcp',
      probePath: null,
      candidates: [NEMOCLAW_URL],
    },
    bb_mcp: {
      key: 'bb_mcp',
      label: 'Blackboard MCP',
      backendType: 'mcp',
      composeService: 'bb-mcp',
      ports: '3100:3100',
      controllable: BB_MCP_ENABLED,
      checkType: 'http',
      probePath: '/health',
      candidates: [BB_MCP_URL],
      disabledReason: BB_MCP_ENABLED ? null : 'BB_MCP_ENABLED=false',
    },
    llm_openllm: {
      key: 'llm_openllm',
      label: 'OpenLLM',
      backendType: 'openllm-container',
      composeService: 'llm_openllm',
      composeProfile: 'openllm',
      ports: '8082:3000',
      controllable: OPENLLM_ENABLED,
      checkType: 'http',
      probePath: '/v1/models',
      candidates: [LLM_CONFIG.openllm.url],
      disabledReason: OPENLLM_ENABLED ? null : 'OPENLLM_ENABLED=false',
    },
    tool_content_gen: {
      key: 'tool_content_gen',
      label: 'Content Gen',
      backendType: 'mcp',
      composeService: TOOL_SERVERS.content_gen.composeService,
      composeProfile: 'tools',
      ports: TOOL_SERVERS.content_gen.ports,
      controllable: true,
      checkType: 'http',
      probePath: '/health',
      candidates: [TOOL_SERVERS.content_gen.url],
    },
    tool_website: {
      key: 'tool_website',
      label: 'Website Agent',
      backendType: 'mcp',
      composeService: TOOL_SERVERS.website.composeService,
      composeProfile: 'tools',
      ports: TOOL_SERVERS.website.ports,
      controllable: true,
      checkType: 'http',
      probePath: '/health',
      candidates: [TOOL_SERVERS.website.url],
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
  if (!args) {
    throw new Error(`Unsupported action: ${action}`);
  }

  let lastError = null;
  // Try 'docker compose' (plugin) first, then 'docker-compose' (standalone)
  for (const [cmd, ...prefix] of [['docker', 'compose'], ['docker-compose']]) {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, [...prefix, ...args], { timeout: 60_000, maxBuffer: 1024 * 1024 });
      return { stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() };
    } catch (error) {
      lastError = error;
      const details = `${error.message || ''}\n${error.stderr || ''}`;
      const binaryMissing = error.code === 'ENOENT' || /(not found|is not recognized|docker-compose: not found|docker: not found|is not a docker command|unknown shorthand flag:\s*'f'\s*in -f)/i.test(details);
      if (!binaryMissing) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Docker Compose CLI is not available in the dashboard container.');
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

function chooseRunnableOllamaModel(requestedModel, availableModels = [], defaultModel = '') {
  if (!Array.isArray(availableModels) || availableModels.length === 0) {
    return null;
  }

  const normalizedRequested = normalizeOllamaModelName(requestedModel);
  const normalizedDefault = normalizeOllamaModelName(defaultModel);

  const requestedMatch = availableModels.find(
    (available) => normalizeOllamaModelName(available) === normalizedRequested
  );
  if (requestedMatch) {
    return requestedMatch;
  }

  const defaultMatch = availableModels.find(
    (available) => normalizeOllamaModelName(available) === normalizedDefault
  );
  if (defaultMatch) {
    return defaultMatch;
  }

  return availableModels[0];
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

  let availableModels;
  try {
    availableModels = await getOllamaModelNames(session.llmUrl);
  } catch {
    return { adjusted: false, reason: 'no_models' };
  }
  const resolvedModel = chooseRunnableOllamaModel(session.model, availableModels, endpointConfig.defaultModel);
  if (!resolvedModel) {
    return { adjusted: false, reason: 'no_models' };
  }

  if (session.model !== resolvedModel) {
    const previousModel = session.model;
    session.model = resolvedModel;
    return {
      adjusted: true,
      reason: normalizeOllamaModelName(previousModel) === normalizeOllamaModelName(resolvedModel)
        ? 'normalized_match'
        : 'fallback_available',
      model: resolvedModel
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

  const apiKey = LLM_CONFIG[session.endpoint]?.apiKey || null;
  return { llmUrl, apiStyle, modelResolution, apiKey };
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
 * Strips the docker.io/ registry prefix and :latest suffix for comparison, so
 * 'docker.io/ai/foo:latest', 'ai/foo:latest', and 'ai/foo' all match.
 */
function checkModelInRunnerList(modelsList, modelId) {
  if (!Array.isArray(modelsList) || !modelId) return false;
  const normalise = (s) => String(s).replace(/^docker\.io\//i, '').replace(/:latest$/i, '').toLowerCase();
  const target = normalise(modelId);
  return modelsList.some((m) => normalise(m.id ?? m.name ?? '') === target);
}

/** Fetches the Docker Model Runner /v1/models list and returns the data array. */
async function fetchDockerRunnerModels(baseUrl, timeoutMs = 4000) {
  const response = await axios.get(`${baseUrl}/models`, { timeout: timeoutMs });
  return response.data?.data || [];
}

/** Fetches the Ollama /api/tags list and returns the model name array. */
async function fetchOllamaModels(baseUrl, timeoutMs = 4000) {
  const response = await axios.get(`${baseUrl}/api/tags`, { timeout: timeoutMs });
  return (response.data?.models || []).map((m) => m.name).filter(Boolean);
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


// Router instances (initialized after shared state + helpers are declared)
const tasksRouter = createTasksRouter({ tasks, sessions, eventBus, normalizeTaskStatus, normalizeTaskPriority, buildTaskSummary, resolveTaskAssignment });
const workspaceRouter = createWorkspaceRouter(WORKSPACE_ROOT);

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

// Docker/system/model routes extracted to routes/docker.js
app.use('/api', createDockerRouter({
  DOCKER_CONTROL_ENABLED, DOCKER_COMPOSE_FILE, DOCKER_PROJECT_DIR, DOCKER_ENV_FILE,
  LLM_CONFIG, DEVICE_PROFILE, DEVICE_PROFILES, PRIMARY_LLM_URL_CANDIDATES,
  DOCKER_RUNNER_URL, MODEL_PULL_TIMEOUT_MS,
  BB_MCP_ENABLED, BB_MCP_URL, NEMOCLAW_URL, IN_DOCKER, WORKSPACE_ROOT,
  getServiceRegistry, runComposeAction, resolvePrimaryLlmUrl,
  fetchOllamaModels, fetchDockerRunnerModels, checkModelInRunnerList,
  checkTcpService, checkHttpService, normalizeOllamaModelName,
  execFileAsync,
  pullStatus, eventBus, logStructured, activeDockerRunnerModelRef,
}));


/**
 * List all website output client slugs.
 */
app.get('/api/content/clients', async (req, res) => {
  try {
    let entries;
    try {
      entries = await readdir(WEBSITE_OUTPUT_DIR);
    } catch {
      return res.json({ success: true, clients: [] });
    }
    const clients = [];
    for (const entry of entries) {
      try {
        const s = await stat(join(WEBSITE_OUTPUT_DIR, entry));
        if (s.isDirectory()) clients.push(entry);
      } catch { /* skip */ }
    }
    res.json({ success: true, clients });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * List all files for a given client slug (recursive).
 */
app.get('/api/content/clients/:slug/files', async (req, res) => {
  const { slug } = req.params;
  if (!/^[\w-]+$/.test(slug)) return res.status(400).json({ success: false, error: 'Invalid slug' });
  const clientDir = join(WEBSITE_OUTPUT_DIR, slug);
  try {
    const files = [];
    async function walk(dir, prefix) {
      let entries;
      try { entries = await readdir(dir); } catch { return; }
      for (const entry of entries) {
        const full = join(dir, entry);
        const rel  = prefix ? `${prefix}/${entry}` : entry;
        try {
          const s = await stat(full);
          if (s.isDirectory()) {
            await walk(full, rel);
          } else {
            files.push({ path: rel, size: s.size, mtime: s.mtime });
          }
        } catch { /* skip */ }
      }
    }
    await walk(clientDir, '');
    res.json({ success: true, slug, files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Download a specific generated file.
 * GET /api/content/download/:slug/:path  (path is /-separated subdir+filename)
 */
app.get('/api/content/download/:slug/*', (req, res) => {
  const { slug } = req.params;
  if (!/^[\w-]+$/.test(slug)) return res.status(400).json({ success: false, error: 'Invalid slug' });
  const filePath = req.params[0];
  if (!filePath) return res.status(400).json({ success: false, error: 'Missing file path' });
  const fullPath = resolvePath(join(WEBSITE_OUTPUT_DIR, slug, filePath));
  if (!fullPath.startsWith(resolvePath(WEBSITE_OUTPUT_DIR))) {
    return res.status(403).json({ success: false, error: 'Path traversal blocked' });
  }
  if (!existsSync(fullPath)) return res.status(404).json({ success: false, error: 'File not found' });
  res.download(fullPath);
});

/**
 * Get system information
 */
app.get('/api/system/info', async (req, res) => {
  try {
    const primaryResolution = await resolvePrimaryLlmUrl();
    const systemInfo = {
      platform: process.platform,
      nodeVersion: process.version,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: {
        port: PORT,
        llmEndpoints: Object.keys(LLM_CONFIG),
        primaryLlmResolvedUrl: primaryResolution.url,
        primaryLlmCandidates: PRIMARY_LLM_URL_CANDIDATES,
        dockerControlEnabled: DOCKER_CONTROL_ENABLED,
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
    const primaryResolution = await resolvePrimaryLlmUrl();
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
          const endpointUrl = key === 'primary' ? primaryResolution.url : config.url;
          const response = await axios.get(`${endpointUrl}/api/tags`, { timeout: 5000 });
          const endpointModels = response.data.models?.map(m => ({
            id: key,
            endpoint: config.name,
            endpointUrl,
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

// Session routes extracted to routes/sessions.js
app.use('/api/sessions', createSessionsRouter({
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
}));



// Task routes extracted to routes/tasks.js
app.use('/api', tasksRouter);

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
app.use('/api/metrics', createMetricsRouter({ sessions, eventBus }));


/**
 * GET /api/experiences
 * Return available experience configs for the UI
 */
app.get('/api/experiences', (req, res) => {
  res.json({
    success: true,
    experiences: getPublicExperienceConfigs(PUBLIC_DEMO_MODE),
    demoMode: {
      enabled: PUBLIC_DEMO_MODE,
      enforcedExperience: PUBLIC_DEMO_MODE ? DEMO_EXPERIENCE : null
    }
  });
});

/**
 * Tool servers (MCP) — back the content_gen / website experiences.
 *
 * GET  /api/tools                 → reachability of each tool server
 * GET  /api/tools/:toolKey/tools  → MCP tools/list proxied to the tool server
 * POST /api/tools/:toolKey/call   → MCP tools/call (body: { name, arguments })
 *
 * Start/stop of the underlying containers goes through the existing
 * /api/system/services/:serviceKey/:action routes (tool_content_gen, tool_website).
 */

// Streamable HTTP MCP responses arrive either as plain JSON or as an SSE
// stream with the JSON-RPC payload in `data:` lines. Returns the parsed
// JSON-RPC message carrying a result/error, or null if unparseable.
function parseMcpRpcResponse(rawBody, contentType = '') {
  const body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? '');
  if (String(contentType).includes('text/event-stream')) {
    const messages = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .map((chunk) => {
        try { return JSON.parse(chunk); } catch { return null; }
      })
      .filter(Boolean);
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].result !== undefined || messages[i].error !== undefined) {
        return messages[i];
      }
    }
    return null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function mcpRequest(baseUrl, method, params = {}, timeoutMs = 15000) {
  const response = await axios.post(
    `${baseUrl}/mcp`,
    { jsonrpc: '2.0', id: randomUUID(), method, params },
    {
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      responseType: 'text',
      transformResponse: [(data) => data],
      validateStatus: () => true,
    }
  );

  if (response.status >= 400) {
    throw new Error(`tool server responded ${response.status} for ${method}`);
  }
  const rpc = parseMcpRpcResponse(response.data, response.headers?.['content-type']);
  if (!rpc) {
    throw new Error(`tool server returned an unparseable MCP response for ${method}`);
  }
  if (rpc.error) {
    throw new Error(rpc.error.message || `MCP error for ${method}`);
  }
  return rpc.result;
}

app.get('/api/tools', async (req, res) => {
  const tools = await Promise.all(
    Object.values(TOOL_SERVERS).map(async (tool) => {
      let running = false;
      let health = null;
      try {
        const probe = await axios.get(`${tool.url}/health`, { timeout: 3000 });
        running = true;
        health = probe.data || null;
      } catch {
        running = false;
      }
      return {
        key: tool.key,
        name: tool.name,
        description: tool.description,
        url: tool.url,
        serviceKey: tool.serviceKey,
        composeService: tool.composeService,
        ports: tool.ports,
        running,
        status: running ? 'healthy' : 'unavailable',
        health,
      };
    })
  );

  res.json({ success: true, dockerControlEnabled: DOCKER_CONTROL_ENABLED, tools });
});

app.get('/api/tools/:toolKey/tools', async (req, res) => {
  const tool = TOOL_SERVERS[req.params.toolKey];
  if (!tool) {
    return res.status(404).json({ success: false, error: `Unknown tool server: ${req.params.toolKey}` });
  }

  try {
    const result = await mcpRequest(tool.url, 'tools/list');
    res.json({ success: true, tools: result?.tools || [] });
  } catch (error) {
    logStructured('error', 'tool_list_failed', { tool: tool.key, error: error.message });
    res.status(502).json({ success: false, error: `Tool server unreachable: ${error.message}` });
  }
});

app.post('/api/tools/:toolKey/call', async (req, res) => {
  const tool = TOOL_SERVERS[req.params.toolKey];
  if (!tool) {
    return res.status(404).json({ success: false, error: `Unknown tool server: ${req.params.toolKey}` });
  }

  const { name, arguments: toolArgs } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ success: false, error: 'Tool name is required' });
  }

  eventBus.emit('tool_call', {
    toolServer: tool.key,
    tool: name,
    experience: null,
    endpoint: null,
  });

  try {
    const result = await mcpRequest(tool.url, 'tools/call', {
      name,
      arguments: toolArgs && typeof toolArgs === 'object' ? toolArgs : {},
    }, TOOL_CALL_TIMEOUT_MS);

    const textContent = (result?.content || [])
      .filter((item) => item?.type === 'text')
      .map((item) => item.text)
      .join('\n');

    eventBus.emit('tool_call_completed', {
      toolServer: tool.key,
      tool: name,
      experience: null,
      endpoint: null,
    });

    res.json({ success: true, tool: name, isError: !!result?.isError, content: textContent, raw: result });
  } catch (error) {
    logStructured('error', 'tool_call_failed', { tool: tool.key, name, error: error.message });
    eventBus.emit('tool_call_failed', {
      toolServer: tool.key,
      tool: name,
      experience: null,
      endpoint: null,
      metadata: { error: error.message },
    });
    res.status(502).json({ success: false, error: `Tool call failed: ${error.message}` });
  }
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
      totalCreated: sessionCounterRef.current
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


// Workspace routes extracted to routes/workspace.js
app.use('/api', workspaceRouter);

// ── Workspace path helper (also used by agent tool harness) ───────────────────
function resolveWorkspacePath(reqPath) {
  if (!WORKSPACE_ROOT) return null;
  const safe = reqPath ? reqPath.replace(/\\/g, '/').replace(/^\/+/, '') : '';
  const abs = resolvePath(WORKSPACE_ROOT, safe);
  if (abs !== WORKSPACE_ROOT && !abs.startsWith(WORKSPACE_ROOT + '/')) return null;
  return abs;
}

// ── Agent tool harness ─────────────────────────────────────────────────────────

function getExperienceTools(experience) {
  switch (experience) {
    case 'developer': return WORKSPACE_ROOT ? DEVELOPER_TOOLS : [];
    case 'research': return RESEARCH_TOOLS;
    case 'website': return WEBSITE_AGENT_TOOLS;
    default: return [];
  }
}

const BASH_BLOCKLIST = ['rm -rf /', 'dd if=', ':(){ :|:& };:', '> /dev/sd', 'mkfs'];

async function callAgentTool(toolName, toolArgs, session) {
  try {
    if (toolName === 'bash') {
      if (!WORKSPACE_ROOT) return JSON.stringify({ error: 'Workspace not mounted (WORKSPACE_ROOT not set)' });
      const { command } = toolArgs;
      if (BASH_BLOCKLIST.some(p => String(command).includes(p))) {
        return JSON.stringify({ error: 'Command blocked by safety policy' });
      }
      try {
        const { stdout, stderr } = await execAsync(String(command), { cwd: WORKSPACE_ROOT, timeout: 30000, shell: true });
        return JSON.stringify({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 });
      } catch (err) {
        return JSON.stringify({ stdout: (err.stdout || '').trim(), stderr: (err.stderr || err.message).trim(), exitCode: err.code || 1 });
      }
    }

    if (toolName === 'read_file') {
      if (!WORKSPACE_ROOT) return JSON.stringify({ error: 'Workspace not mounted' });
      const abs = resolveWorkspacePath(toolArgs.path);
      if (!abs) return JSON.stringify({ error: 'Invalid path (path traversal detected)' });
      try {
        const s = await stat(abs);
        if (s.size > 512 * 1024) return JSON.stringify({ error: 'File too large (> 512 KB)' });
        const content = await readFile(abs, 'utf8');
        return JSON.stringify({ content, path: toolArgs.path });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    }

    if (toolName === 'write_file') {
      if (!WORKSPACE_ROOT) return JSON.stringify({ error: 'Workspace not mounted' });
      const abs = resolveWorkspacePath(toolArgs.path);
      if (!abs) return JSON.stringify({ error: 'Invalid path' });
      try {
        await mkdir(resolvePath(abs, '..'), { recursive: true });
        await writeFile(abs, String(toolArgs.content), 'utf8');
        return JSON.stringify({ success: true, path: toolArgs.path, bytes: Buffer.byteLength(String(toolArgs.content), 'utf8') });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    }

    if (toolName === 'list_files') {
      if (!WORKSPACE_ROOT) return JSON.stringify({ error: 'Workspace not mounted' });
      const abs = resolveWorkspacePath(toolArgs.path || '');
      if (!abs) return JSON.stringify({ error: 'Invalid path' });
      try {
        const entries = await readdir(abs, { withFileTypes: true });
        return JSON.stringify({ entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })) });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    }

    if (toolName === 'web_search') {
      const query = String(toolArgs.query || '').slice(0, 200);
      const resp = await axios.get(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { timeout: 8000 }
      );
      const d = resp.data;
      return JSON.stringify({
        answer: d.Answer || '',
        abstract: d.AbstractText || '',
        abstractSource: d.AbstractSource || '',
        abstractUrl: d.AbstractURL || '',
        relatedTopics: (d.RelatedTopics || []).slice(0, 6).map(t => ({ text: t.Text, url: t.FirstURL })).filter(t => t.text)
      });
    }

    if (toolName === 'write_artifact') {
      if (!WORKSPACE_ROOT) return JSON.stringify({ error: 'Workspace not mounted' });
      const filename = String(toolArgs.filename || 'artifact.md').replace(/[/\\]/g, '-');
      const abs = resolvePath(WORKSPACE_ROOT, 'artifacts', filename);
      if (!abs.startsWith(WORKSPACE_ROOT)) return JSON.stringify({ error: 'Invalid filename' });
      try {
        await mkdir(resolvePath(abs, '..'), { recursive: true });
        await writeFile(abs, String(toolArgs.content), 'utf8');
        return JSON.stringify({ success: true, path: `artifacts/${filename}` });
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    }

    if (toolName === 'save_website_file') {
      const result = await mcpRequest(TOOL_SERVERS.website.url, 'tools/call', {
        name: 'save_file',
        arguments: { slug: toolArgs.slug, filename: toolArgs.filename, content: toolArgs.content }
      });
      const text = (result?.content || []).filter(i => i?.type === 'text').map(i => i.text).join('\n');
      return JSON.stringify({ success: true, content: text || 'File saved.' });
    }

    if (toolName === 'list_website_files') {
      const result = await mcpRequest(TOOL_SERVERS.website.url, 'tools/call', {
        name: 'list_client_files',
        arguments: { slug: toolArgs.slug }
      });
      const text = (result?.content || []).filter(i => i?.type === 'text').map(i => i.text).join('\n');
      return JSON.stringify({ files: text });
    }

    if (toolName === 'discover_leads') {
      const result = await mcpRequest(TOOL_SERVERS.website.url, 'tools/call', {
        name: 'discover_leads',
        arguments: { location: toolArgs.location, business_type: toolArgs.business_type }
      });
      const text = (result?.content || []).filter(i => i?.type === 'text').map(i => i.text).join('\n');
      return JSON.stringify({ leads: text });
    }

    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

async function runAgentLoop(msgs, apiStyle, llmUrl, llmHeaders, tools, session) {
  const MAX_ITERATIONS = 5;
  const toolLog = [];
  const localMsgs = [...msgs];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const reqBody = { model: session.model, messages: localMsgs, stream: false };
    if (tools.length > 0) reqBody.tools = tools;

    const response = await (apiStyle === 'openai'
      ? axios.post(`${llmUrl}/chat/completions`, reqBody, { headers: llmHeaders, timeout: 120000 })
      : axios.post(`${llmUrl}/api/chat`, reqBody, { headers: llmHeaders, timeout: 120000 }));

    const msg = response.data.message || response.data.choices?.[0]?.message;
    const toolCalls = msg?.tool_calls || [];

    if (toolCalls.length === 0) {
      return { content: msg?.content || 'No response received', toolLog };
    }

    localMsgs.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const name = tc.function?.name || tc.name;
      const rawArgs = tc.function?.arguments || tc.arguments || '{}';
      const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
      const callId = tc.id || randomUUID();

      const result = await callAgentTool(name, args, session);
      toolLog.push({ name, args, result: JSON.parse(result), callId });

      if (apiStyle === 'openai') {
        localMsgs.push({ role: 'tool', tool_call_id: callId, content: result });
      } else {
        localMsgs.push({ role: 'tool', content: result });
      }
    }
  }

  const reqBody = { model: session.model, messages: localMsgs, stream: false };
  const response = await (apiStyle === 'openai'
    ? axios.post(`${llmUrl}/chat/completions`, reqBody, { headers: llmHeaders, timeout: 120000 })
    : axios.post(`${llmUrl}/api/chat`, reqBody, { headers: llmHeaders, timeout: 120000 }));
  const msg = response.data.message || response.data.choices?.[0]?.message;
  return { content: msg?.content || 'No response received', toolLog };
}

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

    // Probe Docker Model Runner reachability on startup so the log tells us immediately
    // if model-runner.docker.internal isn't resolving (common when not using Docker Desktop).
    checkHttpService(`${DOCKER_RUNNER_URL}/models`, 3000)
      .then(() => logStructured('info', 'docker_runner_reachable', { url: DOCKER_RUNNER_URL }))
      .catch(() => logStructured('warn', 'docker_runner_unreachable', {
        url: DOCKER_RUNNER_URL,
        hint: 'Enable Docker Desktop Model Runner or set DOCKER_RUNNER_URL in .env'
      }));
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
