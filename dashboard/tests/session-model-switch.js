/**
 * Tests for session model switching
 * PUT /api/sessions/:id/model — switch the active model+endpoint for a session
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
  console.log('Session model switch tests');

  // Create session (defaults to developer experience)
  const sess = await req('/api/sessions', { method: 'POST', data: { endpoint: 'primary' } });
  assert.equal(sess.status, 200);
  const sessionId = sess.data.session.id;

  // Switch model with valid endpoint
  const sw = await req(`/api/sessions/${sessionId}/model`, {
    method: 'PUT',
    data: { endpoint: 'primary', model: 'llama3.2' },
  });
  assert.equal(sw.status, 200, 'model switch succeeds');

  // Verify model changed
  const details = await req(`/api/sessions/${sessionId}`);
  assert.equal(details.data.session.model, 'llama3.2', 'model updated on session');

  // Missing endpoint should fail
  const noEp = await req(`/api/sessions/${sessionId}/model`, {
    method: 'PUT',
    data: { model: 'llama3.2' },
  });
  assert.equal(noEp.status, 400, 'missing endpoint rejected');

  // Invalid endpoint should fail
  const badEp = await req(`/api/sessions/${sessionId}/model`, {
    method: 'PUT',
    data: { endpoint: 'nonexistent_endpoint', model: 'llama3.2' },
  });
  assert.equal(badEp.status, 400, 'invalid endpoint rejected');

  // Nonexistent session
  const noSess = await req('/api/sessions/nonexistent_xyz/model', {
    method: 'PUT',
    data: { endpoint: 'primary', model: 'llama3.2' },
  });
  assert.equal(noSess.status, 404, 'model switch on nonexistent session fails');

  // Clean up
  await req(`/api/sessions/${sessionId}`, { method: 'DELETE' });

  console.log('✓ All session model switch tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
