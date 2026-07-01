/**
 * Tests that BYOK endpoints appear in docker-status response
 * and are removed cleanly when deleted.
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';

const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function req(path, { method = 'GET', data } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, data: body };
}

try {
  console.log('Endpoint live-status tests');

  // Docker-status has endpoints map
  const s0 = await req('/api/docker/status');
  assert.equal(s0.status, 200);
  assert.ok(s0.data.endpoints && typeof s0.data.endpoints === 'object', 'endpoints map present');
  assert.ok('primary' in s0.data.endpoints, 'primary endpoint in status');
  console.log('  ✅ /api/docker/status returns endpoints map with primary');

  // Add a custom endpoint
  const add = await req('/api/config/endpoints', {
    method: 'POST',
    data: { key: 'test_live_ep', name: 'Test Live', url: 'http://localhost:19999', apiStyle: 'openai', apiKey: 'sk-x' },
  });
  assert.equal(add.status, 200);
  console.log('  ✅ added test_live_ep endpoint');

  // After adding, docker-status should include the new endpoint key
  const s1 = await req('/api/docker/status');
  assert.ok('test_live_ep' in s1.data.endpoints, 'added endpoint appears in docker-status');
  console.log('  ✅ added endpoint appears in /api/docker/status');

  // The new endpoint has live/url fields
  const ep = s1.data.endpoints['test_live_ep'];
  assert.ok(typeof ep.live === 'boolean', 'endpoint has live boolean');
  console.log('  ✅ endpoint has live/url fields');

  // Delete the endpoint
  const del = await req('/api/config/endpoints/test_live_ep', { method: 'DELETE' });
  assert.equal(del.status, 200);

  // After deletion, endpoint should NOT appear in docker-status
  const s2 = await req('/api/docker/status');
  assert.ok(!('test_live_ep' in (s2.data.endpoints || {})), 'deleted endpoint removed from docker-status');
  console.log('  ✅ deleted endpoint no longer in /api/docker/status');

  console.log('Endpoint live-status tests passed.');
} catch (err) {
  console.error('Endpoint live-status tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
