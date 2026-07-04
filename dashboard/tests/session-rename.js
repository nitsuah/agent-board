/**
 * Tests for session rename API
 * PATCH /api/sessions/:id/name
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
  console.log('Session rename tests');

  // Create session
  const sess = await req('/api/sessions', { method: 'POST', data: { endpoint: 'primary' } });
  assert.equal(sess.status, 200);
  const sessionId = sess.data.session.id;

  // Rename session
  const rename = await req(`/api/sessions/${sessionId}/name`, {
    method: 'PATCH',
    data: { name: 'My Test Session' },
  });
  assert.equal(rename.status, 200, 'rename succeeds');

  // Verify name persisted
  const details = await req(`/api/sessions/${sessionId}`);
  assert.equal(details.data.session.name, 'My Test Session', 'name persisted');

  // Rename nonexistent session
  const noSess = await req('/api/sessions/nonexistent_xyz/name', {
    method: 'PATCH',
    data: { name: 'foo' },
  });
  assert.equal(noSess.status, 404, 'rename nonexistent session fails');

  // Clean up
  await req(`/api/sessions/${sessionId}`, { method: 'DELETE' });

  console.log('✓ All session rename tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
