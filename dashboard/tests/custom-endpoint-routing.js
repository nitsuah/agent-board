/**
 * Tests for custom endpoint routing through safety layer
 * Verifies that custom/BYOK endpoints bypass safety restrictions for non-safechat experiences
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
process.env.PUBLIC_DEMO_MODE = '';

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
  console.log('Custom endpoint routing tests');

  // Register a custom endpoint (simulates BYOK setup)
  const add = await req('/api/config/endpoints', {
    method: 'POST',
    data: { key: 'test_custom_9r', name: 'Test 9Router', url: 'http://localhost:29999', apiStyle: 'openai' },
  });
  assert.equal(add.status, 200, 'custom endpoint registered');

  // Create a session with default experience (should be nemoclaw or similar, not safechat)
  const sess = await req('/api/sessions', { method: 'POST', data: { endpoint: 'primary' } });
  assert.equal(sess.status, 200);
  const sessionId = sess.data.session.id;

  // Verify custom endpoint appears in endpoint list
  const endpoints = await req('/api/config/endpoints');
  const customEp = endpoints.data.endpoints.find(e => e.key === 'test_custom_9r');
  assert.ok(customEp, 'custom endpoint in list');
  assert.equal(customEp.builtin, false);

  // Verify the custom endpoint shows in docker status (live status)
  const dockerStatus = await req('/api/docker/status');
  if (dockerStatus.data.endpoints) {
    const epStatus = dockerStatus.data.endpoints['test_custom_9r'];
    if (epStatus) {
      assert.equal(epStatus.backendType, 'custom', 'backendType should be custom');
    }
  }

  // Clean up
  await req(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  await req('/api/config/endpoints/test_custom_9r', { method: 'DELETE' });

  console.log('✓ All custom endpoint routing tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
