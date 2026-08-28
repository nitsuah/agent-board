#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testsDir = join(__dirname, '..', 'tests');

// Only suites that genuinely need something outside this process are excluded:
// e2e-chat / e2e-agents / test-chat need a live LLM to answer prompts, and
// e2e-services needs a running Docker stack. Everything else starts the app
// in-process (directly, or via tests/helpers/test-server.js), so it belongs in
// the unit run and in the coverage numbers.
const INTEGRATION_TESTS = new Set([
  'e2e-chat.js', 'e2e-agents.js', 'e2e-services.js', 'test-chat.js',
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
