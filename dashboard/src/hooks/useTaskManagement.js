import { useState } from 'react';

export function useTaskManagement({ activeSession, selectedExperience, wsLayout, setActiveTab, sendMessageCore, getAvailableEndpoints, currentEndpoint, getPreferredModelForEndpoint, fetchSessions, fetchSessionDetails, setActiveSession }) {
  const [tasks, setTasks] = useState([]);
  const [taskSummary, setTaskSummary] = useState({ total: 0, byStatus: {} });
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (data.success) {
        setTasks(data.tasks || []);
        setTaskSummary(data.summary || { total: 0, byStatus: {} });
      }
    } catch (error) { console.error('Error fetching tasks:', error); }
  };

  const createTask = async (experience) => {
    if (!taskTitle.trim()) return;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: taskTitle.trim(), priority: taskPriority, sessionId: activeSession || null, experience: experience || selectedExperience }),
      });
      const data = await res.json();
      if (!data.success) { console.error('Error creating task:', data.error || 'Unknown error'); return; }
      setTaskTitle('');
      setTaskPriority('medium');
      fetchTasks();
    } catch (error) { console.error('Error creating task:', error); }
  };

  const updateTaskStatus = async (taskId, status) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!data.success) { console.error('Error updating task status:', data.error || 'Unknown error'); return; }
      fetchTasks();
    } catch (error) { console.error('Error updating task status:', error); }
  };

  const routeTaskToSession = async (taskId) => {
    if (!activeSession) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession }),
      });
      const data = await res.json();
      if (!data.success) { console.error('Error routing task:', data.error || 'Unknown error'); return; }
      fetchTasks();
    } catch (error) { console.error('Error routing task:', error); }
  };

  const dispatchTask = async (task) => {
    try {
      const availableEndpoints = getAvailableEndpoints(selectedExperience);
      const endpoint = availableEndpoints.includes(currentEndpoint) ? currentEndpoint : availableEndpoints[0];
      const model = getPreferredModelForEndpoint(endpoint);
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experience: selectedExperience, endpoint, model }),
      });
      const data = await res.json();
      const sessionId = data.session?.id;
      if (!sessionId) return;
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress', sessionId }),
      });
      await fetchSessions();
      await fetchSessionDetails(sessionId);
      setActiveSession(sessionId);
      if (wsLayout === 'single') setActiveTab('chat');
      sendMessageCore(sessionId, task.title);
      fetchTasks();
    } catch (err) { console.error('dispatchTask failed:', err); }
  };

  const deleteTask = async (taskId) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) { console.error('Error deleting task:', data.error || 'Unknown error'); return; }
      fetchTasks();
    } catch (error) { console.error('Error deleting task:', error); }
  };

  const clearCompletedTasks = async () => {
    const completed = tasks.filter(t => t.status === 'completed');
    await Promise.all(completed.map(t => fetch(`/api/tasks/${t.id}`, { method: 'DELETE' }).catch(() => {})));
    fetchTasks();
  };

  return {
    tasks, taskSummary, taskTitle, setTaskTitle, taskPriority, setTaskPriority,
    fetchTasks, createTask, updateTaskStatus, routeTaskToSession, dispatchTask, deleteTask, clearCompletedTasks,
  };
}
