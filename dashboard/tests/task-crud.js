/**
 * Tests for task CRUD: create, read, update status, delete, filter by status
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
  console.log('Task CRUD tests');

  // Create a task
  const create = await req('/api/tasks', { method: 'POST', data: { title: 'Test task', priority: 'high' } });
  assert.equal(create.status, 200, 'task creation should succeed');
  assert.equal(create.data.success, true, 'success flag');
  const taskId = create.data.task.id;
  assert.ok(taskId, 'should return task id');
  assert.equal(create.data.task.status, 'pending', 'new task should be pending');

  // Read by id
  const get = await req(`/api/tasks/${taskId}`);
  assert.equal(get.status, 200, 'task fetch should succeed');
  assert.equal(get.data.task.id, taskId, 'should return correct task');

  // Create a second task and complete it
  const create2 = await req('/api/tasks', { method: 'POST', data: { title: 'Done task', priority: 'low' } });
  const taskId2 = create2.data.task.id;
  const complete = await req(`/api/tasks/${taskId2}`, { method: 'PUT', data: { status: 'completed' } });
  assert.equal(complete.status, 200, 'status update should succeed');
  assert.equal(complete.data.task.status, 'completed', 'task should be completed');

  // Filter by status=pending — should not include taskId2
  const pending = await req('/api/tasks?status=pending');
  assert.equal(pending.status, 200, 'filter by status should succeed');
  const ids = pending.data.tasks.map(t => t.id);
  assert.ok(ids.includes(taskId), 'pending task should appear');
  assert.ok(!ids.includes(taskId2), 'completed task should not appear in pending filter');

  // Delete the first task
  const del = await req(`/api/tasks/${taskId}`, { method: 'DELETE' });
  assert.equal(del.status, 200, 'task deletion should succeed');
  assert.equal(del.data.success, true, 'deletion success flag');

  // Deleted task should 404
  const afterDel = await req(`/api/tasks/${taskId}`);
  assert.equal(afterDel.status, 404, 'deleted task should 404');

  // Invalid status filter
  const bad = await req('/api/tasks?status=bogus');
  assert.equal(bad.status, 400, 'invalid status filter should 400');

  console.log('Task CRUD tests passed.');
} catch (err) {
  console.error('Task CRUD tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
