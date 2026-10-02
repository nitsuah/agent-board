#!/usr/bin/env node
/**
 * One-shot seeder for the agent sandbox (compose service `workspace-seed`).
 * Runs in its own container with the repo mounted read-only, so the agent
 * container — which executes model-supplied shell commands — never has the
 * source tree (or its .env files) mounted. Exits non-zero on failure, which
 * keeps the dashboard from starting (depends_on: service_completed_successfully).
 */
import { ensureWorkspaceSandbox } from '../modules/workspace-sandbox.js';

const log = (level, eventType, data = {}) =>
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, eventType, ...data }));

try {
  const result = await ensureWorkspaceSandbox({
    root: process.env.WORKSPACE_ROOT || '/workspace',
    source: process.env.WORKSPACE_SANDBOX_SOURCE || '/source',
    logStructured: log,
  });
  log('info', 'workspace_seed_done', result);
} catch (err) {
  log('error', 'workspace_seed_failed', { error: err.message });
  process.exit(1);
}
