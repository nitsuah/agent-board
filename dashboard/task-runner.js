/**
 * Task auto-runner — picks up pending tasks and dispatches them via priority queue.
 * Priority: critical(4) > high(3) > normal/medium(2) > low(1)
 *
 * dispatchMessage(task) is an async callback provided by server.js.
 * It creates or reuses a session and sends task.title as the first message.
 * Falls back to a stub (for test environments) if not provided.
 */

const PRIORITY_ORDER = { critical: 4, high: 3, normal: 2, medium: 2, low: 1 };

export function startTaskRunner(tasks, eventBus, dispatchMessage) {
  let runnerInterval = null;

  const emitStatus = (task, status, extra = {}) => {
    task.status = status;
    task.updatedAt = new Date().toISOString();
    if (status === 'completed') task.completedAt = new Date().toISOString();
    eventBus.emit('task_status_changed', {
      session_id: task.sessionId,
      user_id: task.assignedUserId || 'anonymous',
      model: null, endpoint: null, experience: task.experience || null,
      metadata: { taskId: task.id, status, ...extra },
    });
  };

  const tick = async () => {
    const running = [...tasks.values()].find(t => t.status === 'running');
    if (running) return;

    const pending = [...tasks.values()]
      .filter(t => t.status === 'pending')
      .sort((a, b) => {
        const pd = (PRIORITY_ORDER[b.priority] || 2) - (PRIORITY_ORDER[a.priority] || 2);
        return pd !== 0 ? pd : new Date(a.createdAt) - new Date(b.createdAt);
      });

    if (pending.length === 0) return;
    const task = pending[0];

    emitStatus(task, 'running');

    try {
      if (typeof dispatchMessage === 'function') {
        const result = await dispatchMessage(task);
        task.result = result?.content ? result.content.slice(0, 2000) : null;
        emitStatus(task, 'completed');
      } else {
        // stub for test environments without LLM
        await new Promise(r => setTimeout(r, 500));
        emitStatus(task, 'completed');
      }
    } catch (err) {
      emitStatus(task, 'failed', { error: err.message });
    }
  };

  runnerInterval = setInterval(tick, 5000);

  return () => {
    if (runnerInterval) clearInterval(runnerInterval);
  };
}
