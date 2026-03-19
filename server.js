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

// Local LLM configuration
const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL || 'http://localhost:8080';
const NEMOCLAW_URL = process.env.NEMOCLAW_URL || 'http://localhost:8081';

// Session management
const sessions = new Map();
let sessionCounter = 0;

// Middleware
app.use(cors());
app.use(express.json());

// Static files
app.use(express.static(join(__dirname, 'dist')));

// API Routes

/**
 * Get available models
 */
app.get('/api/models', async (req, res) => {
  try {
    const response = await axios.get(`${LOCAL_LLM_URL}/api/tags`);
    const models = response.data.models?.map(m => ({
      name: m.name,
      model: m.name.split(':')[0],
      size: m.details?.parameter_size || 'unknown'
    })) || [
      { name: 'mistral', model: 'mistral', size: '7B' },
      { name: 'qwen', model: 'qwen', size: '7B' }
    ];
    res.json({ success: true, models });
  } catch (error) {
    console.error('Error fetching models:', error.message);
    res.json({
      success: true,
      models: [
        { name: 'mistral', model: 'mistral', size: '7B' },
        { name: 'qwen', model: 'qwen', size: '7B' }
      ]
    });
  }
});

/**
 * Create a new agent session (tmux-like)
 */
app.post('/api/sessions', (req, res) => {
  const { model = 'mistral', name = `session-${++sessionCounter}` } = req.body;
  
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const session = {
    id: sessionId,
    name,
    model,
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
  
  const { message, useNemoClaw = false } = req.body;
  
  if (!message) {
    return res.status(400).json({ success: false, error: 'Message required' });
  }
  
  // Add user message to history
  session.messages.push({ role: 'user', content: message, timestamp: new Date() });
  
  try {
    // Route through Nemoclaw if enabled (for safety), otherwise use local LLM directly
    const apiUrl = useNemoClaw ? NEMOCLAW_URL : LOCAL_LLM_URL;
    
    const response = await axios.post(`${apiUrl}/api/generate`, {
      model: session.model,
      prompt: message,
      stream: false,
      temperature: 0.7,
      top_p: 0.9
    });
    
    const assistantMessage = response.data.response || 'No response generated';
    session.messages.push({
      role: 'assistant',
      content: assistantMessage,
      model: session.model,
      timestamp: new Date()
    });
    
    session.updatedAt = new Date();
    
    res.json({
      success: true,
      message: assistantMessage,
      sessionId: session.id,
      model: session.model,
      totalMessages: session.messages.length
    });
  } catch (error) {
    console.error('Error calling model:', error.message);
    res.status(500).json({
      success: false,
      error: `Failed to call model: ${error.message}`
    });
  }
});

/**
 * Switch model in a session
 */
app.put('/api/sessions/:id/model', (req, res) => {
  const session = sessions.get(req.params.id);
  
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  
  const { model } = req.body;
  
  if (!model) {
    return res.status(400).json({ success: false, error: 'Model required' });
  }
  
  session.model = model;
  session.updatedAt = new Date();
  
  res.json({
    success: true,
    message: `Switched to model: ${model}`,
    session: {
      id: session.id,
      name: session.name,
      model: session.model
    }
  });
});

/**
 * Delete session
 */
app.delete('/api/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }
  
  sessions.delete(req.params.id);
  
  res.json({ success: true, message: 'Session deleted' });
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    timestamp: new Date(),
    endpoints: {
      models: '/api/models',
      sessions: '/api/sessions',
      health: '/api/health'
    }
  });
});

// Serve SPA
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║          Agent Dashboard Server Running                   ║
╠═══════════════════════════════════════════════════════════╣
║ 🌐 Web UI:        http://localhost:${PORT}                  ║
║ 🤖 Local LLM:     ${LOCAL_LLM_URL}                        ║
║ 🛡️  NemoClaw:     ${NEMOCLAW_URL}                         ║
║ 📊 API Docs:      http://localhost:${PORT}/api/health     ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
