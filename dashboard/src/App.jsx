import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './App.css';
import { toast } from './components/Toast.jsx';
import AgentStatusCard from './components/AgentStatusCard.jsx';
import ToolWorkbench from './components/ToolWorkbench.jsx';
import MetricsPanel from './components/MetricsPanel.jsx';
import SystemPanel from './components/SystemPanel.jsx';
import MessageList from './components/MessageList.jsx';
import ChatColumn from './components/ChatColumn.jsx';
import TopBar from './components/TopBar.jsx';
import WorkspaceView from './components/WorkspaceView.jsx';
import { useWorkspaceOps } from './hooks/useWorkspaceOps.js';
import { useTaskManagement } from './hooks/useTaskManagement.js';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal.jsx';
import {
  getOrCreateUserId, getUserRole, shouldShowOnboarding,
  ENDPOINT_META, EXPERIENCE_ENDPOINTS, EXPERIENCE_TOOLS, EXPERIENCE_META, SAFETY_COLORS,
} from './constants/app-config.js';

function App() {
  const userId = useRef(getOrCreateUserId());
  const [sessions, setSessions] = useState([]);
  const [models, setModels] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [activeSessionMessages, setActiveSessionMessages] = useState([]);
  const [currentModel, setCurrentModel] = useState(ENDPOINT_META.primary.model);
  const [currentEndpoint, setCurrentEndpoint] = useState('primary');
  const [messageInput, setMessageInput] = useState('');
  const [useNemoClaw, setUseNemoClaw] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(new Set());
  const [streamingBySession, setStreamingBySession] = useState({});
  const streamAbortControllersRef = useRef(new Map());
  const fetchTasksRef = useRef(null);
  const [dockerStatus, setDockerStatus] = useState(null);
  const [systemServices, setSystemServices] = useState(null);
  const [serviceActionsInFlight, setServiceActionsInFlight] = useState({});
  const [serviceActionErrors, setServiceActionErrors] = useState({});
  const [servicesStarting, setServicesStarting] = useState({});
  const startingTimeoutsRef = useRef({});
  const [modelPulls, setModelPulls] = useState({});
  const [knownModels, setKnownModels] = useState(() => {
    try { return JSON.parse(localStorage.getItem('agent_board_pulled_models') || '{}'); } catch { return {}; }
  });
  const [contentClients, setContentClients] = useState([]);
  const [contentFiles, setContentFiles] = useState({});
  const [contentExpanded, setContentExpanded] = useState({});
  const [systemInfo, setSystemInfo] = useState(null);
  const [showSystemPanel, setShowSystemPanel] = useState(false);
  const [showNewSessionMenu, setShowNewSessionMenu] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const newSessionMenuRef = useRef(null);
  const [demoMode, setDemoMode] = useState({ enabled: false, enforcedExperience: null, allowedEndpoints: [] });
  const [liveEvents, setLiveEvents] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [showMetricsPanel, setShowMetricsPanel] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('agent_board_theme');
    const isDark = saved !== 'light';
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    return isDark;
  });
  const toggleTheme = () => {
    setDarkMode(prev => {
      const next = !prev;
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
      localStorage.setItem('agent_board_theme', next ? 'dark' : 'light');
      return next;
    });
  };
  const [selectedExperience, setSelectedExperience] = useState('developer');
  const [taskExperience, setTaskExperience] = useState('research');
  const [activeTab, setActiveTab] = useState('chat');
  const [showOnboarding, setShowOnboarding] = useState(shouldShowOnboarding);
  const [metricsSummary, setMetricsSummary] = useState(null);
  const [metricsSafety, setMetricsSafety] = useState(null);
  const [metricsFeedback, setMetricsFeedback] = useState(null);
  const [metricsErrors, setMetricsErrors] = useState(null);
  const messageQueuesRef = useRef({});
  const [queueLengths, setQueueLengths] = useState({});
  const pausedSessionsRef = useRef(new Set());
  const [pausedSessions, setPausedSessions] = useState(new Set());
  const chatBottomRef = useRef(null);

  // ── Derived endpoint helpers (needed by hooks below) ─────────────────────
  const allEndpointMeta = useMemo(() => {
    const result = { ...ENDPOINT_META };
    if (!dockerStatus?.endpoints) return result;
    for (const [key, ep] of Object.entries(dockerStatus.endpoints)) {
      if (!result[key]) {
        result[key] = {
          model: ep.model || '',
          label: ep.name || key,
          desc: ep.hasApiKey ? `${ep.type || 'custom'} · API key set` : (ep.backendType || 'custom'),
          backendBadge: ep.type === 'cloud' ? 'Cloud API' : 'Custom',
        };
      }
    }
    return result;
  }, [dockerStatus]);

  const getAvailableEndpoints = useCallback((experienceKey) => {
    if (demoMode.enabled) return ['primary'];
    const base = EXPERIENCE_ENDPOINTS[experienceKey] || EXPERIENCE_ENDPOINTS.developer;
    const customKeys = Object.entries(dockerStatus?.endpoints || {})
      .filter(([, ep]) => ep.backendType === 'custom')
      .map(([k]) => k);
    return customKeys.length ? [...new Set([...base, ...customKeys])] : base;
  }, [demoMode.enabled, dockerStatus]);

  const getPreferredModelForEndpoint = useCallback((endpoint) => {
    const configuredModel = allEndpointMeta[endpoint]?.model || currentModel;
    const endpointModels = models.filter((m) => m.id === endpoint);
    const getId = (m) => m?.name || m?.model;
    if (!endpointModels.length) return configuredModel;
    const exact = endpointModels.find((m) => {
      const id = getId(m);
      return id === configuredModel || m?.model === configuredModel;
    });
    if (exact) return getId(exact);
    const tagged = endpointModels.find((m) => {
      const id = getId(m);
      return typeof configuredModel === 'string' && typeof id === 'string' && id.startsWith(`${configuredModel}:`);
    });
    if (tagged) return getId(tagged);
    const def = endpointModels.find((m) => m?.default || m?.isDefault || m?.is_default);
    if (def) return getId(def);
    return configuredModel || getId(endpointModels[0]);
  }, [models, currentModel, allEndpointMeta]);

  // ── Custom hooks ──────────────────────────────────────────────────────────
  const wsOps = useWorkspaceOps();

  // Stable refs so task hook can call functions defined later in the closure
  const fetchSessionsRef = useRef(null);
  const fetchSessionDetailsRef = useRef(null);
  const sendMessageCoreRef = useRef(null);
  const fetchSessionsStable = useCallback(() => fetchSessionsRef.current?.(), []);
  const fetchSessionDetailsStable = useCallback((...a) => fetchSessionDetailsRef.current?.(...a), []);
  const sendMessageCoreStable = useCallback((...a) => sendMessageCoreRef.current?.(...a), []);

  const {
    tasks, taskSummary, taskTitle, setTaskTitle, taskPriority, setTaskPriority,
    fetchTasks, createTask, updateTaskStatus, routeTaskToSession, dispatchTask, deleteTask, clearCompletedTasks,
  } = useTaskManagement({
    activeSession, selectedExperience,
    wsLayout: wsOps.wsLayout, setActiveTab,
    sendMessageCore: sendMessageCoreStable,
    getAvailableEndpoints, currentEndpoint, getPreferredModelForEndpoint,
    fetchSessions: fetchSessionsStable,
    fetchSessionDetails: fetchSessionDetailsStable,
    setActiveSession,
  });

  // keep ref current so the WS handler (which has [] deps) always calls the latest fetchTasks
  fetchTasksRef.current = fetchTasks;

  // ── Data fetch functions ──────────────────────────────────────────────────
  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      if (data.success) setModels(data.models);
    } catch (error) { console.error('Error fetching models:', error); }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.success) setSessions(data.sessions);
    } catch (error) { console.error('Error fetching sessions:', error); }
  };
  fetchSessionsRef.current = fetchSessions;

  const fetchDockerStatus = async () => {
    try {
      const res = await fetch('/api/docker/status');
      const data = await res.json();
      setDockerStatus(data);
    } catch (error) {
      console.error('Error fetching Docker status:', error);
      setDockerStatus({ dockerRunning: false, errors: ['Failed to connect'] });
    }
  };

  const fetchSystemInfo = async () => {
    try {
      const res = await fetch('/api/system/info');
      const data = await res.json();
      if (data.success) setSystemInfo(data.system);
    } catch (error) { console.error('Error fetching system info:', error); }
  };

  const fetchSystemServices = async () => {
    try {
      const res = await fetch('/api/system/services');
      const data = await res.json();
      if (data.success) setSystemServices(data);
    } catch (error) { console.error('Error fetching system services:', error); setSystemServices(null); }
  };

  const fetchModelPullStatus = async () => {
    try {
      const res = await fetch('/api/models/pull-status');
      const data = await res.json();
      if (data.success) setModelPulls(data.pulls || {});
    } catch (error) { console.error('Error fetching model pull status:', error); }
  };

  const fetchDemoMode = async () => {
    try {
      const res = await fetch('/api/demo-mode');
      const data = await res.json();
      if (data.success) {
        setDemoMode({ enabled: !!data.enabled, enforcedExperience: data.enforcedExperience || null, allowedEndpoints: data.allowedEndpoints || [] });
      }
    } catch (error) { console.error('Error fetching demo mode:', error); }
  };

  const fetchMetrics = useCallback(async () => {
    try {
      const [summary, safety, feedback, errors] = await Promise.all([
        fetch('/api/metrics/summary').then(r => r.json()),
        fetch('/api/metrics/safety').then(r => r.json()),
        fetch('/api/metrics/feedback').then(r => r.json()),
        fetch('/api/metrics/errors').then(r => r.json()),
      ]);
      if (summary.success) setMetricsSummary(summary.summary);
      if (safety.success) setMetricsSafety(safety.safety);
      if (feedback.success) setMetricsFeedback(feedback.feedback);
      if (errors.success) setMetricsErrors(errors.errors);
    } catch (error) { console.error('Error fetching metrics:', error); }
  }, []);

  // ── Main data fetch effect ────────────────────────────────────────────────
  useEffect(() => {
    fetchModels(); fetchSessions(); fetchTasks(); fetchDockerStatus();
    fetchSystemServices(); fetchSystemInfo(); fetchDemoMode(); fetchModelPullStatus();
    const timers = [
      setInterval(fetchSessions, 5000),
      setInterval(fetchTasks, 7000),
      setInterval(fetchDockerStatus, 10000),
      setInterval(fetchSystemServices, 10000),
      setInterval(fetchModelPullStatus, 10000),
    ];
    return () => timers.forEach(clearInterval);
  }, []);

  useEffect(() => {
    const anyStarting = Object.values(servicesStarting).some(Boolean);
    if (!anyStarting) return;
    const poll = setInterval(() => { fetchDockerStatus(); fetchSystemServices(); }, 2000);
    return () => clearInterval(poll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicesStarting]);

  useEffect(() => {
    setServicesStarting(prev => {
      const startingKeys = Object.keys(prev).filter(k => prev[k]);
      if (startingKeys.length === 0) return prev;
      const next = { ...prev };
      let changed = false;
      for (const key of startingKeys) {
        if (dockerStatus?.containers?.[key]?.running || systemServices?.services?.[key]?.running) {
          next[key] = false;
          changed = true;
          clearTimeout(startingTimeoutsRef.current[key]);
          delete startingTimeoutsRef.current[key];
        }
      }
      return changed ? next : prev;
    });
  }, [dockerStatus, systemServices]);

  // ── Service action functions ──────────────────────────────────────────────
  const runServiceAction = async (serviceKey, action) => {
    const actionId = `${serviceKey}:${action}`;
    setServiceActionsInFlight(prev => ({ ...prev, [actionId]: true }));
    setServiceActionErrors(prev => ({ ...prev, [serviceKey]: null }));
    try {
      const res = await fetch(`/api/system/services/${serviceKey}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        const msg = data.error || 'Action failed';
        toast.error(`Service ${action} failed: ${msg}`);
        setServiceActionErrors(prev => ({ ...prev, [serviceKey]: msg }));
      } else if (action === 'start') {
        setServicesStarting(prev => ({ ...prev, [serviceKey]: true }));
        clearTimeout(startingTimeoutsRef.current[serviceKey]);
        startingTimeoutsRef.current[serviceKey] = setTimeout(() => {
          setServicesStarting(prev => ({ ...prev, [serviceKey]: false }));
          delete startingTimeoutsRef.current[serviceKey];
        }, 90000);
      }
      await Promise.all([fetchDockerStatus(), fetchSystemServices()]);
    } catch (error) {
      toast.error(`Service ${action} failed: ${error.message}`);
      setServiceActionErrors(prev => ({ ...prev, [serviceKey]: error.message }));
    } finally {
      setServiceActionsInFlight(prev => ({ ...prev, [actionId]: false }));
    }
  };

  const pullModel = async (endpoint, model) => {
    const pullKey = `${endpoint}:${model}`;
    const actionId = `pull:${pullKey}`;
    setServiceActionsInFlight(prev => ({ ...prev, [actionId]: true }));
    setServiceActionErrors(prev => ({ ...prev, [actionId]: null }));
    try {
      const res = await fetch('/api/models/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, model }),
      });
      const data = await res.json();
      if (!data.success) {
        setServiceActionErrors(prev => ({ ...prev, [actionId]: data.error || 'Pull failed' }));
      } else {
        const record = { endpointKey: endpoint, model, pulledAt: new Date().toISOString() };
        setKnownModels(prev => {
          const next = { ...prev, [pullKey]: record };
          try { localStorage.setItem('agent_board_pulled_models', JSON.stringify(next)); } catch { /* storage full */ }
          return next;
        });
      }
      await fetchModelPullStatus();
    } catch (error) {
      setServiceActionErrors(prev => ({ ...prev, [actionId]: error.message }));
    } finally {
      setServiceActionsInFlight(prev => ({ ...prev, [actionId]: false }));
    }
  };

  const fetchContentClients = async () => {
    try {
      const res = await fetch('/api/content/clients');
      const data = await res.json();
      if (data.success) setContentClients(data.clients || []);
    } catch { /* ignore */ }
  };

  const fetchContentFiles = async (slug) => {
    try {
      const res = await fetch(`/api/content/clients/${encodeURIComponent(slug)}/files`);
      const data = await res.json();
      if (data.success) setContentFiles(prev => ({ ...prev, [slug]: data.files || [] }));
    } catch { /* ignore */ }
  };

  const downloadContentFile = (slug, filePath) => {
    const url = `/api/content/download/${encodeURIComponent(slug)}/${filePath}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath.split('/').pop();
    a.click();
  };

  // ── Live effects ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (demoMode.enabled) {
      setSelectedExperience('safechat');
      setCurrentEndpoint('primary');
      setCurrentModel(ENDPOINT_META.primary.model);
    }
  }, [demoMode.enabled]);

  const wsRef = useRef(null);
  const wsReconnectTimerRef = useRef(null);
  useEffect(() => {
    let destroyed = false;
    const connect = () => {
      if (destroyed) return;
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${scheme}://${window.location.host}/ws/events`);
      wsRef.current = socket;
      socket.onopen = () => setWsConnected(true);
      socket.onclose = () => {
        setWsConnected(false);
        if (!destroyed) wsReconnectTimerRef.current = setTimeout(connect, 3000);
      };
      socket.onerror = () => setWsConnected(false);
      socket.onmessage = (msg) => {
        try {
          const payload = JSON.parse(msg.data);
          if (payload.type !== 'event' || !payload.event) return;
          setLiveEvents((prev) => [payload.event, ...prev].slice(0, 30));
          const { event_type: eventType, endpoint, model, metadata } = payload.event;
          if (eventType?.startsWith('model_pull_') && endpoint && model) {
            setModelPulls((prev) => ({ ...prev, [`${endpoint}:${model}`]: { endpoint, model, ...metadata } }));
          }
          if (eventType === 'artifact_created') {
            wsOps.fetchArtifacts?.();
          }
          if (eventType === 'task_status_changed') {
            const { status } = metadata || {};
            if (status === 'completed') toast.success('Task completed');
            else if (status === 'failed') toast.error(`Task failed${metadata?.error ? `: ${metadata.error}` : ''}`);
            fetchTasksRef.current?.();
          }
        } catch { /* ignore malformed payloads */ }
      };
    };
    connect();
    return () => {
      destroyed = true;
      clearTimeout(wsReconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const inInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) {
        if (inInput) return;
        e.preventDefault();
        createSession();
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !inInput) {
        setShowShortcuts(p => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createSession]);

  useEffect(() => {
    if (activeTab === 'metrics') {
      fetchMetrics();
      const interval = setInterval(fetchMetrics, 10000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchMetrics]);

  // ── Session helpers ───────────────────────────────────────────────────────
  const createSession = async () => {
    try {
      const availableEndpoints = getAvailableEndpoints(selectedExperience);
      const onlineEndpoints = availableEndpoints.filter((key) => {
        const ep = dockerStatus?.endpoints?.[key];
        if (dockerStatus?.endpoints) return ep ? ep.live === true : false;
        return true;
      });
      const pool = onlineEndpoints.length ? onlineEndpoints : availableEndpoints;
      const endpoint = pool.includes(currentEndpoint) ? currentEndpoint : pool[0];
      const model = getPreferredModelForEndpoint(endpoint);
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, endpoint, userId: userId.current, userRole: getUserRole(), experience: selectedExperience }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrentEndpoint(data.session.endpoint);
        setCurrentModel(data.session.model);
        setActiveSession(data.session.id);
        fetchSessions();
      }
    } catch (error) { toast.error(`Failed to create session: ${error.message}`); }
  };

  const fetchSessionDetails = async (id) => {
    try {
      const res = await fetch(`/api/sessions/${id}`);
      const data = await res.json();
      if (data.success && data.session) {
        setActiveSessionMessages(data.session.messages || []);
        setCurrentEndpoint(data.session.endpoint);
        setCurrentModel(data.session.model);
        setSessions(prev => prev.map(s => s.id === id
          ? { ...s, messageCount: (data.session.messages || []).length, endpoint: data.session.endpoint, model: data.session.model, experience: data.session.experience, safetyMode: data.session.safetyMode }
          : s
        ));
      }
    } catch (error) { console.error('Error fetching session details:', error); }
  };
  fetchSessionDetailsRef.current = fetchSessionDetails;

  // ── Queue helpers ─────────────────────────────────────────────────────────
  const enqueueMessage = (sessionId, message) => {
    if (!messageQueuesRef.current[sessionId]) messageQueuesRef.current[sessionId] = [];
    messageQueuesRef.current[sessionId].push(message);
    setQueueLengths(prev => ({ ...prev, [sessionId]: messageQueuesRef.current[sessionId].length }));
  };

  const dequeueNext = (sessionId) => {
    const queue = messageQueuesRef.current[sessionId];
    if (!queue || queue.length === 0) return null;
    const msg = queue.shift();
    setQueueLengths(prev => {
      const len = (messageQueuesRef.current[sessionId] || []).length;
      const next = { ...prev };
      if (len === 0) delete next[sessionId]; else next[sessionId] = len;
      return next;
    });
    return msg;
  };

  const togglePause = (sessionId) => {
    const next = new Set(pausedSessionsRef.current);
    if (next.has(sessionId)) {
      next.delete(sessionId);
      pausedSessionsRef.current = next;
      setPausedSessions(next);
      const nextMsg = dequeueNext(sessionId);
      if (nextMsg) sendMessageCore(sessionId, nextMsg);
    } else {
      next.add(sessionId);
      pausedSessionsRef.current = next;
      setPausedSessions(next);
    }
  };

  const stopSession = (sessionId) => {
    const ctrl = streamAbortControllersRef.current.get(sessionId);
    if (ctrl) { ctrl.abort(); streamAbortControllersRef.current.delete(sessionId); }
    setLoadingSessions(prev => { const next = new Set(prev); next.delete(sessionId); return next; });
    setStreamingBySession(prev => { const next = { ...prev }; delete next[sessionId]; return next; });
  };

  const forceSend = (sessionId) => {
    stopSession(sessionId);
    const nextMsg = dequeueNext(sessionId);
    if (nextMsg) setTimeout(() => sendMessageCore(sessionId, nextMsg), 50);
  };

  // ── Core message streaming ────────────────────────────────────────────────
  const sendMessageCore = async (sessionId, messageText) => {
    const optimisticMsg = { role: 'user', content: messageText, timestamp: new Date() };
    if (sessionId === activeSession) setActiveSessionMessages(prev => [...prev, optimisticMsg]);
    setLoadingSessions(prev => new Set([...prev, sessionId]));
    setStreamingBySession(prev => ({ ...prev, [sessionId]: '' }));
    const controller = new AbortController();
    streamAbortControllersRef.current.set(sessionId, controller);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, useSafeMode: useNemoClaw }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Stream request failed: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const event = JSON.parse(json);
            if (event.type === 'token') {
              accumulated += event.content;
              setStreamingBySession(prev => ({ ...prev, [sessionId]: accumulated }));
            } else if (event.type === 'tool_call') {
              // show tool calls inline as they arrive during agentic streaming
              const toolMsg = { role: 'tool_call', tool: event.tool, args: event.args, result: event.result, timestamp: new Date() };
              if (sessionId === activeSession) setActiveSessionMessages(prev => [...prev, toolMsg]);
            } else if (event.type === 'done' || event.type === 'error') {
              if (event.type === 'error') toast.error(event.message || 'LLM stream error');
              setStreamingBySession(prev => { const next = { ...prev }; delete next[sessionId]; return next; });
              fetchSessions();
              fetchSessionDetails(sessionId);
            }
          } catch { /* skip malformed SSE */ }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        try {
          const res = await fetch(`/api/sessions/${sessionId}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: messageText, useSafeMode: useNemoClaw }),
          });
          const data = await res.json();
          fetchSessions();
          fetchSessionDetails(sessionId);
          if (!data.success) toast.error(data.response || 'LLM error');
        } catch (fbErr) {
          toast.error(`Send failed: ${fbErr.message}`);
          if (sessionId === activeSession) setActiveSessionMessages(prev => prev.filter(m => m !== optimisticMsg));
        }
      }
    } finally {
      streamAbortControllersRef.current.delete(sessionId);
      setLoadingSessions(prev => { const next = new Set(prev); next.delete(sessionId); return next; });
      setStreamingBySession(prev => { const next = { ...prev }; delete next[sessionId]; return next; });
      if (!pausedSessionsRef.current.has(sessionId)) {
        const nextMsg = dequeueNext(sessionId);
        if (nextMsg) setTimeout(() => sendMessageCore(sessionId, nextMsg), 50);
      }
    }
  };
  sendMessageCoreRef.current = sendMessageCore;

  const sendMessage = async (e) => {
    e.preventDefault();
    const sessionId = activeSession;
    if (!sessionId || !messageInput.trim()) return;
    const message = messageInput.trim();
    setMessageInput('');
    if (loadingSessions.has(sessionId)) { enqueueMessage(sessionId, message); return; }
    sendMessageCore(sessionId, message);
  };

  const handleMessageInputKeyDown = (e) => {
    const ctrlSend = (e.ctrlKey || e.metaKey) && e.key === 'Enter';
    const enterSend = e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey;
    if (ctrlSend || enterSend) { e.preventDefault(); if (activeSession && messageInput.trim()) sendMessage(e); }
  };

  const switchEndpoint = async (endpoint, model) => {
    if (!activeSession) return;
    try {
      const res = await fetch(`/api/sessions/${activeSession}/model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, model }),
      });
      const data = await res.json();
      if (!data.success) { toast.error(data.error || data.message || 'Failed to switch model'); return; }
      setCurrentEndpoint(endpoint);
      setCurrentModel(model);
      fetchSessions();
    } catch (error) { toast.error(`Model switch failed: ${error.message}`); }
  };

  const handleEndpointSelection = (endpoint) => {
    const model = getPreferredModelForEndpoint(endpoint);
    setCurrentEndpoint(endpoint);
    setCurrentModel(model);
    switchEndpoint(endpoint, model);
  };

  const renameSession = async (id, name) => {
    if (!name?.trim()) return;
    try {
      const res = await fetch(`/api/sessions/${id}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (data.success) { fetchSessions(); toast.success('Session renamed'); }
      else toast.error(data.error || 'Rename failed');
    } catch (err) { toast.error(`Rename failed: ${err.message}`); }
  };

  const deleteSession = async (id) => {
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (activeSession === id) setActiveSession(null);
      fetchSessions();
    } catch (error) { toast.error(`Delete failed: ${error.message}`); }
  };

  const sendFeedback = async (messageIndex, positive) => {
    if (!activeSession) return;
    const targetMessage = activeSessionMessages[messageIndex];
    if (!targetMessage || targetMessage.role !== 'assistant' || targetMessage.feedback) return;
    try {
      const res = await fetch(`/api/sessions/${activeSession}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIndex, positive }),
      });
      const data = await res.json();
      if (!data.success) { console.error('Error sending feedback:', data.error || 'Unknown error'); return; }
      setActiveSessionMessages((prev) => prev.map((msg, idx) => (idx === messageIndex ? { ...msg, feedback: positive ? 'up' : 'down' } : msg)));
    } catch (error) { console.error('Error sending feedback:', error); }
  };

  // ── Derived state ─────────────────────────────────────────────────────────
  const loading = loadingSessions.has(activeSession);
  const streamingContent = streamingBySession[activeSession] || '';
  const activeSessionData = activeSession ? sessions.find(s => s.id === activeSession) : null;
  const visibleEndpointKeys = getAvailableEndpoints(activeSessionData?.experience || selectedExperience);
  const selectableEndpointKeys = visibleEndpointKeys.filter((key) => {
    const ep = dockerStatus?.endpoints?.[key];
    return ep ? ep.live === true : true;
  });
  const allServiceEntries = [
    ...Object.values(dockerStatus?.containers || {}),
    ...Object.entries(systemServices?.services || {})
      .filter(([k]) => !(dockerStatus?.containers || {})[k] && k !== 'docker-runner')
      .map(([, v]) => v),
  ];
  const runningServices = allServiceEntries.filter(s => s.running).length;
  const totalServices = allServiceEntries.length;

  const dismissOnboarding = () => {
    localStorage.setItem('agent_board_onboarding_dismissed', '1');
    setShowOnboarding(false);
  };

  useEffect(() => {
    if (!showNewSessionMenu) return;
    const handle = (e) => { if (!newSessionMenuRef.current?.contains(e.target)) setShowNewSessionMenu(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showNewSessionMenu]);

  useEffect(() => {
    if (!wsOps.wsGitPopover) return;
    const handle = (e) => { if (!wsOps.wsGitPopoverRef.current?.contains(e.target)) wsOps.setWsGitPopover(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [wsOps.wsGitPopover, wsOps.wsGitPopoverRef, wsOps.setWsGitPopover]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSessionMessages]);

  useEffect(() => {
    setActiveSessionMessages([]);
    if (activeSession) fetchSessionDetails(activeSession);
  }, [activeSession]);

  useEffect(() => {
    const available = getAvailableEndpoints(activeSessionData?.experience || selectedExperience);
    const online = available.filter((key) => {
      const ep = dockerStatus?.endpoints?.[key];
      return ep ? ep.live === true : true;
    });
    const pool = online.length ? online : available;
    if (!pool.includes(currentEndpoint)) {
      const next = pool[0];
      setCurrentEndpoint(next);
      setCurrentModel(allEndpointMeta[next]?.model || ENDPOINT_META.primary.model);
    }
  }, [activeSessionData, currentEndpoint, dockerStatus, getAvailableEndpoints, selectedExperience]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <TopBar
        activeTab={activeTab} setActiveTab={setActiveTab}
        wsLayout={wsOps.wsLayout} setWsLayout={wsOps.setWsLayout}
        browseWorkspace={wsOps.browseWorkspace} refreshWorkspaceGit={wsOps.refreshWorkspaceGit}
        fetchBranches={wsOps.fetchBranches} fetchArtifacts={wsOps.fetchArtifacts}
        demoMode={demoMode}
        showNewSessionMenu={showNewSessionMenu} setShowNewSessionMenu={setShowNewSessionMenu}
        newSessionMenuRef={newSessionMenuRef}
        selectedExperience={selectedExperience} setSelectedExperience={setSelectedExperience}
        allEndpointMeta={allEndpointMeta} selectableEndpointKeys={selectableEndpointKeys}
        currentEndpoint={currentEndpoint} handleEndpointSelection={handleEndpointSelection}
        sessions={sessions} activeSession={activeSession}
        setActiveSession={setActiveSession} fetchSessionDetails={fetchSessionDetails}
        deleteSession={deleteSession}
        wsConnected={wsConnected}
        showMetricsPanel={showMetricsPanel} setShowMetricsPanel={setShowMetricsPanel}
        showSystemPanel={showSystemPanel} setShowSystemPanel={setShowSystemPanel}
        dockerStatus={dockerStatus} fetchContentClients={fetchContentClients}
        runningServices={runningServices} totalServices={totalServices}
        createSession={createSession}
      />

      {/* session tabs are now inline in TopBar */}

      {showOnboarding && (
        <div className="onboarding-strip">
          <div className="onboarding-copy">
            <strong>Welcome to Agent Board.</strong>
            <span>
              Choose an experience, pick a model, then click <strong>+ New ▾</strong> to create a session.
              {totalServices > 0 && ` ${runningServices}/${totalServices} services are live.`}
              {demoMode.enabled && ' Demo mode is locked to Safe Chat and the primary model endpoint.'}
            </span>
          </div>
          <div className="onboarding-actions">
            <button className="btn-primary" onClick={createSession}>Create Session</button>
            <button className="btn-secondary" onClick={dismissOnboarding}>Dismiss</button>
          </div>
        </div>
      )}

      <div className="layout">
        <div
          className={`content${wsOps.wsLayout !== 'single' ? ` layout-${wsOps.wsLayout}` : ''}`}
          style={wsOps.wsLayout === 'split-h' ? { '--ws-split-pos': `${wsOps.wsSplitPos}%` } : wsOps.wsLayout === 'split-v' ? { '--ws-split-pos': `${wsOps.wsSplitPos}%` } : undefined}
        >
          {(wsOps.wsLayout !== 'single' || activeTab === 'workspace') && (
            <WorkspaceView
              dockerStatus={dockerStatus}
              {...wsOps}
              tasks={tasks}
              taskTitle={taskTitle} setTaskTitle={setTaskTitle}
              taskPriority={taskPriority} setTaskPriority={setTaskPriority}
              taskExperience={taskExperience} setTaskExperience={setTaskExperience}
              createTask={createTask} updateTaskStatus={updateTaskStatus}
              dispatchTask={dispatchTask} deleteTask={deleteTask} clearCompletedTasks={clearCompletedTasks}
              activeSession={activeSession} setActiveSession={setActiveSession}
              fetchSessionDetails={fetchSessionDetails} setActiveTab={setActiveTab}
              selectedExperience={selectedExperience}
              contentClients={contentClients} contentFiles={contentFiles}
              contentExpanded={contentExpanded} setContentExpanded={setContentExpanded}
              fetchContentClients={fetchContentClients} fetchContentFiles={fetchContentFiles}
              downloadContentFile={downloadContentFile}
            />
          )}
          {wsOps.wsLayout === 'split-h' && (
            <div className="ws-split-handle ws-split-handle-h" onMouseDown={wsOps.startSplitResize} title="Drag to resize" />
          )}
          {wsOps.wsLayout === 'split-v' && (
            <div className="ws-split-handle ws-split-handle-v" onMouseDown={wsOps.startSplitResizeV} title="Drag to resize" />
          )}
          {(wsOps.wsLayout !== 'single' || activeTab !== 'workspace') && (
            <ChatColumn
              activeSessionData={activeSessionData}
              activeSessionMessages={activeSessionMessages}
              activeSession={activeSession}
              loading={loading}
              streamingContent={streamingContent}
              queueLengths={queueLengths}
              pausedSessions={pausedSessions}
              messageInput={messageInput}
              setMessageInput={setMessageInput}
              sendMessage={sendMessage}
              handleMessageInputKeyDown={handleMessageInputKeyDown}
              sendFeedback={sendFeedback}
              togglePause={togglePause}
              deleteSession={deleteSession}
              renameSession={renameSession}
              fetchSessionDetails={fetchSessionDetails}
              forceSend={forceSend}
              stopSession={stopSession}
              handleEndpointSelection={handleEndpointSelection}
              selectableEndpointKeys={selectableEndpointKeys}
              currentEndpoint={currentEndpoint}
              allEndpointMeta={allEndpointMeta}
              useNemoClaw={useNemoClaw}
              setUseNemoClaw={setUseNemoClaw}
              demoMode={demoMode}
              chatBottomRef={chatBottomRef}
              serviceActionsInFlight={serviceActionsInFlight}
              runServiceAction={runServiceAction}
              EXPERIENCE_TOOLS={EXPERIENCE_TOOLS}
              SAFETY_COLORS={SAFETY_COLORS}
              EXPERIENCE_META={EXPERIENCE_META}
              selectedExperience={selectedExperience}
              setSelectedExperience={setSelectedExperience}
              createSession={createSession}
              dockerStatus={dockerStatus}
            />
          )}
        </div>

        {showMetricsPanel && (
          <MetricsPanel
            metricsSummary={metricsSummary}
            metricsSafety={metricsSafety}
            metricsFeedback={metricsFeedback}
            metricsErrors={metricsErrors}
            liveEvents={liveEvents}
            taskSummary={taskSummary}
            onRefresh={fetchMetrics}
            onClose={() => setShowMetricsPanel(false)}
          />
        )}

        {showSystemPanel && (
          <SystemPanel
            dockerStatus={dockerStatus}
            systemServices={systemServices}
            modelPulls={modelPulls}
            systemInfo={systemInfo}
            darkMode={darkMode}
            onToggleTheme={toggleTheme}
            onClose={() => setShowSystemPanel(false)}
            serviceActionsInFlight={serviceActionsInFlight}
            serviceActionErrors={serviceActionErrors}
            servicesStarting={servicesStarting}
            onRunServiceAction={runServiceAction}
            onPullModel={pullModel}
            runningServices={runningServices}
            totalServices={totalServices}
            knownModels={knownModels}
            showMetricsPanel={showMetricsPanel}
            onToggleMetrics={() => setShowMetricsPanel(p => !p)}
          />
        )}
        {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
      </div>
    </div>
  );
}

export default App;
