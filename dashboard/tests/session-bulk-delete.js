/**
 * Tests for DELETE /api/sessions (bulk delete)
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
  return { status: res.status, data: await res.json() };
}

try {
  console.log('Session bulk-delete tests');

  // Create 3 sessions
  const s1 = await req('/api/sessions', { method: 'POST', data: { userId: 'u1', endpoint: 'primary', model: 'llama3.2', experience: 'developer' } });
  const s2 = await req('/api/sessions', { method: 'POST', data: { userId: 'u1', endpoint: 'primary', model: 'llama3.2', experience: 'research' } });
  const s3 = await req('/api/sessions', { method: 'POST', data: { userId: 'u1', endpoint: 'primary', model: 'llama3.2', experience: 'developer' } });

  const id1 = s1.data.session.id;
  const id2 = s2.data.session.id;
  const id3 = s3.data.session.id;

  // Bulk delete by specific ids
  const partial = await req('/api/sessions', { method: 'DELETE', data: { ids: [id1, id2] } });
  assert.equal(partial.status, 200, 'bulk delete should succeed');
  assert.equal(partial.data.deleted, 2, 'should report 2 deleted');

  // Confirm id1/id2 are gone, id3 remains
  const afterPartial = await req('/api/sessions');
  const remaining = afterPartial.data.sessions.map(s => s.id);
  assert.ok(!remaining.includes(id1), 'id1 should be deleted');
  assert.ok(!remaining.includes(id2), 'id2 should be deleted');
  assert.ok(remaining.includes(id3), 'id3 should still exist');

  // Bulk delete without ids or deleteAll should fail
  const noFlag = await req('/api/sessions', { method: 'DELETE', data: {} });
  assert.equal(noFlag.status, 400, 'delete without ids or deleteAll should 400');

  // Bulk delete all with deleteAll flag
  const all = await req('/api/sessions', { method: 'DELETE', data: { deleteAll: true } });
  assert.equal(all.status, 200, 'delete-all should succeed');
  assert.ok(all.data.deleted >= 1, 'should delete at least 1 session');

  // Confirm all gone
  const empty = await req('/api/sessions');
  assert.equal(empty.data.sessions.length, 0, 'no sessions should remain');

  console.log('Session bulk-delete tests passed.');
} catch (err) {
  console.error('Session bulk-delete tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
