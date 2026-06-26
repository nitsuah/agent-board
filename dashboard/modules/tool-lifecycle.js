/**
 * JIT tool lifecycle helpers.
 *
 * ensureToolReady(toolKey, TOOL_SERVERS, serviceRegistry, dockerControlEnabled, runComposeAction, logStructured)
 *   → { ready: bool, alreadyRunning: bool, started: bool, error?: string }
 *
 * Used by session-message.js and task-runner to auto-start MCP tool servers
 * when a session/task that requires them dispatches its first message.
 */

import axios from 'axios';

const HEALTH_TIMEOUT_MS = 3000;
const START_WAIT_MAX_MS = 30_000;
const START_POLL_INTERVAL_MS = 1500;

async function isToolHealthy(url) {
  try {
    const res = await axios.get(`${url}/health`, { timeout: HEALTH_TIMEOUT_MS });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

async function waitForHealthy(url, maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isToolHealthy(url)) return true;
    await new Promise(r => setTimeout(r, START_POLL_INTERVAL_MS));
  }
  return false;
}

export async function ensureToolReady(toolKey, TOOL_SERVERS, serviceRegistry, dockerControlEnabled, runComposeAction, logStructured) {
  const tool = TOOL_SERVERS[toolKey];
  if (!tool) return { ready: false, alreadyRunning: false, started: false, error: `Unknown tool: ${toolKey}` };

  if (await isToolHealthy(tool.url)) {
    return { ready: true, alreadyRunning: true, started: false };
  }

  if (!dockerControlEnabled) {
    return { ready: false, alreadyRunning: false, started: false, error: `Tool ${toolKey} is offline. Enable AGENT_BOARD_ENABLE_DOCKER_CONTROL to auto-start.` };
  }

  const svcEntry = serviceRegistry?.[tool.serviceKey];
  if (!svcEntry?.composeService) {
    return { ready: false, alreadyRunning: false, started: false, error: `No compose service mapped for ${toolKey}` };
  }

  logStructured?.('info', 'tool_lifecycle_start', { toolKey, composeService: svcEntry.composeService });

  try {
    await runComposeAction('start', svcEntry.composeService, svcEntry.composeProfile || 'tools');
  } catch (err) {
    return { ready: false, alreadyRunning: false, started: false, error: `Failed to start ${toolKey}: ${err.message}` };
  }

  const healthy = await waitForHealthy(tool.url, START_WAIT_MAX_MS);
  logStructured?.('info', 'tool_lifecycle_started', { toolKey, healthy });
  return { ready: healthy, alreadyRunning: false, started: true, error: healthy ? undefined : `${toolKey} started but health check timed out` };
}

/**
 * Map an experience name to its required tool key (if any).
 * Returns null when the experience has no tool dependency.
 */
export function experienceToolKey(experience, TOOL_SERVERS) {
  for (const [key, tool] of Object.entries(TOOL_SERVERS)) {
    if (tool.experience === experience || key === experience) return key;
  }
  // Explicit mapping for built-in experiences
  if (experience === 'content_gen') return 'content_gen';
  if (experience === 'website') return 'website';
  return null;
}
