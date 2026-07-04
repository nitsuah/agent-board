/**
 * Tests for DELETE /api/sessions/:id/messages (clear chat history)
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
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

try {
  console.log('Session clear-messages tests');

  // Create session
  const create = await req('/api/sessions', { method: 'POST', data: { userId: 'test', endpoint: 'primary', model: 'llama3.2', experience: 'developer' } });
  assert.equal(create.status, 200, 'session create should succeed');
  const sid = create.data.session.id;

  // Session starts with 0 messages — clearing still succeeds
  const clearEmpty = await req(`/api/sessions/${sid}/messages`, { method: 'DELETE' });
  assert.equal(clearEmpty.status, 200, 'clear on empty session should succeed');
  assert.equal(clearEmpty.data.cleared, 0, 'should report 0 cleared');

  // 404 for missing session
  const clearMissing = await req('/api/sessions/no-such-session/messages', { method: 'DELETE' });
  assert.equal(clearMissing.status, 404, 'clear on missing session should 404');

  // Cleanup
  await req(`/api/sessions/${sid}`, { method: 'DELETE' });

  console.log('Session clear-messages tests passed.');
} catch (err) {
  console.error('Session clear-messages tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
