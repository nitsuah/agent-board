import express from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

const ALLOWED_WEBHOOK_EVENTS = new Set([
  'ci_pass', 'ci_fail', 'deploy', 'deploy_fail',
  'alert', 'review_requested', 'pr_merged', 'custom',
]);

function verifySignature(secret, rawBody, sigHeader) {
  if (!sigHeader) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const actual = Buffer.from(sigHeader);
  if (expected.length !== actual.length) return false;
  try { return timingSafeEqual(expected, actual); } catch { return false; }
}

export function createWebhooksRouter({
  tasks, getNextTaskId, eventBus, logStructured,
  webhookSecret,
  normalizeTaskPriority, resolveTaskAssignment, buildTaskSummary,
}) {
  const router = express.Router();

  // Use raw body parser so we can verify HMAC signatures when WEBHOOK_SECRET is set
  const webhookBody = webhookSecret
    ? [express.raw({ type: 'application/json' }), (req, _res, next) => {
        if (Buffer.isBuffer(req.body)) {
          try { req._rawBody = req.body; req.body = JSON.parse(req.body.toString()); } catch { req.body = {}; }
        }
        next();
      }]
    : [express.json()];

  router.post('/webhooks/trigger', ...webhookBody, (req, res) => {
    if (webhookSecret) {
      const sig = req.headers['x-hub-signature-256'];
      if (!sig || !verifySignature(webhookSecret, req._rawBody || Buffer.alloc(0), sig)) {
        logStructured('warn', 'webhook_signature_invalid', { source: req.body?.source });
        return res.status(401).json({ success: false, error: 'Invalid or missing webhook signature' });
      }
    }

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
