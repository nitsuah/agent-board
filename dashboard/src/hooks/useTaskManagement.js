import { useState } from 'react';
import { toast } from '../components/Toast.jsx';

export function useTaskManagement({ activeSession, selectedExperience, wsLayout, setActiveTab, sendMessageCore, getAvailableEndpoints, currentEndpoint, getPreferredModelForEndpoint, fetchSessions, fetchSessionDetails, setActiveSession }) {
  const [tasks, setTasks] = useState([]);
  const [taskSummary, setTaskSummary] = useState({ total: 0, byStatus: {} });
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (data.success) {
        setTasks(data.tasks || []);
        setTaskSummary(data.summary || { total: 0, byStatus: {} });
      }
    } catch (error) { toast.error(`Failed to fetch tasks: ${error.message}`); }
  };

  const createTask = async (experience) => {
    if (!taskTitle.trim()) return;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: taskTitle.trim(), description: taskDescription.trim() || undefined, priority: taskPriority, sessionId: activeSession || null, experience: experience || selectedExperience }),
      });
      const data = await res.json();
      if (!data.success) { toast.error(data.error || 'Failed to create task'); return; }
      setTaskTitle('');
      setTaskDescription('');
      setTaskPriority('medium');
      fetchTasks();
    } catch (error) { toast.error(`Failed to create task: ${error.message}`); }
  };

  const updateTaskStatus = async (taskId, status) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!data.success) { toast.error(data.error || 'Failed to update task'); return; }
      fetchTasks();
    } catch (error) { toast.error(`Failed to update task: ${error.message}`); }
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
      if (!data.success) { toast.error(data.error || 'Failed to route task'); return; }
      fetchTasks();
    } catch (error) { toast.error(`Failed to route task: ${error.message}`); }
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
    } catch (err) { toast.error(`Dispatch failed: ${err.message}`); }
  };

  const updateTask = async (taskId, fields) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!data.success) { toast.error(data.error || 'Failed to update task'); return; }
      fetchTasks();
    } catch (error) { toast.error(`Failed to update task: ${error.message}`); }
  };

  const deleteTask = async (taskId) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) { toast.error(data.error || 'Failed to delete task'); return; }
      fetchTasks();
    } catch (error) { toast.error(`Failed to delete task: ${error.message}`); }
  };

  const clearCompletedTasks = async () => {
    const completed = tasks.filter(t => t.status === 'completed');
    await Promise.all(completed.map(t => fetch(`/api/tasks/${t.id}`, { method: 'DELETE' }).catch(() => {})));
    fetchTasks();
  };

  return {
    tasks, taskSummary, taskTitle, setTaskTitle, taskDescription, setTaskDescription, taskPriority, setTaskPriority,
    fetchTasks, createTask, updateTask, updateTaskStatus, routeTaskToSession, dispatchTask, deleteTask, clearCompletedTasks,
  };
}
