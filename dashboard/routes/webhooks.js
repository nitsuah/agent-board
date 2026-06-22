import express from 'express';

const ALLOWED_WEBHOOK_EVENTS = new Set([
  'ci_pass', 'ci_fail', 'deploy', 'deploy_fail',
  'alert', 'review_requested', 'pr_merged', 'custom',
]);

export function createWebhooksRouter({
  tasks, getNextTaskId, eventBus, logStructured,
  normalizeTaskPriority, resolveTaskAssignment, buildTaskSummary,
}) {
  const router = express.Router();

  router.post('/webhooks/trigger', (req, res) => {
    const { event: eventName, source = 'external', payload = {}, createTask: taskSpec } = req.body || {};

    if (!eventName || typeof eventName !== 'string' || !eventName.trim()) {
      return res.status(400).json({ success: false, error: 'event is required' });
    }

    const normalizedEvent = eventName.trim().toLowerCase();
    if (!ALLOWED_WEBHOOK_EVENTS.has(normalizedEvent)) {
      return res.status(400).json({
        success: false,
        error: `Unknown event type '${normalizedEvent}'. Allowed: ${Array.from(ALLOWED_WEBHOOK_EVENTS).join(', ')}`,
      });
    }

    if (typeof source !== 'string' || source.length > 80) {
      return res.status(400).json({ success: false, error: 'source must be a string ≤ 80 chars' });
    }

    if (payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
      return res.status(400).json({ success: false, error: 'payload must be an object' });
    }

    const webhookEvent = eventBus.emit('webhook_received', {
      session_id: null,
      user_id: 'webhook',
      model: null,
      endpoint: null,
      experience: null,
      metadata: { webhookEvent: normalizedEvent, source, payload },
    });

    let createdTask = null;
    if (taskSpec !== undefined && taskSpec !== null) {
      if (typeof taskSpec !== 'object' || Array.isArray(taskSpec)) {
        return res.status(400).json({ success: false, error: 'createTask must be an object' });
      }
      if (typeof taskSpec.title !== 'string' || !taskSpec.title.trim()) {
        return res.status(400).json({ success: false, error: 'createTask.title must be a non-empty string' });
      }
      const priority = taskSpec.priority === undefined ? 'medium' : normalizeTaskPriority(taskSpec.priority);
      if (!priority) {
        return res.status(400).json({ success: false, error: 'createTask.priority must be one of: low, medium, high, urgent' });
      }
      const assignment = taskSpec.sessionId ? resolveTaskAssignment(taskSpec.sessionId) : null;
      if (taskSpec.sessionId && !assignment) {
        return res.status(400).json({ success: false, error: 'createTask.sessionId does not match a live session' });
      }

      const taskId = getNextTaskId();
      const now = new Date();
      const task = {
        id: taskId,
        title: taskSpec.title.trim().slice(0, 140),
        description: `Created by webhook: ${normalizedEvent} from ${source}`,
        status: 'pending',
        priority,
        sessionId: assignment?.sessionId || null,
        assignedSessionName: assignment?.assignedSessionName || null,
        assignedUserId: assignment?.assignedUserId || null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      tasks.set(taskId, task);
      createdTask = buildTaskSummary(task);

      eventBus.emit('task_created', {
        session_id: task.sessionId,
        user_id: 'webhook',
        model: null,
        endpoint: null,
        experience: null,
        metadata: { taskId, status: 'pending', priority, source: 'webhook', webhookEvent: normalizedEvent },
      });
    }

    logStructured('info', 'webhook_received', { event: normalizedEvent, source, hasTaskCreate: Boolean(createdTask) });

    res.json({
      success: true,
      received: {
        event: normalizedEvent,
        source,
        eventId: webhookEvent.event_id,
        timestamp: webhookEvent.timestamp,
      },
      task: createdTask,
    });
  });

  return router;
}
