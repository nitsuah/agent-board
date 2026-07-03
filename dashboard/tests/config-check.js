/**
 * Tests for system config check API
 * GET /api/system/config-check — validates service reachability
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';

const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

try {
  console.log('Config check API tests');

  const res = await fetch(`${base}/api/system/config-check`);
  assert.ok([200, 503].includes(res.status), 'config-check returns valid status');
  const data = await res.json();

  // Should return check results object
  assert.ok(typeof data === 'object', 'returns object');
  // May have checks array or results field depending on implementation
  if (data.checks) {
    assert.ok(Array.isArray(data.checks), 'checks is array');
  }

  console.log('✓ All config check tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
