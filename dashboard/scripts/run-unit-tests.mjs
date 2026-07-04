#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testsDir = join(__dirname, '..', 'tests');

const INTEGRATION_TESTS = new Set([
  'tracing-status.js', 'websocket-events.js', 'demo-mode.js', 'metrics-api.js',
  'task-queue.js', 'webhooks.js', 'webhook-hmac.js', 'bb-mcp-opt-in.js',
  'system-services.js', 'tools-api.js', 'functional-health.js',
  'e2e-chat.js', 'e2e-agents.js', 'demo-experience-lock.js',
  'e2e-services.js', 'test-chat.js',
]);

const SPECIAL = new Set(['safety-layer.js']);

const files = readdirSync(testsDir)
  .filter(f => f.endsWith('.js') && !INTEGRATION_TESTS.has(f) && !SPECIAL.has(f))
  .sort();

let passed = 0;
let failed = 0;

// safety-layer.js runs without --experimental-vm-modules
for (const f of ['safety-layer.js', ...files]) {
  const path = join(testsDir, f);
  const args = f === 'safety-layer.js' ? [path] : ['--experimental-vm-modules', path];
  try {
    execFileSync(process.execPath, args, { stdio: 'inherit' });
    passed++;
  } catch {
    failed++;
    console.error(`\n✗ FAILED: ${f}\n`);
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} unit tests`);
if (failed > 0) process.exit(1);
