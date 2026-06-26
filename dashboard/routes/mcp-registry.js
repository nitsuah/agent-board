/**
 * Multi-MCP orchestration registry
 *
 * GET  /api/mcp-registry           — list all declared MCP providers with live status
 * GET  /api/mcp-registry/:key      — single provider details
 * POST /api/mcp-registry/:key/ensure — JIT spin-up (delegates to tool-lifecycle)
 *
 * The registry is driven by config/mcp-registry.json. Operators add entries there
 * to surface new MCP containers to agents without touching docker-compose.yml.
 */
import express from 'express';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', 'config', 'mcp-registry.json');
const PROBE_TIMEOUT_MS = 3000;

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) return { providers: [] };
  try {
    const raw = readFileSync(REGISTRY_PATH, 'utf8');
    // Expand ${VAR:-default} env substitution (simple single-pass)
    const expanded = raw.replace(/\$\{(\w+)(?::-(.*?))?\}/g, (_, name, fallback = '') => {
      return process.env[name] || fallback;
    });
    return JSON.parse(expanded);
  } catch { return { providers: [] }; }
}

async function probeProvider(provider) {
  try {
    await axios.get(`${provider.url}${provider.healthPath || '/health'}`, { timeout: PROBE_TIMEOUT_MS });
    return { running: true, status: 'healthy' };
  } catch {
    return { running: false, status: 'unavailable' };
  }
}

export function createMcpRegistryRouter({ logStructured, TOOL_SERVERS, serviceRegistry, DOCKER_CONTROL_ENABLED, runComposeAction }) {
  const router = express.Router();

  router.get('/mcp-registry', async (req, res) => {
    const { providers } = loadRegistry();
    const withStatus = await Promise.all(
      providers.map(async (p) => {
        const { running, status } = await probeProvider(p);
        return { ...p, running, status };
      })
    );
    res.json({ success: true, providers: withStatus, registryPath: REGISTRY_PATH });
  });

  router.get('/mcp-registry/:key', async (req, res) => {
    const { providers } = loadRegistry();
    const provider = providers.find(p => p.key === req.params.key);
    if (!provider) return res.status(404).json({ success: false, error: `Unknown MCP provider: ${req.params.key}` });
    const { running, status } = await probeProvider(provider);
    res.json({ success: true, provider: { ...provider, running, status } });
  });

  router.post('/mcp-registry/:key/ensure', async (req, res) => {
    const { providers } = loadRegistry();
    const provider = providers.find(p => p.key === req.params.key);
    if (!provider) return res.status(404).json({ success: false, error: `Unknown MCP provider: ${req.params.key}` });

    const { running } = await probeProvider(provider);
    if (running) return res.json({ success: true, ready: true, alreadyRunning: true, started: false });

    if (!DOCKER_CONTROL_ENABLED) {
      return res.status(503).json({
        success: false, ready: false,
        error: `${provider.name} is offline. Enable AGENT_BOARD_ENABLE_DOCKER_CONTROL to auto-start.`,
      });
    }

    logStructured('info', 'mcp_registry_ensure', { key: provider.key, composeService: provider.composeService });
    try {
      await runComposeAction('start', provider.composeService, provider.composeProfile);
    } catch (err) {
      return res.status(503).json({ success: false, ready: false, error: `Failed to start ${provider.key}: ${err.message}` });
    }

    // Wait up to 20s for health
    const deadline = Date.now() + 20_000;
    let healthy = false;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 1500));
      const check = await probeProvider(provider);
      if (check.running) { healthy = true; break; }
    }

    res.json({ success: healthy, ready: healthy, alreadyRunning: false, started: true,
      error: healthy ? undefined : `${provider.key} started but health check timed out` });
  });

  router.post('/mcp-registry/:key/stop', async (req, res) => {
    const { providers } = loadRegistry();
    const provider = providers.find(p => p.key === req.params.key);
    if (!provider) return res.status(404).json({ success: false, error: `Unknown MCP provider: ${req.params.key}` });

    if (!DOCKER_CONTROL_ENABLED) {
      return res.status(503).json({
        success: false,
        error: `Docker control disabled. Enable AGENT_BOARD_ENABLE_DOCKER_CONTROL to stop containers.`,
      });
    }

    logStructured('info', 'mcp_registry_stop', { key: provider.key, composeService: provider.composeService });
    try {
      await runComposeAction('stop', provider.composeService, provider.composeProfile);
      res.json({ success: true, stopped: true });
    } catch (err) {
      res.status(500).json({ success: false, error: `Failed to stop ${provider.key}: ${err.message}` });
    }
  });

  return router;
}
