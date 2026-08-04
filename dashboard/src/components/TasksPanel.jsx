import React, { useState } from 'react';
import { EXPERIENCE_META } from '../constants/app-config.js';

const TASK_FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Done' },
];

export default function TasksPanel({
  tasks, taskTitle, setTaskTitle, taskDescription, setTaskDescription, taskPriority, setTaskPriority,
  taskExperience, setTaskExperience, createTask, updateTask, updateTaskStatus,
  deleteTask, dispatchTask, clearCompletedTasks,
  setActiveSession, fetchSessionDetails, setActiveTab,
}) {
  const [filter, setFilter] = useState('active');
  const [showDesc, setShowDesc] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [taskSearch, setTaskSearch] = useState('');

  const filtered = tasks.filter(t => {
    if (filter === 'active') { if (t.status === 'completed') return false; }
    else if (filter === 'completed') { if (t.status !== 'completed') return false; }
    if (taskSearch.trim()) {
      const q = taskSearch.toLowerCase();
      return t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q);
    }
    return true;
  }).slice(0, 30);

  return (
    <div className="ws-tasks-tab">
      <div className="task-create-row">
        <input
          type="text" value={taskTitle} onChange={e => setTaskTitle(e.target.value)}
          placeholder="Add a task…" maxLength={140}
          onKeyDown={e => e.key === 'Enter' && taskTitle.trim() && createTask(taskExperience)}
        />
        <select value={taskPriority} onChange={e => setTaskPriority(e.target.value)}>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>
        <select value={taskExperience} onChange={e => setTaskExperience(e.target.value)} title="Experience for this task">
          {Object.entries(EXPERIENCE_META).map(([key, exp]) => (
            <option key={key} value={key}>{exp.icon} {exp.name}</option>
          ))}
        </select>
        <button className="task-desc-toggle" onClick={() => setShowDesc(p => !p)} title="Add description">+</button>
        <button className="btn-primary" onClick={() => createTask(taskExperience)} disabled={!taskTitle.trim()}>Add</button>
      </div>
      {showDesc && (
        <textarea
          className="task-desc-input"
          value={taskDescription}
          onChange={e => setTaskDescription(e.target.value)}
          placeholder="Optional description…"
          maxLength={2000}
          rows={2}
        />
      )}
      {tasks.length > 3 && (
        <input
          className="task-search-input"
          type="search"
          placeholder="Search tasks…"
          value={taskSearch}
          onChange={e => setTaskSearch(e.target.value)}
        />
      )}
      <div className="task-filter-tabs">
        {TASK_FILTERS.map(f => (
          <button
            key={f.key}
            className={`task-filter-tab ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key === 'active' && tasks.filter(t => t.status !== 'completed').length > 0 && (
              <span className="task-filter-count">{tasks.filter(t => t.status !== 'completed').length}</span>
            )}
          </button>
        ))}
        {tasks.some(t => t.status === 'completed') && (
          <button
            className="task-filter-tab"
            style={{ marginLeft: 'auto', opacity: 0.7 }}
            onClick={clearCompletedTasks}
            title="Delete all completed tasks"
          >Clear done</button>
        )}
      </div>
      <div className="task-list">
        {filtered.map(task => (
          <div key={task.id} className={`task-item status-${task.status}`}>
            {editingId === task.id ? (
              <div className="task-edit-form">
                <input
                  className="task-edit-title"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  maxLength={140}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') { updateTask(task.id, { title: editTitle, priority: editPriority }); setEditingId(null); }
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
                <select value={editPriority} onChange={e => setEditPriority(e.target.value)}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="urgent">urgent</option>
                </select>
                <button onClick={() => { updateTask(task.id, { title: editTitle, priority: editPriority }); setEditingId(null); }}>Save</button>
                <button onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            ) : (
              <>
                <div className="task-item-head">
                  <strong
                    className="task-title-editable"
                    onClick={() => { setEditingId(task.id); setEditTitle(task.title); setEditPriority(task.priority); }}
                    title="Click to edit"
                  >{task.title}</strong>
                  <span className={`task-priority ${task.priority}`}>{task.priority}</span>
                </div>
                <div className="task-item-meta">
                  <span>{task.status.replace('_', ' ')}</span>
                  {task.sessionId ? (
                    <span
                      className="task-session-link"
                      onClick={() => { setActiveSession(task.sessionId); fetchSessionDetails(task.sessionId); setActiveTab('chat'); }}
                      title="Go to session"
                    >{task.assignedSessionName || 'session →'}</span>
                  ) : (
                    <span style={{ opacity: 0.4 }}>unassigned</span>
                  )}
                </div>
                {task.description && (
                  <div className="task-item-desc" title={task.description}>
                    {task.description.slice(0, 100)}{task.description.length > 100 ? '…' : ''}
                  </div>
                )}
                {task.result && (
                  <div className="task-item-result" title={task.result}>
                    {task.result.slice(0, 120)}{task.result.length > 120 ? '…' : ''}
                  </div>
                )}
                <div className="task-item-actions">
                  {task.status === 'pending' && <button className="task-dispatch-btn" onClick={() => dispatchTask(task)}>▶ Dispatch</button>}
                  {task.status === 'pending' && <button onClick={() => updateTaskStatus(task.id, 'in_progress')} title="Mark as in progress">▷ Start</button>}
                  {task.status === 'in_progress' && <button onClick={() => updateTaskStatus(task.id, 'blocked')} title="Mark as blocked">⚠ Block</button>}
                  {task.status === 'blocked' && <button onClick={() => updateTaskStatus(task.id, 'pending')} title="Unblock — back to pending">↩ Unblock</button>}
                  {task.status !== 'completed' && <button onClick={() => updateTaskStatus(task.id, 'completed')}>✓ Done</button>}
                  <button onClick={() => deleteTask(task.id)}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="task-empty">{filter === 'completed' ? 'No completed tasks.' : 'No active tasks.'}</div>
        )}
      </div>
    </div>
  );
}
