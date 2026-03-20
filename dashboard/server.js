import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// LLM Configuration - Support multiple endpoints
// apiStyle: 'ollama' uses /api/chat; 'openai' uses /v1/chat/completions
const LLM_CONFIG = {
  primary: {
    url: process.env.PRIMARY_LLM_URL || 'http://llm_qwen_coder:8080',
    name: 'Llama2 (local)',
    type: 'general',
    apiStyle: 'ollama',
    defaultModel: 'llama2:latest'
  },
  docker_runner: {
    url: process.env.DOCKER_RUNNER_URL || 'http://model-runner.docker.internal/engines/llama.cpp/v1',
    name: 'Docker Model Runner',
    type: 'general',
    apiStyle: 'openai',
    defaultModel: process.env.DOCKER_RUNNER_MODEL || 'ai/qwen3-coder:latest'
  },
  glm_flash: {
    url: process.env.GLM_FLASH_URL || 'http://llm_glm_flash:8080',
    name: 'GLM-4.7-Flash',
    type: 'fast',
    apiStyle: 'ollama',
    defaultModel: 'glm-4-flash:latest'
  }
};

const NEMOCLAW_URL = process.env.NEMOCLAW_URL || 'http://localhost:9000';

// Session management
const sessions = new Map();
let sessionCounter = 0;

// Middleware
app.use(cors());
app.use(express.json());

// Static files
app.use(express.static(join(__dirname, 'dist')));

// ============ API ROUTES ============

/**
 * Check service health via HTTP (no docker CLI needed inside container)
 */
app.get('/api/docker/status', async (req, res) => {
  const serviceChecks = [
    { name: 'llm_qwen_coder', url: `${LLM_CONFIG.primary.url}/api/tags`, ports: '8081:8080' },
    { name: 'nemoclaw',       url: `${NEMOCLAW_URL}/`,                   ports: '9000:8080' },
    { name: 'llm_glm_flash',  url: `${LLM_CONFIG.glm_flash.url}/api/tags`, ports: '8082:8080' },
  ];

  const containers = {};
  for (const { name, url, ports } of serviceChecks) {
    try {
      await axios.get(url, { timeout: 3000 });
      containers[name] = { running: true, status: 'healthy', ports };
    } catch {
      containers[name] = { running: false, status: 'unavailable', ports };
    }
  }

  const dockerRunning = Object.values(containers).some(c => c.running);
  res.json({ dockerRunning, containers, networks: { agentNetwork: true }, volumes: {}, errors: [] });
});

/**
 * Start/stop Docker containers
 */
app.post('/api/docker/:action', async (req, res) => {
  const { action } = req.params;

  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid action' });
  }

  try {
    let command;
    if (action === 'start') {
      command = 'docker compose up -d';
    } else if (action === 'stop') {
      command = 'docker compose down';
    } else if (action === 'restart') {
      command = 'docker compose restart';
    }

    const { stdout, stderr } = await execAsync(command);
    res.json({
      success: true,
      action,
      output: stdout || stderr
    });
  } catch (error) {
    console.error(`Error ${action}ing Docker:`, error);
    res.json({
      success: false,
      action,
      error: error.message
    });
  }
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
    
    for (const [key, config] of Object.entries(LLM_CONFIG)) {
      try {
        const response = await axios.get(`${config.url}/api/tags`, { timeout: 5000 });
        const endpointModels = response.data.models?.map(m => ({
          id: key,
          endpoint: config.name,
          endpointUrl: config.url,
          type: config.type,
          name: m.name,
          model: m.name.split(':')[0],
          size: m.details?.parameter_size || 'unknown'
        })) || [];
        models.push(...endpointModels);
      } catch (error) {
        console.warn(`[WARNING] Could not reach ${config.name} (${config.url}):`, error.message);
      }
    }

    // Fallback if no models found
    if (models.length === 0) {
      for (const [key, config] of Object.entries(LLM_CONFIG)) {
        models.push({ id: key, endpoint: config.name, endpointUrl: config.url, type: config.type, name: config.defaultModel, model: config.defaultModel, size: 'unknown' });
      }
    }

    res.json({ success: true, models, endpoints: Object.keys(LLM_CONFIG) });
  } catch (error) {
    console.error('Error fetching models:', error.message);
    const fallback = Object.entries(LLM_CONFIG).map(([key, c]) => ({ id: key, endpoint: c.name, endpointUrl: c.url, type: c.type, name: c.defaultModel, model: c.defaultModel, size: 'unknown' }));
    res.json({ success: true, models: fallback, endpoints: Object.keys(LLM_CONFIG) });
  }
});

/**
 * Create a new agent session
 */
app.post('/api/sessions', (req, res) => {
  const { endpoint = 'primary', name = `session-${++sessionCounter}` } = req.body;
  const model = req.body.model || LLM_CONFIG[endpoint]?.defaultModel || 'llama2:latest';
  
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const session = {
    id: sessionId,
    name,
    model,
    endpoint,
    llmUrl: LLM_CONFIG[endpoint]?.url || LLM_CONFIG.primary.url,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  sessions.set(sessionId, session);
  
  res.json({
    success: true,
    session: {
      id: sessionId,
      name,
      model,
      endpoint,
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
    updatedAt: s.updatedAt
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

  // Add user message to history
  session.messages.push({ role: 'user', content: message, timestamp: new Date() });

  try {
    const llmUrl = useSafeMode ? NEMOCLAW_URL : session.llmUrl;
    const apiStyle = useSafeMode ? 'ollama' : (LLM_CONFIG[session.endpoint]?.apiStyle || 'ollama');
    const msgs = session.messages.map(m => ({ role: m.role, content: m.content }));

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
    session.messages.push({ role: 'assistant', content: assistantMessage, timestamp: new Date() });
    session.updatedAt = new Date();

    res.json({
      success: true,
      response: assistantMessage,
      endpoint: useSafeMode ? 'NemoClaw (Safe)' : session.endpoint,
      messageCount: session.messages.length
    });
  } catch (error) {
    console.error('Error calling LLM:', error.message);
    const errorMsg = `[Error] Could not reach LLM at ${session.llmUrl}: ${error.message}`;
    session.messages.push({ role: 'assistant', content: errorMsg, timestamp: new Date() });
    session.updatedAt = new Date();
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

  session.endpoint = endpoint;
  session.model = model || LLM_CONFIG[endpoint].defaultModel;
  session.llmUrl = LLM_CONFIG[endpoint].url;
  session.updatedAt = new Date();

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
    sessions.delete(req.params.id);
  }

  res.json({ success: true, deleted: exists });
});

/**
 * Health check - Comprehensive system status
 */
app.get('/api/health', async (req, res) => {
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
    }
  };

  // Check LLM endpoints
  for (const [key, config] of Object.entries(LLM_CONFIG)) {
    try {
      await axios.get(`${config.url}/api/tags`, { timeout: 3000 });
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
  console.log(`\nPress Ctrl+C to stop\n`);
});
