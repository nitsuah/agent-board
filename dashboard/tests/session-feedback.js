/**
 * Tests for session feedback API
 * POST /api/sessions/:id/feedback — submit user feedback on assistant messages
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
  console.log('Session feedback tests');

  // Create a session
  const sess = await req('/api/sessions', { method: 'POST', data: { endpoint: 'primary' } });
  assert.equal(sess.status, 200);
  const sessionId = sess.data.session.id;

  // Feedback without required fields should fail
  const noFields = await req(`/api/sessions/${sessionId}/feedback`, {
    method: 'POST',
    data: { rating: 'positive' },
  });
  assert.equal(noFields.status, 400, 'feedback without positive boolean rejected');

  // Feedback with invalid messageIndex should fail
  const badIdx = await req(`/api/sessions/${sessionId}/feedback`, {
    method: 'POST',
    data: { positive: true, messageIndex: 999 },
  });
  assert.equal(badIdx.status, 400, 'feedback with out-of-range messageIndex rejected');

  // Feedback on nonexistent session
  const noSess = await req('/api/sessions/nonexistent_xyz/feedback', {
    method: 'POST',
    data: { positive: true, messageIndex: 0 },
  });
  assert.equal(noSess.status, 404, 'feedback on nonexistent session fails');

  // Clean up
  await req(`/api/sessions/${sessionId}`, { method: 'DELETE' });

  console.log('✓ All session feedback tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
