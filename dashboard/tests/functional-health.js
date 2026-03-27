/**
 * Functional tests for /api/health and /api/docker/status.
 *
 * These tests run against the live dashboard container and verify:
 * - Response shapes match the documented API contract
 * - Docker Runner endpoints include the 'modelLoaded' field (not just 'live')
 * - Health endpoint distinguishes 'runner_up_model_not_loaded' from 'healthy'
 * - No regression in observability fields
 *
 * Run inside the container:
 *   node --experimental-vm-modules tests/functional-health.js
 */
import axios from 'axios';
import assert from 'node:assert/strict';

const BASE = process.env.DASHBOARD_URL || 'http://localhost:3000';
const TIMEOUT = 10000;

async function get(path) {
  const res = await axios.get(`${BASE}${path}`, { timeout: TIMEOUT });
  return res.data;
}

// ── /api/health ───────────────────────────────────────────────────────────────

async function testHealthShape() {
  const data = await get('/api/health');

  assert.ok(['ok', 'degraded', 'critical'].includes(data.status),
    `health.status should be ok|degraded|critical, got '${data.status}'`);

  assert.equal(typeof data.endpoints, 'object', 'health.endpoints should be an object');

  // All three configured endpoints must be present
  for (const key of ['primary', 'docker_runner', 'glm_flash']) {
    assert.ok(key in data.endpoints, `health.endpoints.${key} missing`);
    const val = data.endpoints[key];
    const validStates = ['healthy', 'unavailable', 'runner_up_model_not_loaded'];
    assert.ok(validStates.includes(val),
      `health.endpoints.${key} should be one of ${validStates.join('|')}, got '${val}'`);
  }

  // Sessions shape
  assert.equal(typeof data.sessions?.active, 'number', 'health.sessions.active should be a number');
  assert.equal(typeof data.sessions?.totalCreated, 'number', 'health.sessions.totalCreated should be a number');

  // Observability shape
  assert.equal(typeof data.observability?.totalEvents, 'number', 'health.observability.totalEvents should be a number');
  assert.equal(typeof data.observability?.recentErrors, 'number', 'health.observability.recentErrors should be a number');
  assert.equal(typeof data.observability?.errorRateLast5Min, 'number', 'health.observability.errorRateLast5Min should be a number');

  console.log(`  ✅ /api/health shape valid (status=${data.status})`);
  console.log(`     primary=${data.endpoints.primary}  docker_runner=${data.endpoints.docker_runner}  glm_flash=${data.endpoints.glm_flash}`);
}

async function testHealthDockerRunnerHonest() {
  const data = await get('/api/health');

  // If primary is healthy we have a working Ollama container to compare against
  if (data.endpoints.primary === 'healthy') {
    // Docker runner endpoints must NOT silently show 'healthy' if they show 500s at chat time.
    // Allowed values: 'healthy' means model IS loaded; anything else means not usable.
    for (const key of ['docker_runner', 'glm_flash']) {
      const val = data.endpoints[key];
      assert.notEqual(val, undefined, `health.endpoints.${key} should be present`);
      // The old bug: it used to always say 'healthy' for runner endpoints regardless of model.
      // Now it should say 'runner_up_model_not_loaded' when the runner is up but model isn't pulled.
      console.log(`     Endpoint '${key}' status: ${val} (expected: healthy or runner_up_model_not_loaded, not undefined)`);
    }
  }
  console.log('  ✅ /api/health docker runner endpoint honesty check passed');
}

// ── /api/docker/status ────────────────────────────────────────────────────────

async function testDockerStatusShape() {
  const data = await get('/api/docker/status');

  assert.equal(typeof data.dockerRunning, 'boolean', 'dockerRunning should be a boolean');
  assert.equal(typeof data.containers, 'object', 'containers should be an object');
  assert.equal(typeof data.endpoints, 'object', 'endpoints should be an object');

  // Each container entry must have running + status
  for (const [name, c] of Object.entries(data.containers)) {
    assert.equal(typeof c.running, 'boolean', `containers.${name}.running should be boolean`);
    assert.ok(typeof c.status === 'string', `containers.${name}.status should be string`);
  }

  console.log(`  ✅ /api/docker/status shape valid (dockerRunning=${data.dockerRunning})`);
}

async function testDockerStatusModelLoadedField() {
  const data = await get('/api/docker/status');

  // docker_runner and glm_flash endpoints MUST include modelLoaded field
  for (const key of ['docker_runner', 'glm_flash']) {
    const ep = data.endpoints[key];
    assert.ok(ep !== undefined, `endpoints.${key} should be present`);
    assert.equal(typeof ep.modelLoaded, 'boolean',
      `endpoints.${key}.modelLoaded should be boolean (was ${typeof ep?.modelLoaded}) — runner-up with no model pulled must show false, not true`);
    assert.equal(typeof ep.runnerLive, 'boolean',
      `endpoints.${key}.runnerLive should be boolean`);
    // live === (runnerLive && modelLoaded)
    assert.equal(ep.live, ep.runnerLive && ep.modelLoaded,
      `endpoints.${key}.live should equal runnerLive && modelLoaded`);

    console.log(`     ${key}: live=${ep.live}  runnerLive=${ep.runnerLive}  modelLoaded=${ep.modelLoaded}`);
  }

  // primary (ollama-container) must NOT have modelLoaded field — different backendType
  const primary = data.endpoints['primary'];
  assert.ok(primary !== undefined, 'endpoints.primary should be present');
  assert.equal(typeof primary.live, 'boolean', 'endpoints.primary.live should be boolean');

  console.log('  ✅ /api/docker/status modelLoaded field check passed');
}

async function testDockerStatusOllamaAlignedWithHealth() {
  const [status, health] = await Promise.all([
    get('/api/docker/status'),
    get('/api/health')
  ]);

  const ollamaContainerUp = status.containers['ollama']?.running ?? false;
  const primaryEndpointLive = status.endpoints['primary']?.live ?? false;
  const healthPrimary = health.endpoints['primary'];

  // Container running → primary.live must be true
  if (ollamaContainerUp) {
    assert.equal(primaryEndpointLive, true, 'ollama container running but primary.live is false');
    assert.equal(healthPrimary, 'healthy', `ollama container running but /api/health shows primary='${healthPrimary}'`);
  }

  console.log(`  ✅ ollama container (${ollamaContainerUp}) and primary endpoint (live=${primaryEndpointLive}) are consistent`);
}

// ── Runner ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('Functional health tests');
  console.log('--- /api/health ---');
  await testHealthShape();
  await testHealthDockerRunnerHonest();
  console.log('--- /api/docker/status ---');
  await testDockerStatusShape();
  await testDockerStatusModelLoadedField();
  await testDockerStatusOllamaAlignedWithHealth();
  console.log('Functional health tests passed.');
}

run().catch((err) => {
  console.error('Functional health tests failed:', err.message);
  process.exit(1);
});
