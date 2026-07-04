/**
 * Tests for system info API
 * GET /api/system/info — returns platform, node version, uptime, memory, environment
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';

const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

try {
  console.log('System info API tests');

  const res = await fetch(`${base}/api/system/info`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true, 'returns success');
  assert.ok(data.system, 'has system object');

  // Check expected fields
  assert.ok(data.system.platform, 'has platform');
  assert.ok(data.system.nodeVersion, 'has nodeVersion');
  assert.ok(typeof data.system.uptime === 'number', 'uptime is number');
  assert.ok(data.system.memory, 'has memory info');
  assert.ok(data.system.environment, 'has environment');

  // Environment should have key config fields
  const env = data.system.environment;
  assert.ok(env.port, 'environment has port');
  assert.ok(Array.isArray(env.llmEndpoints), 'llmEndpoints is array');
  assert.ok(typeof env.dockerControlEnabled === 'boolean', 'dockerControlEnabled is boolean');

  console.log('✓ All system info tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
