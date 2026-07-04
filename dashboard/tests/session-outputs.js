/**
 * Tests for session outputs API
 * GET /api/sessions/:id/outputs, GET /api/sessions/:id/outputs/:filename
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
  console.log('Session outputs tests');

  // Create a session
  const sess = await req('/api/sessions', { method: 'POST', data: { endpoint: 'primary' } });
  assert.equal(sess.status, 200);
  const sessionId = sess.data.session.id;

  // List outputs for new session — should be empty array
  const outputs = await req(`/api/sessions/${sessionId}/outputs`);
  assert.equal(outputs.status, 200);
  assert.ok(Array.isArray(outputs.data), 'outputs returns array');
  assert.equal(outputs.data.length, 0, 'new session has no outputs');

  // Download nonexistent output — should 404
  const dl = await fetch(`${base}/api/sessions/${sessionId}/outputs/nonexistent.txt`);
  assert.ok(dl.status >= 400, 'missing output download returns error');

  // Path traversal in filename — should be blocked
  const traverse = await fetch(`${base}/api/sessions/${sessionId}/outputs/..%2F..%2Fetc%2Fpasswd`);
  assert.ok(traverse.status >= 400, 'path traversal in output filename blocked');

  // List outputs for nonexistent session — should return empty array (graceful)
  const noSess = await req('/api/sessions/nonexistent_session_xyz/outputs');
  assert.equal(noSess.status, 200);
  assert.ok(Array.isArray(noSess.data), 'nonexistent session outputs returns array');

  // Clean up
  await req(`/api/sessions/${sessionId}`, { method: 'DELETE' });

  console.log('✓ All session outputs tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
