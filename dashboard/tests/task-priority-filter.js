/**
 * Tests for task ?priority= filter and GET /sessions/:id/tasks endpoint
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
  console.log('Task priority filter + session-tasks tests');

  // Create tasks with different priorities
  const low = await req('/api/tasks', { method: 'POST', data: { title: 'Low task', priority: 'low' } });
  const high = await req('/api/tasks', { method: 'POST', data: { title: 'High task', priority: 'high' } });
  const urgent = await req('/api/tasks', { method: 'POST', data: { title: 'Urgent task', priority: 'urgent' } });

  assert.equal(low.status, 200);
  assert.equal(high.status, 200);
  assert.equal(urgent.status, 200);

  const lowId = low.data.task.id;
  const highId = high.data.task.id;
  const urgentId = urgent.data.task.id;

  // Filter by priority=high
  const highFilter = await req('/api/tasks?priority=high');
  assert.equal(highFilter.status, 200, 'priority filter should succeed');
  const highIds = highFilter.data.tasks.map(t => t.id);
  assert.ok(highIds.includes(highId), 'high priority task should appear');
  assert.ok(!highIds.includes(lowId), 'low priority task should not appear in high filter');
  assert.ok(!highIds.includes(urgentId), 'urgent priority task should not appear in high filter');

  // Filter by priority=low
  const lowFilter = await req('/api/tasks?priority=low');
  assert.equal(lowFilter.status, 200);
  const lowIds = lowFilter.data.tasks.map(t => t.id);
  assert.ok(lowIds.includes(lowId), 'low priority task should appear');
  assert.ok(!lowIds.includes(highId), 'high priority task should not appear in low filter');

  // Invalid priority filter
  const badFilter = await req('/api/tasks?priority=bogus');
  assert.equal(badFilter.status, 400, 'invalid priority filter should 400');

  // Combined status + priority filter
  await req(`/api/tasks/${lowId}`, { method: 'PUT', data: { status: 'completed' } });
  const combined = await req('/api/tasks?status=pending&priority=high');
  assert.equal(combined.status, 200);
  const combinedIds = combined.data.tasks.map(t => t.id);
  assert.ok(combinedIds.includes(highId), 'pending+high task should appear in combined filter');
  assert.ok(!combinedIds.includes(lowId), 'completed+low task should not appear');

  // GET /sessions/:id/tasks — create session and assign task
  const sessionCreate = await req('/api/sessions', {
    method: 'POST',
    data: { userId: 'task-filter-user', endpoint: 'primary', model: 'llama2' }
  });
  assert.equal(sessionCreate.status, 200, 'session creation should succeed');
  const sid = sessionCreate.data.session.id;

  const taskForSession = await req('/api/tasks', { method: 'POST', data: { title: 'Session task', priority: 'medium', sessionId: sid } });
  assert.equal(taskForSession.status, 200);
  const sessionTaskId = taskForSession.data.task.id;
  assert.equal(taskForSession.data.task.sessionId, sid, 'task should be assigned to session');

  const sessionTasks = await req(`/api/sessions/${sid}/tasks`);
  assert.equal(sessionTasks.status, 200, 'session tasks endpoint should succeed');
  assert.ok(sessionTasks.data.success, 'success flag');
  const stIds = sessionTasks.data.tasks.map(t => t.id);
  assert.ok(stIds.includes(sessionTaskId), 'session-assigned task should appear in session tasks');

  // 404 for non-existent session
  const notFound = await req('/api/sessions/does-not-exist/tasks');
  assert.equal(notFound.status, 404, 'non-existent session tasks should 404');

  console.log('Task priority filter + session-tasks tests passed.');
} catch (err) {
  console.error('Task priority filter tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
