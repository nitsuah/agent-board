import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

// ── Anonymous user identity ────────────────────────────────────────────────
function getOrCreateUserId() {
  const key = 'agent_board_user_id';
  let id = localStorage.getItem(key);
  if (!id) {
    // Use crypto.randomUUID() when available (all modern browsers), fall back to Date+random
    id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? 'anon_' + crypto.randomUUID()
      : 'anon_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 11);
    localStorage.setItem(key, id);
  }
  return id;
}

function getUserRole() {
  return localStorage.getItem('agent_board_user_role') || null;
}

function shouldShowOnboarding() {
  return localStorage.getItem('agent_board_onboarding_dismissed') !== '1';
}

// Max characters to show for error messages in the metrics UI
const ERROR_DISPLAY_MAX_LEN = 80;
const ENDPOINT_META = {
  primary:       { model: 'llama2:latest',          label: 'Llama2',        desc: 'Ollama container · 3.8 GB',      backendBadge: 'Ollama' },
  docker_runner: { model: 'ai/qwen3-coder:latest',  label: 'Qwen3-Coder',   desc: 'Docker Model Runner · 16.45 GB', backendBadge: 'Docker Runner' },
  glm_flash:     { model: 'ai/glm-4.7-flash:latest',label: 'GLM-4.7-Flash', desc: 'Docker Model Runner · 16.31 GB', backendBadge: 'Docker Runner' },
};

// ── Experience definitions (mirrors server EXPERIENCE_CONFIGS) ─────────────
const EXPERIENCE_META = {
  developer: { icon: '💻', name: 'Developer Assistant', description: 'Full model access, standard safety.' },
  research:  { icon: '🔬', name: 'Research Mode',        description: 'Long-form reasoning. Slightly looser rails.' },
  safechat:  { icon: '🛡️', name: 'Safe Chat',            description: 'Strict safety. Simple UI for any user.' },
};

const EXPERIENCE_ENDPOINTS = {
  developer: ['primary', 'docker_runner', 'glm_flash'],
  research: ['primary', 'docker_runner', 'glm_flash'],
  safechat: ['primary']
};

// ── Safety mode badge colours ──────────────────────────────────────────────
const SAFETY_COLORS = { strict: '#f44336', standard: '#ff9800', research: '#4caf50' };

function App() {
  const userId = useRef(getOrCreateUserId());

  const [sessions, setSessions] = useState([]);
  const [models, setModels] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [activeSessionMessages, setActiveSessionMessages] = useState([]);
  const [currentModel, setCurrentModel] = useState('llama2:latest');
  const [currentEndpoint, setCurrentEndpoint] = useState('primary');
  const [messageInput, setMessageInput] = useState('');
  const [useNemoClaw, setUseNemoClaw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dockerStatus, setDockerStatus] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [showSystemPanel, setShowSystemPanel] = useState(false);
  const [demoMode, setDemoMode] = useState({ enabled: false, enforcedExperience: null, allowedEndpoints: [] });
  const [liveEvents, setLiveEvents] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);

  // Experience selector
  const [selectedExperience, setSelectedExperience] = useState('developer');

  // Active tab: 'chat' | 'metrics'
  const [activeTab, setActiveTab] = useState('chat');
  const [showOnboarding, setShowOnboarding] = useState(shouldShowOnboarding);

  // Metrics data
  const [metricsSummary, setMetricsSummary] = useState(null);
  const [metricsSafety, setMetricsSafety] = useState(null);
  const [metricsFeedback, setMetricsFeedback] = useState(null);
  const [metricsErrors, setMetricsErrors] = useState(null);

  const chatBottomRef = useRef(null);

  const getAvailableEndpoints = useCallback((experienceKey) => {
    if (demoMode.enabled) {
      return ['primary'];
    }
    return EXPERIENCE_ENDPOINTS[experienceKey] || EXPERIENCE_ENDPOINTS.developer;
  }, [demoMode.enabled]);

  // ── Data fetching ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetchModels();
    fetchSessions();
    fetchDockerStatus();
    fetchSystemInfo();
    fetchDemoMode();

    const sessionInterval = setInterval(fetchSessions, 5000);
    const dockerInterval = setInterval(fetchDockerStatus, 10000);
    return () => { clearInterval(sessionInterval); clearInterval(dockerInterval); };
  }, []);

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

  const fetchDemoMode = async () => {
    try {
      const res = await fetch('/api/demo-mode');
      const data = await res.json();
      if (data.success) {
        setDemoMode({
          enabled: !!data.enabled,
          enforcedExperience: data.enforcedExperience || null,
          allowedEndpoints: data.allowedEndpoints || []
        });
      }
    } catch (error) {
      console.error('Error fetching demo mode:', error);
    }
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

  useEffect(() => {
    if (demoMode.enabled) {
      setSelectedExperience('safechat');
      setCurrentEndpoint('primary');
      setCurrentModel(ENDPOINT_META.primary.model);
    }
  }, [demoMode.enabled]);

  useEffect(() => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${window.location.host}/ws/events`);

    socket.onopen = () => setWsConnected(true);
    socket.onclose = () => setWsConnected(false);
    socket.onerror = () => setWsConnected(false);
    socket.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data);
        if (payload.type !== 'event' || !payload.event) {
          return;
        }

        setLiveEvents((prev) => [payload.event, ...prev].slice(0, 30));
      } catch {
        // Ignore malformed payloads.
      }
    };

    return () => socket.close();
  }, []);

  useEffect(() => {
    if (activeTab === 'metrics') {
      fetchMetrics();
      const interval = setInterval(fetchMetrics, 10000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchMetrics]);

  // ── Session helpers ────────────────────────────────────────────────────────
  const createSession = async () => {
    try {
      const availableEndpoints = getAvailableEndpoints(selectedExperience);
      const onlineEndpoints = availableEndpoints.filter((key) => {
        const endpointStatus = dockerStatus?.endpoints?.[key];
        return endpointStatus ? endpointStatus.live === true : true;
      });
      const endpointPool = onlineEndpoints.length ? onlineEndpoints : availableEndpoints;
      const endpoint = endpointPool.includes(currentEndpoint)
        ? currentEndpoint
        : endpointPool[0];
      const model = ENDPOINT_META[endpoint]?.model || currentModel;

      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          endpoint,
          userId: userId.current,
          userRole: getUserRole(),
          experience: selectedExperience
        })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentEndpoint(data.session.endpoint);
        setCurrentModel(data.session.model);
        setActiveSession(data.session.id);
        fetchSessions();
      }
    } catch (error) { console.error('Error creating session:', error); }
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
          ? {
              ...s,
              messageCount: (data.session.messages || []).length,
              endpoint: data.session.endpoint,
              model: data.session.model,
              experience: data.session.experience,
              safetyMode: data.session.safetyMode
            }
          : s
        ));
      }
    } catch (error) { console.error('Error fetching session details:', error); }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!activeSession || !messageInput.trim()) return;

    const optimisticMsg = { role: 'user', content: messageInput.trim(), timestamp: new Date() };
    setActiveSessionMessages(prev => [...prev, optimisticMsg]);
    const sentMessage = messageInput;
    setMessageInput('');
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${activeSession}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: sentMessage, useSafeMode: useNemoClaw })
      });
      const data = await res.json();
      fetchSessions();
      fetchSessionDetails(activeSession);
      if (!data.success) console.error('LLM error:', data.response);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessageInput(sentMessage);
      setActiveSessionMessages(prev => prev.filter(m => m !== optimisticMsg));
    } finally {
      setLoading(false);
    }
  };

  const switchEndpoint = async (endpoint, model) => {
    if (!activeSession) return;
    try {
      const res = await fetch(`/api/sessions/${activeSession}/model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, model })
      });
      const data = await res.json();
      if (!data.success) {
        console.error('Error switching endpoint:', data.error || data.message || 'Unknown error');
        return;
      }

      setCurrentEndpoint(endpoint);
      setCurrentModel(model);
      fetchSessions();
    } catch (error) { console.error('Error switching endpoint:', error); }
  };

  const handleEndpointSelection = (endpoint) => {
    const model = ENDPOINT_META[endpoint]?.model || 'llama2:latest';
    setCurrentEndpoint(endpoint);
    setCurrentModel(model);
    switchEndpoint(endpoint, model);
  };

  const deleteSession = async (id) => {
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (activeSession === id) setActiveSession(null);
      fetchSessions();
    } catch (error) { console.error('Error deleting session:', error); }
  };

  const sendFeedback = async (messageIndex, positive) => {
    if (!activeSession) return;
    const targetMessage = activeSessionMessages[messageIndex];
    if (!targetMessage || targetMessage.role !== 'assistant' || targetMessage.feedback) {
      return;
    }

    try {
      const res = await fetch(`/api/sessions/${activeSession}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIndex, positive })
      });

      const data = await res.json();
      if (!data.success) {
        console.error('Error sending feedback:', data.error || 'Unknown error');
        return;
      }

      const feedbackValue = positive ? 'up' : 'down';
      setActiveSessionMessages((prev) => prev.map((msg, idx) => (
        idx === messageIndex ? { ...msg, feedback: feedbackValue } : msg
      )));
    } catch (error) { console.error('Error sending feedback:', error); }
  };

  // ── Derived state ──────────────────────────────────────────────────────────
  const activeSessionData = activeSession ? sessions.find(s => s.id === activeSession) : null;

  const getDockerStatusColor = () => {
    if (!dockerStatus) return 'gray';
    const running = Object.values(dockerStatus.containers || {}).filter(c => c.running).length;
    if (running >= 2) return 'green';
    if (running >= 1) return 'yellow';
    return 'red';
  };

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSessionMessages]);

  useEffect(() => {
    setActiveSessionMessages([]);
    if (activeSession) fetchSessionDetails(activeSession);
  }, [activeSession]);

  useEffect(() => {
    const availableEndpoints = getAvailableEndpoints(activeSessionData?.experience || selectedExperience);
    const onlineEndpoints = availableEndpoints.filter((key) => {
      const endpointStatus = dockerStatus?.endpoints?.[key];
      return endpointStatus ? endpointStatus.live === true : true;
    });
    const endpointPool = onlineEndpoints.length ? onlineEndpoints : availableEndpoints;

    if (!endpointPool.includes(currentEndpoint)) {
      const nextEndpoint = endpointPool[0];
      setCurrentEndpoint(nextEndpoint);
      setCurrentModel(ENDPOINT_META[nextEndpoint]?.model || 'llama2:latest');
    }
  }, [activeSessionData, currentEndpoint, dockerStatus, getAvailableEndpoints, selectedExperience]);

  const visibleEndpointKeys = getAvailableEndpoints(activeSessionData?.experience || selectedExperience);
  const selectableEndpointKeys = visibleEndpointKeys.filter((key) => {
    const endpointStatus = dockerStatus?.endpoints?.[key];
    return endpointStatus ? endpointStatus.live === true : true;
  });
  const runningServices = Object.values(dockerStatus?.containers || {}).filter(c => c.running).length;
  const totalServices = Object.keys(dockerStatus?.containers || {}).length;

  const dismissOnboarding = () => {
    localStorage.setItem('agent_board_onboarding_dismissed', '1');
    setShowOnboarding(false);
  };

  // ── Metrics helpers ────────────────────────────────────────────────────────
  const renderBar = (value, max, color = '#4caf50') => {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return (
      <div style={{ background: '#333', borderRadius: 4, height: 10, flex: 1 }}>
        <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="brand-block">
            <h1>🤖 Agent Board</h1>
            <p className="brand-subtitle">Local AI operations cockpit for safe multi-model workflows</p>
          </div>
          <div className="header-info">
            {/* Experience picker */}
            <select
              className="experience-select"
              value={selectedExperience}
              onChange={e => setSelectedExperience(e.target.value)}
              title="Switch experience mode"
              disabled={demoMode.enabled}
            >
              {Object.entries(EXPERIENCE_META)
                .filter(([key]) => !demoMode.enabled || key === 'safechat')
                .map(([key, exp]) => (
                <option key={key} value={key}>{exp.icon} {exp.name}</option>
              ))}
            </select>

            {/* Top model picker */}
            <select
              className="model-select-top"
              value={selectableEndpointKeys.includes(currentEndpoint) ? currentEndpoint : (selectableEndpointKeys[0] || '')}
              onChange={e => handleEndpointSelection(e.target.value)}
              title="Choose model endpoint"
              disabled={selectableEndpointKeys.length === 0 || demoMode.enabled}
            >
              {selectableEndpointKeys.length === 0 ? (
                <option value="">No models online</option>
              ) : (
                selectableEndpointKeys.map((key) => (
                  <option key={key} value={key}>{ENDPOINT_META[key]?.label}</option>
                ))
              )}
            </select>

            <span className={`badge docker-status ${getDockerStatusColor()}`}>
              {(() => {
                const running = Object.values(dockerStatus?.containers || {}).filter(c => c.running).length;
                const total = Object.keys(dockerStatus?.containers || {}).length;
                return total > 0 ? `Services: ${running}/${total}` : 'Services: ...';
              })()}
            </span>

            <span className="badge experience-badge">
              {EXPERIENCE_META[selectedExperience]?.icon} {EXPERIENCE_META[selectedExperience]?.name}
            </span>

            {demoMode.enabled && <span className="badge demo-badge">Public Demo Mode</span>}
            <span className={`badge ws-badge ${wsConnected ? 'connected' : 'disconnected'}`}>
              {wsConnected ? 'Live Feed: Connected' : 'Live Feed: Offline'}
            </span>

            {/* Tab switcher */}
            <button
              className={`btn-tab ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >💬 Chat</button>
            <button
              className={`btn-tab ${activeTab === 'metrics' ? 'active' : ''}`}
              onClick={() => setActiveTab('metrics')}
            >📊 Metrics</button>

            <button className={`btn-system ${showSystemPanel ? 'active' : ''}`} onClick={() => setShowSystemPanel(!showSystemPanel)}>
              ⚙️ System
            </button>
          </div>
        </div>
      </header>

      {showOnboarding && (
        <div className="onboarding-strip">
          <div className="onboarding-copy">
            <strong>Welcome to Agent Board.</strong>
            <span>
              Start in <strong>{EXPERIENCE_META[selectedExperience]?.name}</strong>, then create a session and send a prompt.
              {totalServices > 0 && ` ${runningServices}/${totalServices} services are live.`}
              {demoMode.enabled && ' Demo mode is locked to Safe Chat and the primary model endpoint.'}
            </span>
          </div>
          <div className="onboarding-actions">
            <button className="btn-system-action primary" onClick={createSession}>Create Session</button>
            <button className="btn-system-action" onClick={dismissOnboarding}>Dismiss</button>
          </div>
        </div>
      )}

      <div className="container">
        {/* System Panel */}
        {showSystemPanel && (
          <div className="system-panel-overlay">
            <div className="system-panel">
              <div className="system-panel-header">
                <h2>System Management</h2>
                <button onClick={() => setShowSystemPanel(false)}>✕</button>
              </div>
              <div className="system-info">
                <div className="system-info-item">
                  <h3>Stack Status</h3>
                  <div className={`value ${dockerStatus?.dockerRunning ? '' : 'warning'}`}>
                    {dockerStatus?.dockerRunning ? 'Healthy' : 'Degraded'}
                  </div>
                </div>
                <div className="system-info-item">
                  <h3>Active Services</h3>
                  <div className="value">
                    {Object.values(dockerStatus?.containers || {}).filter(c => c.running).length}/{Object.keys(dockerStatus?.containers || {}).length}
                  </div>
                </div>
                <div className="system-info-item">
                  <h3>Server Memory</h3>
                  <div className="value">{systemInfo?.memory?.rss ? `${Math.round(systemInfo.memory.rss / 1024 / 1024)} MB` : 'N/A'}</div>
                </div>
                <div className="system-info-item">
                  <h3>Uptime</h3>
                  <div className="value">{systemInfo?.uptime ? `${Math.round(systemInfo.uptime / 60)} min` : 'N/A'}</div>
                </div>
              </div>
              <div className="docker-status">
                <h3>Services</h3>
                {dockerStatus?.containers && Object.entries(dockerStatus.containers).map(([name, status]) => (
                  <div key={name} className="docker-status-item">
                    <div className="docker-service-info">
                      <div className="docker-service-name">
                        {status.label || name}
                        <span style={{ fontSize: '0.7rem', opacity: 0.55, marginLeft: '0.4rem' }}>({status.backendType})</span>
                      </div>
                      <div className={`docker-service-status ${status.running ? 'running' : 'stopped'}`}>
                        {status.running ? '● Live' : '● ' + status.status}
                      </div>
                      <div className="docker-service-port">{status.ports}</div>
                    </div>
                  </div>
                ))}
                <h3 style={{ marginTop: '1rem' }}>LLM Endpoints</h3>
                {dockerStatus?.endpoints && Object.entries(dockerStatus.endpoints).map(([key, ep]) => (
                  <div key={key} className="docker-status-item">
                    <div className="docker-service-info">
                      <div className="docker-service-name">{ep.name}</div>
                      <div className={`docker-service-status ${ep.live ? 'running' : 'stopped'}`}>
                        {ep.live ? '● Live' : '● Offline / Fallback'}
                      </div>
                      <div className="docker-service-port" style={{ fontSize: '0.72rem' }}>{ep.model}</div>
                    </div>
                  </div>
                ))}
                <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                  Docker Runner models: <code>docker model pull ai/glm-4.7-flash:latest</code><br />
                  Manage stack: <code>stack-manager.ps1</code>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Metrics Tab ── */}
        {activeTab === 'metrics' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              {/* Summary cards */}
              {[
                { label: 'Total Sessions', value: metricsSummary?.totalSessions ?? '…' },
                { label: 'Active Sessions', value: metricsSummary?.activeSessions ?? '…' },
                { label: 'Total Messages', value: metricsSummary?.totalMessages ?? '…' },
                { label: 'Avg Msgs / Session', value: metricsSummary?.avgMessagesPerSession ?? '…' },
                { label: 'Inputs Blocked', value: metricsSafety?.totalBlocked ?? '…' },
                { label: 'Outputs Filtered', value: metricsSafety?.totalOutputsFiltered ?? '…' },
                { label: '👍 Positive', value: metricsFeedback?.totalPositive ?? '…' },
                { label: '👎 Negative', value: metricsFeedback?.totalNegative ?? '…' },
              ].map(({ label, value }) => (
                <div key={label} className="metric-card">
                  <div className="metric-value">{value}</div>
                  <div className="metric-label">{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
              {/* Model distribution */}
              <div className="metric-panel">
                <h3>Model Usage Distribution</h3>
                {metricsSummary?.modelDistribution && Object.keys(metricsSummary.modelDistribution).length > 0 ? (
                  Object.entries(metricsSummary.modelDistribution).map(([model, count]) => {
                    const total = Object.values(metricsSummary.modelDistribution).reduce((a, b) => a + b, 0);
                    return (
                      <div key={model} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.78rem', width: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#ccc' }}>{model}</span>
                        {renderBar(count, total, '#2196f3')}
                        <span style={{ fontSize: '0.78rem', color: '#aaa', minWidth: 30 }}>{count}</span>
                      </div>
                    );
                  })
                ) : <p style={{ color: '#666', fontSize: '0.85rem' }}>No data yet. Send a message to start.</p>}
              </div>

              {/* Experience distribution */}
              <div className="metric-panel">
                <h3>Sessions by Experience</h3>
                {metricsSummary?.experienceDistribution && Object.keys(metricsSummary.experienceDistribution).length > 0 ? (
                  Object.entries(metricsSummary.experienceDistribution).map(([exp, count]) => {
                    const total = Object.values(metricsSummary.experienceDistribution).reduce((a, b) => a + b, 0);
                    const meta = EXPERIENCE_META[exp] || { icon: '?', name: exp };
                    return (
                      <div key={exp} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.78rem', width: 140, color: '#ccc' }}>{meta.icon} {meta.name}</span>
                        {renderBar(count, total, '#9c27b0')}
                        <span style={{ fontSize: '0.78rem', color: '#aaa', minWidth: 30 }}>{count}</span>
                      </div>
                    );
                  })
                ) : <p style={{ color: '#666', fontSize: '0.85rem' }}>No data yet.</p>}
              </div>

              {/* Safety breakdown */}
              <div className="metric-panel">
                <h3>Input Classification Breakdown</h3>
                {metricsSafety?.classificationBreakdown ? (
                  Object.entries(metricsSafety.classificationBreakdown).map(([cat, count]) => {
                    const total = metricsSafety.totalClassified || 1;
                    const color = cat === 'blocked' ? '#f44336' : cat === 'sensitive' ? '#ff9800' : '#4caf50';
                    return (
                      <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.78rem', width: 80, color: '#ccc', textTransform: 'capitalize' }}>{cat}</span>
                        {renderBar(count, total, color)}
                        <span style={{ fontSize: '0.78rem', color: '#aaa', minWidth: 30 }}>{count}</span>
                      </div>
                    );
                  })
                ) : <p style={{ color: '#666', fontSize: '0.85rem' }}>No data yet.</p>}
              </div>

              {/* Feedback by model */}
              <div className="metric-panel">
                <h3>Feedback by Model</h3>
                {metricsFeedback?.byModel && Object.keys(metricsFeedback.byModel).length > 0 ? (
                  Object.entries(metricsFeedback.byModel).map(([model, fb]) => (
                    <div key={model} style={{ marginBottom: '0.6rem' }}>
                      <div style={{ fontSize: '0.78rem', color: '#ccc', marginBottom: '0.2rem' }}>{model}</div>
                      <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem' }}>
                        <span style={{ color: '#4caf50' }}>👍 {fb.positive}</span>
                        <span style={{ color: '#f44336' }}>👎 {fb.negative}</span>
                      </div>
                    </div>
                  ))
                ) : <p style={{ color: '#666', fontSize: '0.85rem' }}>No feedback recorded yet.</p>}
              </div>

              {/* Error summary */}
              <div className="metric-panel">
                <h3>Error Summary</h3>
                {metricsErrors ? (
                  <div>
                    <p style={{ fontSize: '0.85rem', color: '#ccc' }}>
                      Total errors: <strong>{metricsErrors.total}</strong> &nbsp;|&nbsp;
                      Rate: <strong>{metricsErrors.errorRatePercent}%</strong> &nbsp;|&nbsp;
                      Last 5 min: <strong style={{ color: metricsErrors.recentCount > 0 ? '#f44336' : '#4caf50' }}>{metricsErrors.recentCount}</strong>
                    </p>
                    {metricsErrors.recent?.length > 0 && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.25rem' }}>Recent errors:</div>
                        {metricsErrors.recent.slice(-3).map((e, i) => (
                          <div key={i} style={{ fontSize: '0.73rem', color: '#f44336', marginBottom: '0.2rem' }}>
                            [{new Date(e.timestamp).toLocaleTimeString()}] {e.model}: {e.error?.slice(0, ERROR_DISPLAY_MAX_LEN)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : <p style={{ color: '#666', fontSize: '0.85rem' }}>No data yet.</p>}
              </div>

              <div className="metric-panel live-event-panel">
                <h3>Live Event Stream</h3>
                {liveEvents.length > 0 ? (
                  <div className="live-events-list">
                    {liveEvents.slice(0, 12).map((event) => (
                      <div key={event.event_id} className="live-event-item">
                        <div className="live-event-meta">
                          <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                          <strong>{event.event_type}</strong>
                        </div>
                        <div className="live-event-detail">
                          {event.experience || 'unknown'} • {event.endpoint || 'n/a'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p style={{ color: '#666', fontSize: '0.85rem' }}>No live events yet.</p>}
              </div>
            </div>

            <button className="btn-primary" style={{ alignSelf: 'flex-start' }} onClick={fetchMetrics}>
              ↻ Refresh Metrics
            </button>
          </div>
        )}

        {/* ── Chat Tab ── */}
        {activeTab === 'chat' && (
          <>
            {/* Sidebar */}
            <aside className="sidebar">
              <section className="section">
                <h2>Sessions</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button className="btn-primary" style={{ flex: 1 }} onClick={createSession}>
                    + New Session
                  </button>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.75rem' }}>
                  {EXPERIENCE_META[selectedExperience]?.icon} {EXPERIENCE_META[selectedExperience]?.name}
                </div>
                <div className="sessions-list">
                  {sessions.map(session => (
                    <div
                      key={session.id}
                      className={`session-item ${activeSession === session.id ? 'active' : ''}`}
                      onClick={() => setActiveSession(session.id)}
                    >
                      <div className="session-info">
                        <div className="session-name">{session.name}</div>
                        <div className="session-meta">
                          {session.endpoint} • {session.messageCount} msgs
                          {session.safetyMode && (
                            <span style={{ marginLeft: '0.3rem', color: SAFETY_COLORS[session.safetyMode], fontSize: '0.65rem' }}>
                              [{session.safetyMode}]
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        className="btn-delete"
                        onClick={e => { e.stopPropagation(); deleteSession(session.id); }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              </section>
            </aside>

            {/* Main Chat Area */}
            <main className="main">
              {activeSessionData ? (
                <>
                  <div className="chat-header">
                    <h2>{activeSessionData.name}</h2>
                    <div className="chat-meta">
                      {activeSessionData.endpoint} • {activeSessionData.messageCount} messages
                      {activeSessionData.safetyMode && (
                        <span style={{ marginLeft: '0.5rem', color: SAFETY_COLORS[activeSessionData.safetyMode], fontWeight: 600, fontSize: '0.75rem' }}>
                          🛡 {activeSessionData.safetyMode}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="chat-container">
                    {activeSessionMessages.length > 0 ? (
                      activeSessionMessages.map((msg, index) => (
                        <div key={index} className={`message ${msg.role}`}>
                          <div className="message-content">
                            <strong>{msg.role === 'user' ? 'You' : 'AI'}:</strong> {msg.content}
                            {msg.blocked && (
                              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#f44336' }}>
                                [blocked by safety filter]
                              </span>
                            )}
                          </div>
                          {msg.role === 'assistant' && (
                            <div className="message-feedback">
                              {msg.feedback ? (
                                <span style={{ fontSize: '0.78rem', color: '#9ad', border: '1px solid #446', borderRadius: 4, padding: '0.1rem 0.4rem' }}>
                                  Feedback saved: {msg.feedback === 'up' ? '👍' : '👎'}
                                </span>
                              ) : (
                                <>
                                  <button
                                    className="btn-feedback"
                                    onClick={() => sendFeedback(index, true)}
                                    title="This was helpful"
                                  >👍</button>
                                  <button
                                    className="btn-feedback"
                                    onClick={() => sendFeedback(index, false)}
                                    title="This wasn't helpful"
                                  >👎</button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="messages-placeholder">
                        <p>No messages yet. Start a conversation!</p>
                      </div>
                    )}
                    {loading && (
                      <div className="message assistant">
                        <div className="message-content" style={{ opacity: 0.6, fontStyle: 'italic' }}>
                          <strong>AI:</strong> Thinking...
                        </div>
                      </div>
                    )}
                    <div ref={chatBottomRef} />
                  </div>

                  <form className="chat-input-form" onSubmit={sendMessage}>
                    <input
                      type="text"
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      placeholder="Type your message..."
                      maxLength={4000}
                      disabled={loading}
                    />
                    <span className="input-counter">{messageInput.length}/4000</span>
                    <select
                      className="model-select-inline"
                      value={selectableEndpointKeys.includes(currentEndpoint) ? currentEndpoint : (selectableEndpointKeys[0] || '')}
                      onChange={e => handleEndpointSelection(e.target.value)}
                      title="Choose model endpoint"
                      disabled={loading || selectableEndpointKeys.length === 0 || demoMode.enabled}
                    >
                      {selectableEndpointKeys.length === 0 ? (
                        <option value="">No models online</option>
                      ) : (
                        selectableEndpointKeys.map((key) => (
                          <option key={key} value={key}>{ENDPOINT_META[key]?.label}</option>
                        ))
                      )}
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: '#aaa', whiteSpace: 'nowrap' }}>
                      <input
                        type="checkbox"
                        checked={useNemoClaw}
                        onChange={e => setUseNemoClaw(e.target.checked)}
                      />
                      NemoClaw safe mode
                    </label>
                    <button type="submit" disabled={loading} className="btn-send">
                      {loading ? 'Sending...' : 'Send'}
                    </button>
                  </form>
                </>
              ) : (
                <div className="empty-state">
                  <h2>No session selected</h2>
                  <p>Choose an experience and create a session to get started.</p>

                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                    {Object.entries(EXPERIENCE_META)
                      .filter(([key]) => !demoMode.enabled || key === 'safechat')
                      .map(([key, exp]) => (
                      <div
                        key={key}
                        className={`experience-option ${selectedExperience === key ? 'selected' : ''}`}
                        onClick={() => setSelectedExperience(key)}
                        style={{ cursor: 'pointer', flex: '1 1 180px' }}
                      >
                        <span style={{ fontSize: '1.5rem' }}>{exp.icon}</span>
                        <div>
                          <div style={{ fontWeight: 600 }}>{exp.name}</div>
                          <div style={{ fontSize: '0.75rem', color: '#aaa' }}>{exp.description}</div>
                        </div>
                        {selectedExperience === key && <span style={{ marginLeft: 'auto', color: '#4caf50' }}>✓</span>}
                      </div>
                    ))}
                  </div>

                  <button className="btn-primary" onClick={createSession} style={{ marginBottom: '1.5rem' }}>
                    + Start a {EXPERIENCE_META[selectedExperience]?.name} Session
                  </button>

                  <div className="endpoint-preview">
                    <h3>Available Endpoints:</h3>
                    <ul>
                      {Object.entries(ENDPOINT_META)
                        .filter(([key]) => selectableEndpointKeys.includes(key))
                        .map(([key, { label, desc, model }]) => {
                        const ep = dockerStatus?.endpoints?.[key];
                        return (
                          <li key={key}>
                            <strong>{label}</strong> — {desc}
                            {ep && <span style={{ marginLeft: '0.4rem', color: ep.live ? '#4caf50' : '#aaa' }}>
                              {ep.live ? '● live' : '● offline'}
                            </span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}
            </main>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
