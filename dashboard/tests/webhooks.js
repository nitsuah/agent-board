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
    console.log('Webhook trigger tests');

    // Happy path: bare trigger with no task creation
    const bare = await request('/api/webhooks/trigger', {
      method: 'POST',
      data: { event: 'ci_pass', source: 'github-actions' }
    });

    assert.equal(bare.status, 200, 'bare trigger should return 200');
    assert.equal(bare.data.success, true, 'bare trigger should succeed');
    assert.equal(bare.data.received.event, 'ci_pass', 'event name should be normalised');
    assert.equal(bare.data.received.source, 'github-actions', 'source should be echoed');
    assert.ok(bare.data.received.eventId, 'event ID should be present');
    assert.equal(bare.data.task, null, 'no task should be created when createTask is omitted');

    // Happy path: trigger that also creates a task
    const withTask = await request('/api/webhooks/trigger', {
      method: 'POST',
      data: {
        event: 'ci_fail',
        source: 'circleci',
        payload: { branch: 'main', commit: 'abc123' },
        createTask: { title: 'Investigate CI failure on main', priority: 'high' }
      }
    });

    assert.equal(withTask.status, 200, 'trigger with task creation should return 200');
    assert.equal(withTask.data.success, true, 'trigger with task creation should succeed');
    assert.ok(withTask.data.task, 'created task should be present in response');
    assert.equal(withTask.data.task.status, 'pending', 'created task should start pending');
    assert.equal(withTask.data.task.priority, 'high', 'task priority should match request');
    assert.equal(withTask.data.task.sessionId, null, 'task should be unassigned without a sessionId');

    // Trigger that routes the created task to a live session
    const createdSession = await request('/api/sessions', {
      method: 'POST',
      data: { userId: 'webhook-test-user', endpoint: 'primary', experience: 'developer' }
    });
    assert.equal(createdSession.status, 200, 'session for routing test should be created');
    const sessionId = createdSession.data.session.id;

    const routed = await request('/api/webhooks/trigger', {
      method: 'POST',
      data: {
        event: 'alert',
        source: 'pagerduty',
        createTask: { title: 'Triage alert', priority: 'urgent', sessionId }
      }
    });

    assert.equal(routed.status, 200, 'routed trigger should return 200');
    assert.equal(routed.data.task.sessionId, sessionId, 'task should be routed to the requested session');

    // Validation: missing event
    const noEvent = await request('/api/webhooks/trigger', {
      method: 'POST',
      data: { source: 'ghost' }
    });
    assert.equal(noEvent.status, 400, 'missing event should return 400');

    // Validation: unknown event type
    const badEvent = await request('/api/webhooks/trigger', {
      method: 'POST',
      data: { event: 'unknown_event_xyz' }
    });
    assert.equal(badEvent.status, 400, 'unknown event should return 400');

    // Validation: createTask.sessionId for a non-existent session
    const ghostSession = await request('/api/webhooks/trigger', {
      method: 'POST',
      data: {
        event: 'deploy',
        createTask: { title: 'Ghost task', sessionId: 'sess_does_not_exist' }
      }
    });
    assert.equal(ghostSession.status, 400, 'creating task for non-existent session should return 400');

    // Verify session-scoped task endpoint reflects the routed task
    const sessionTasks = await request(`/api/sessions/${sessionId}/tasks`);
    assert.equal(sessionTasks.status, 200, 'session tasks endpoint should return 200');
    assert.ok(sessionTasks.data.tasks.length >= 1, 'at least the routed task should appear');
    assert.ok(
      sessionTasks.data.tasks.every((t) => t.sessionId === sessionId),
      'all returned tasks should belong to the session'
    );

    console.log('Webhook trigger tests passed.');
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error('Webhook trigger tests failed:', error.message);
  process.exit(1);
});
