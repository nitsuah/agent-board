/**
 * Tests for demo mode experience locking on per-session experience switch
 * When PUBLIC_DEMO_MODE=true, PATCH /sessions/:id/experience should reject non-safechat
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
process.env.PUBLIC_DEMO_MODE = 'true';

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
  console.log('Demo mode experience lock tests');

  // Verify demo mode is active
  const demoStatus = await req('/api/demo-mode');
  assert.equal(demoStatus.data.enabled, true, 'demo mode should be active');

  // Create session (demo forces safechat)
  const sess = await req('/api/sessions', { method: 'POST', data: { endpoint: 'primary' } });
  assert.equal(sess.status, 200);
  const sessionId = sess.data.session.id;

  // Switching to safechat should work (already in safechat)
  const safe = await req(`/api/sessions/${sessionId}/experience`, {
    method: 'PATCH',
    data: { experience: 'safechat' },
  });
  assert.equal(safe.status, 200, 'safechat switch should succeed in demo mode');

  // Switching to nemoclaw should be blocked
  const nemo = await req(`/api/sessions/${sessionId}/experience`, {
    method: 'PATCH',
    data: { experience: 'nemoclaw' },
  });
  assert.equal(nemo.status, 403, 'non-safechat should be blocked in demo mode');

  // Switching to developer should be blocked
  const dev = await req(`/api/sessions/${sessionId}/experience`, {
    method: 'PATCH',
    data: { experience: 'developer' },
  });
  assert.equal(dev.status, 403, 'developer should be blocked in demo mode');

  // Clean up
  await req(`/api/sessions/${sessionId}`, { method: 'DELETE' });

  console.log('✓ All demo experience lock tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
