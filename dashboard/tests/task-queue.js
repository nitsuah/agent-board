import assert from 'node:assert/strict';
import axios from 'axios';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';

const { app } = await import('../server.js');

const server = app.listen(0);
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

async function request(path, { method = 'GET', data } = {}) {
  const response = await axios({
    method,
    url: `${BASE}${path}`,
    data,
    timeout: 10000,
    validateStatus: () => true,
  });
  return response;
}

async function run() {
  try {
    console.log('Task queue API tests');

    const createdSession = await request('/api/sessions', {
      method: 'POST',
      data: {
        userId: 'task-test-user',
        endpoint: 'primary',
        model: 'llama2:latest',
        experience: 'developer'
      }
    });

    assert.equal(createdSession.status, 200, 'session creation should succeed');
    const sessionId = createdSession.data.session.id;

    const createTask = await request('/api/tasks', {
      method: 'POST',
      data: {
        title: 'Verify queue routing flow',
        priority: 'high',
        sessionId
      }
    });

    assert.equal(createTask.status, 200, 'task creation should succeed');
    assert.equal(createTask.data.success, true, 'task creation should return success');
    assert.equal(createTask.data.task.status, 'pending', 'new task should start pending');
    assert.equal(createTask.data.task.sessionId, sessionId, 'task should be routed to requested session');

    const taskId = createTask.data.task.id;

    const updateTask = await request(`/api/tasks/${taskId}`, {
      method: 'PUT',
      data: {
        status: 'in_progress'
      }
    });

    assert.equal(updateTask.status, 200, 'task update should succeed');
    assert.equal(updateTask.data.task.status, 'in_progress', 'task should transition to in_progress');

    const completeTask = await request(`/api/tasks/${taskId}`, {
      method: 'PUT',
      data: {
        status: 'completed'
      }
    });

    assert.equal(completeTask.status, 200, 'task completion should succeed');
    assert.equal(completeTask.data.task.status, 'completed', 'task should transition to completed');
    assert.ok(completeTask.data.task.completedAt, 'completed task should include completedAt');

    const listTasks = await request('/api/tasks');
    assert.equal(listTasks.status, 200, 'task listing should succeed');
    assert.equal(listTasks.data.success, true, 'task listing should return success');
    assert.ok(Array.isArray(listTasks.data.tasks), 'tasks should be an array');
    assert.ok(listTasks.data.tasks.length >= 1, 'at least one task should be returned');
    assert.ok(listTasks.data.summary.byStatus.completed >= 1, 'completed status summary should increment');

    const deleteTask = await request(`/api/tasks/${taskId}`, { method: 'DELETE' });
    assert.equal(deleteTask.status, 200, 'task deletion should succeed');
    assert.equal(deleteTask.data.deleted, true, 'task should be deleted');

    console.log('Task queue API tests passed.');
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error('Task queue API tests failed:', error.message);
  process.exit(1);
});
