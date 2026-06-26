import express from 'express';

export function createTasksRouter({ tasks, sessions, eventBus, logStructured, normalizeTaskStatus, normalizeTaskPriority, buildTaskSummary, resolveTaskAssignment }) {
  const router = express.Router();
  let taskCounter = 0;

  router.get('/tasks', (req, res) => {
    const { status, sessionId } = req.query;
    const normalizedStatus = status ? normalizeTaskStatus(status) : null;

    if (status && !normalizedStatus) {
      return res.status(400).json({ success: false, error: 'Invalid status filter' });
    }

    const items = Array.from(tasks.values())
      .filter((task) => (normalizedStatus ? task.status === normalizedStatus : true))
      .filter((task) => (sessionId ? task.sessionId === sessionId : true))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(buildTaskSummary);

    const byStatus = { pending: 0, in_progress: 0, blocked: 0, completed: 0 };
    items.forEach((task) => {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    });

    res.json({
      success: true,
      tasks: items,
      summary: { total: items.length, byStatus }
    });
  });

  router.post('/tasks', express.json(), (req, res) => {
    const { title, description = '', priority, sessionId } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }

    const normalizedPriority = normalizeTaskPriority(priority);
    if (!normalizedPriority) {
      return res.status(400).json({ success: false, error: 'Invalid priority' });
    }

    const assignment = resolveTaskAssignment(sessionId);
    if (sessionId && !assignment) {
      return res.status(400).json({ success: false, error: 'Assigned session does not exist' });
    }

    const taskId = `task_${Date.now()}_${++taskCounter}`;
    const now = new Date();
    const task = {
      id: taskId,
      title: title.trim().slice(0, 140),
      description: typeof description === 'string' ? description.trim().slice(0, 2000) : '',
      status: 'pending',
      priority: normalizedPriority,
      sessionId: assignment?.sessionId || null,
      assignedSessionName: assignment?.assignedSessionName || null,
      assignedUserId: assignment?.assignedUserId || null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };

    tasks.set(taskId, task);

    logStructured?.('info', 'task_created', { taskId, priority: task.priority, sessionId: task.sessionId });

    eventBus.emit('task_created', {
      session_id: task.sessionId,
      user_id: task.assignedUserId || 'anonymous',
      model: null, endpoint: null, experience: null,
      metadata: { taskId, status: task.status, priority: task.priority, hasAssignment: Boolean(task.sessionId) }
    });

    if (task.sessionId) {
      eventBus.emit('task_routed', {
        session_id: task.sessionId,
        user_id: task.assignedUserId || 'anonymous',
        model: null, endpoint: null, experience: null,
        metadata: { taskId, toSessionId: task.sessionId }
      });
    }

    res.json({ success: true, task: buildTaskSummary(task) });
  });

  router.get('/tasks/:id', (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, task: buildTaskSummary(task) });
  });

  router.put('/tasks/:id', express.json(), (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const { title, description, status, priority, sessionId } = req.body || {};

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ success: false, error: 'title must be a non-empty string' });
      }
      task.title = title.trim().slice(0, 140);
    }

    if (description !== undefined) {
      if (typeof description !== 'string') {
        return res.status(400).json({ success: false, error: 'description must be a string' });
      }
      task.description = description.trim().slice(0, 2000);
    }

    if (priority !== undefined) {
      const normalizedPriority = normalizeTaskPriority(priority);
      if (!normalizedPriority) {
        return res.status(400).json({ success: false, error: 'Invalid priority' });
      }
      task.priority = normalizedPriority;
    }

    if (status !== undefined) {
      const normalizedStatus = normalizeTaskStatus(status);
      if (!normalizedStatus) {
        return res.status(400).json({ success: false, error: 'Invalid status' });
      }

      if (task.status !== normalizedStatus) {
        logStructured?.('info', 'task_status_changed', { taskId: task.id, from: task.status, to: normalizedStatus });
        task.status = normalizedStatus;
        eventBus.emit('task_status_changed', {
          session_id: task.sessionId,
          user_id: task.assignedUserId || 'anonymous',
          model: null, endpoint: null, experience: null,
          metadata: { taskId: task.id, status: normalizedStatus }
        });
      }
    }

    if (sessionId !== undefined) {
      const assignment = resolveTaskAssignment(sessionId);
      if (sessionId && !assignment) {
        return res.status(400).json({ success: false, error: 'Assigned session does not exist' });
      }

      const previousSessionId = task.sessionId;
      task.sessionId = assignment?.sessionId || null;
      task.assignedSessionName = assignment?.assignedSessionName || null;
      task.assignedUserId = assignment?.assignedUserId || null;

      if (previousSessionId !== task.sessionId) {
        eventBus.emit('task_routed', {
          session_id: task.sessionId,
          user_id: task.assignedUserId || 'anonymous',
          model: null, endpoint: null, experience: null,
          metadata: { taskId: task.id, fromSessionId: previousSessionId, toSessionId: task.sessionId }
        });
      }
    }

    if (task.status === 'completed' && !task.completedAt) {
      task.completedAt = new Date();
      eventBus.emit('task_completed', {
        session_id: task.sessionId,
        user_id: task.assignedUserId || 'anonymous',
        model: null, endpoint: null, experience: null,
        metadata: { taskId: task.id, priority: task.priority }
      });
    }

    if (task.status !== 'completed') {
      task.completedAt = null;
    }

    task.updatedAt = new Date();
    tasks.set(task.id, task);

    res.json({ success: true, task: buildTaskSummary(task) });
  });

  router.delete('/tasks/:id', (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    logStructured?.('info', 'task_deleted', { taskId: task.id, status: task.status });
    tasks.delete(req.params.id);
    eventBus.emit('task_deleted', {
      session_id: task.sessionId,
      user_id: task.assignedUserId || 'anonymous',
      model: null, endpoint: null, experience: null,
      metadata: { taskId: task.id, status: task.status }
    });

    res.json({ success: true, deleted: true });
  });

  router.get('/sessions/:id/tasks', (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const sessionTasks = Array.from(tasks.values())
      .filter((t) => t.sessionId === req.params.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(buildTaskSummary);

    const byStatus = { pending: 0, in_progress: 0, blocked: 0, completed: 0 };
    sessionTasks.forEach((t) => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });

    res.json({ success: true, tasks: sessionTasks, summary: { total: sessionTasks.length, byStatus } });
  });

  return router;
}
