/**
 * Task auto-runner — picks up pending tasks and dispatches them via priority queue.
 * Priority: critical(4) > high(3) > normal/medium(2) > low(1)
 *
 * TODO: wire to actual session creation + LLM message dispatch once
 *       the sessions / sendMessageCore functions are extracted to a shared module.
 *       For now, tasks advance through pending → running → completed after a stub delay.
 */

const PRIORITY_ORDER = { critical: 4, high: 3, normal: 2, medium: 2, low: 1 };

export function startTaskRunner(tasks, eventBus) {
  let runnerInterval = null;

  const tick = async () => {
    // Skip if any task is already running
    const running = [...tasks.values()].find(t => t.status === 'running');
    if (running) return;

    // Find highest priority pending task (priority desc, then oldest first)
    const pending = [...tasks.values()]
      .filter(t => t.status === 'pending')
      .sort((a, b) => {
        const pd = (PRIORITY_ORDER[b.priority] || 2) - (PRIORITY_ORDER[a.priority] || 2);
        return pd !== 0 ? pd : new Date(a.createdAt) - new Date(b.createdAt);
      });

    if (pending.length === 0) return;
    const task = pending[0];

    task.status = 'running';
    task.updatedAt = new Date().toISOString();
    eventBus.emit('task_status_changed', {
      session_id: task.sessionId,
      user_id: task.assignedUserId || 'anonymous',
      model: null, endpoint: null, experience: task.experience || null,
      metadata: { taskId: task.id, status: 'running' },
    });

    try {
      // TODO: create a session and dispatch task.title to it via sendMessageCore
      // For now: stub — mark completed after a short delay
      await new Promise(r => setTimeout(r, 2000));

      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.updatedAt = new Date().toISOString();
      eventBus.emit('task_status_changed', {
        session_id: task.sessionId,
        user_id: task.assignedUserId || 'anonymous',
        model: null, endpoint: null, experience: task.experience || null,
        metadata: { taskId: task.id, status: 'completed' },
      });
    } catch (err) {
      task.status = 'failed';
      task.updatedAt = new Date().toISOString();
      eventBus.emit('task_status_changed', {
        session_id: task.sessionId,
        user_id: task.assignedUserId || 'anonymous',
        model: null, endpoint: null, experience: task.experience || null,
        metadata: { taskId: task.id, status: 'failed', error: err.message },
      });
    }
  };

  runnerInterval = setInterval(tick, 5000);

  return () => {
    if (runnerInterval) clearInterval(runnerInterval);
  };
}
