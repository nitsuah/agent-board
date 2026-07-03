/**
 * Tests for per-session experience switching
 * PATCH /api/sessions/:id/experience
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
  console.log('Session experience switching tests');

  // Create a session
  const sess = await req('/api/sessions', { method: 'POST', data: { endpoint: 'primary' } });
  assert.equal(sess.status, 200);
  const sessionId = sess.data.session.id;
  assert.ok(sessionId, 'session created');

  // Get session details — should have default experience
  const details = await req(`/api/sessions/${sessionId}`);
  assert.equal(details.status, 200);
  const defaultExp = details.data.session?.experience;

  // Change experience to nemoclaw
  const patch = await req(`/api/sessions/${sessionId}/experience`, {
    method: 'PATCH',
    data: { experience: 'nemoclaw' },
  });
  assert.equal(patch.status, 200, 'PATCH should succeed');
  assert.equal(patch.data.experience, 'nemoclaw');

  // Verify experience persisted on session
  const after = await req(`/api/sessions/${sessionId}`);
  assert.equal(after.data.session.experience, 'nemoclaw', 'experience should be updated');

  // Invalid experience should be rejected
  const bad = await req(`/api/sessions/${sessionId}/experience`, {
    method: 'PATCH',
    data: { experience: 'fake_experience_xyz' },
  });
  assert.equal(bad.status, 400, 'invalid experience should fail');

  // Missing experience field should be rejected
  const missing = await req(`/api/sessions/${sessionId}/experience`, {
    method: 'PATCH',
    data: {},
  });
  assert.equal(missing.status, 400, 'missing experience should fail');

  // Non-existent session should 404
  const notFound = await req('/api/sessions/nonexistent_id_999/experience', {
    method: 'PATCH',
    data: { experience: 'nemoclaw' },
  });
  assert.equal(notFound.status, 404, 'non-existent session should 404');

  // Clean up
  await req(`/api/sessions/${sessionId}`, { method: 'DELETE' });

  console.log('✓ All session experience tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
