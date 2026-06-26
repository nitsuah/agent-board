/**
 * Tests for GET /api/tasks?q= text search filter
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
  console.log('Task search tests');

  const t1 = await req('/api/tasks', { method: 'POST', data: { title: 'Implement login flow', priority: 'high' } });
  const t2 = await req('/api/tasks', { method: 'POST', data: { title: 'Fix database bug', priority: 'medium', description: 'connection pool exhausted' } });
  const t3 = await req('/api/tasks', { method: 'POST', data: { title: 'Write unit tests', priority: 'low' } });

  assert.equal(t1.status, 200);
  assert.equal(t2.status, 200);
  assert.equal(t3.status, 200);

  const id1 = t1.data.task.id;
  const id2 = t2.data.task.id;
  const id3 = t3.data.task.id;

  // Search by title keyword
  const loginSearch = await req('/api/tasks?q=login');
  assert.equal(loginSearch.status, 200);
  const loginIds = loginSearch.data.tasks.map(t => t.id);
  assert.ok(loginIds.includes(id1), 'login task should appear');
  assert.ok(!loginIds.includes(id2), 'database task should not appear');

  // Search by description keyword
  const poolSearch = await req('/api/tasks?q=pool');
  assert.equal(poolSearch.status, 200);
  const poolIds = poolSearch.data.tasks.map(t => t.id);
  assert.ok(poolIds.includes(id2), 'task with "pool" in description should appear');
  assert.ok(!poolIds.includes(id1), 'login task should not appear');

  // Case-insensitive search
  const upperSearch = await req('/api/tasks?q=DATABASE');
  assert.equal(upperSearch.status, 200);
  const upperIds = upperSearch.data.tasks.map(t => t.id);
  assert.ok(upperIds.includes(id2), 'case-insensitive search should match');

  // No matches
  const noMatch = await req('/api/tasks?q=xyznotfound');
  assert.equal(noMatch.status, 200);
  assert.equal(noMatch.data.tasks.length, 0, 'no matches should return empty list');

  // Combined q + status filter
  await req(`/api/tasks/${id1}`, { method: 'PUT', data: { status: 'completed' } });
  const combined = await req('/api/tasks?q=login&status=pending');
  assert.equal(combined.status, 200);
  const combinedIds = combined.data.tasks.map(t => t.id);
  assert.ok(!combinedIds.includes(id1), 'completed login task should not appear in pending+q filter');

  console.log('Task search tests passed.');
} catch (err) {
  console.error('Task search tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
