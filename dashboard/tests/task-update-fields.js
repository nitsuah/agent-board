/**
 * Tests for PUT /api/tasks/:id updating title, description, and priority
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
  console.log('Task field update tests');

  const create = await req('/api/tasks', { method: 'POST', data: { title: 'Original title', priority: 'low', description: 'original desc' } });
  assert.equal(create.status, 200);
  const id = create.data.task.id;

  // Update title only
  const titleUpdate = await req(`/api/tasks/${id}`, { method: 'PUT', data: { title: 'Updated title' } });
  assert.equal(titleUpdate.status, 200);
  assert.equal(titleUpdate.data.task.title, 'Updated title', 'title should be updated');
  assert.equal(titleUpdate.data.task.priority, 'low', 'priority should remain unchanged');
  assert.equal(titleUpdate.data.task.description, 'original desc', 'description should remain unchanged');

  // Update priority only
  const priorityUpdate = await req(`/api/tasks/${id}`, { method: 'PUT', data: { priority: 'urgent' } });
  assert.equal(priorityUpdate.status, 200);
  assert.equal(priorityUpdate.data.task.priority, 'urgent', 'priority should be updated');
  assert.equal(priorityUpdate.data.task.title, 'Updated title', 'title should remain from previous update');

  // Update description
  const descUpdate = await req(`/api/tasks/${id}`, { method: 'PUT', data: { description: 'new description' } });
  assert.equal(descUpdate.status, 200);
  assert.equal(descUpdate.data.task.description, 'new description');

  // Invalid title (empty string)
  const badTitle = await req(`/api/tasks/${id}`, { method: 'PUT', data: { title: '   ' } });
  assert.equal(badTitle.status, 400, 'empty title update should 400');

  // Invalid priority
  const badPriority = await req(`/api/tasks/${id}`, { method: 'PUT', data: { priority: 'critical' } });
  assert.equal(badPriority.status, 400, 'invalid priority should 400');

  // Update non-existent task
  const notFound = await req('/api/tasks/no-such-task', { method: 'PUT', data: { title: 'x' } });
  assert.equal(notFound.status, 404, 'non-existent task update should 404');

  console.log('Task field update tests passed.');
} catch (err) {
  console.error('Task field update tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
