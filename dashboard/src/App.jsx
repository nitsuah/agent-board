import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Map endpoints to their actual model names and metadata
const ENDPOINT_META = {
  primary:       { model: 'llama2:latest',          label: 'Llama2',           desc: 'Ollama container · 3.8 GB',      backendBadge: 'Ollama' },
  docker_runner: { model: 'ai/qwen3-coder:latest',  label: 'Qwen3-Coder',      desc: 'Docker Model Runner · 16.45 GB', backendBadge: 'Docker Runner' },
  glm_flash:     { model: 'ai/glm-4.7-flash:latest',label: 'GLM-4.7-Flash',    desc: 'Docker Model Runner · 16.31 GB', backendBadge: 'Docker Runner' },
};

/**
 * AgentStatusCard — compact card showing a single session's live status.
 */
function AgentStatusCard({ session, isActive, isStreaming, onClick, onDelete }) {
  const ago = (date) => {
    const secs = Math.floor((Date.now() - new Date(date)) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
  };

  const statusLabel = isStreaming ? 'streaming' : session.messageCount > 0 ? 'idle' : 'new';
  const statusClass = isStreaming ? 'streaming' : session.messageCount > 0 ? 'idle' : 'new';

  return (
    <div
      className={`agent-card ${isActive ? 'active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className="agent-card-header">
        <span className={`agent-status-dot ${statusClass}`} title={statusLabel} />
        <span className="agent-card-name">{session.name}</span>
        <button
          className="btn-delete"
          title="Delete session"
          onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
        >✕</button>
      </div>
      <div className="agent-card-meta">
        <span className="agent-card-endpoint">{ENDPOINT_META[session.endpoint]?.label || session.endpoint}</span>
        <span className="agent-card-msgs">{session.messageCount} msg{session.messageCount !== 1 ? 's' : ''}</span>
        <span className="agent-card-time">{ago(session.updatedAt || session.createdAt)}</span>
      </div>
      {isStreaming && (
        <div className="agent-card-streaming">
          <span className="streaming-indicator">⟳ receiving response…</span>
        </div>
      )}
    </div>
  );
}


function App() {
  const [sessions, setSessions] = useState([]);
  const [models, setModels] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [currentModel, setCurrentModel] = useState('llama2:latest');
  const [currentEndpoint, setCurrentEndpoint] = useState('primary');
  const [messageInput, setMessageInput] = useState('');
  const [useNemoClaw, setUseNemoClaw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [dockerStatus, setDockerStatus] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [showSystemPanel, setShowSystemPanel] = useState(false);
  const chatBottomRef = useRef(null);
  const activeStreamRef = useRef(null);

  // Fetch data on mount
  useEffect(() => {
    fetchModels();
    fetchSessions();
    fetchDockerStatus();
    fetchSystemInfo();

    // Set up intervals
    const sessionInterval = setInterval(fetchSessions, 5000);
    const dockerInterval = setInterval(fetchDockerStatus, 10000);

    return () => {
      clearInterval(sessionInterval);
      clearInterval(dockerInterval);
    };
  }, []);

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      if (data.success) {
        setModels(data.models);
      }
    } catch (error) {
      console.error('Error fetching models:', error);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.success) {
        setSessions(data.sessions);
      }
    } catch (error) {
      console.error('Error fetching sessions:', error);
    }
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
      if (data.success) {
        setSystemInfo(data.system);
      }
    } catch (error) {
      console.error('Error fetching system info:', error);
    }
  };

  const createSession = async () => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: currentModel || ENDPOINT_META[currentEndpoint]?.model, endpoint: currentEndpoint })
      });
      const data = await res.json();
      if (data.success) {
        setActiveSession(data.session.id);
        fetchSessions();
      }
    } catch (error) {
      console.error('Error creating session:', error);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!activeSession || !messageInput.trim()) return;

    // Cancel any active stream
    if (activeStreamRef.current) {
      activeStreamRef.current.abort();
      activeStreamRef.current = null;
    }

    const optimisticMsg = { role: 'user', content: messageInput.trim(), timestamp: new Date() };
    setActiveSessionMessages(prev => [...prev, optimisticMsg]);
    const sentMessage = messageInput;
    setMessageInput('');
    setLoading(true);
    setStreamingContent('');

    const controller = new AbortController();
    activeStreamRef.current = controller;

    try {
      const res = await fetch(`/api/sessions/${activeSession}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: sentMessage, useSafeMode: useNemoClaw }),
        signal: controller.signal
      });

      if (!res.ok || !res.body) {
        throw new Error(`Stream request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const event = JSON.parse(json);
            if (event.type === 'token') {
              accumulated += event.content;
              setStreamingContent(accumulated);
            } else if (event.type === 'done') {
              setStreamingContent('');
              fetchSessions();
              fetchSessionDetails(activeSession);
            } else if (event.type === 'error') {
              console.error('LLM stream error:', event.message);
              setStreamingContent('');
              fetchSessions();
              fetchSessionDetails(activeSession);
            }
          } catch {
            // skip malformed SSE line
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Error sending message via stream, falling back:', error);
        // Fallback to non-streaming endpoint
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
        } catch (fbErr) {
          console.error('Fallback also failed:', fbErr);
          setMessageInput(sentMessage);
          setActiveSessionMessages(prev => prev.filter(m => m !== optimisticMsg));
        }
      }
    } finally {
      activeStreamRef.current = null;
      setLoading(false);
      setStreamingContent('');
    }
  };

  const switchEndpoint = async (endpoint) => {
    if (!activeSession) return;
    try {
      await fetch(`/api/sessions/${activeSession}/model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, model: currentModel })
      });
      setCurrentEndpoint(endpoint);
    } catch (error) {
      console.error('Error switching endpoint:', error);
    }
  };

  const deleteSession = async (id) => {
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (activeSession === id) setActiveSession(null);
      fetchSessions();
    } catch (error) {
      console.error('Error deleting session:', error);
    }
  };

  const activeSessionData = activeSession
    ? sessions.find(s => s.id === activeSession)
    : null;

  const getDockerStatusColor = () => {
    if (!dockerStatus) return 'gray';
    const runningCount = Object.values(dockerStatus.containers || {}).filter(c => c.running).length;
    if (runningCount >= 2) return 'green';
    if (runningCount >= 1) return 'yellow';
    return 'red';
  };
  // Fetch a single session's full details (including messages)
  const [activeSessionMessages, setActiveSessionMessages] = useState([]);

  const fetchSessionDetails = async (id) => {
    try {
      const res = await fetch(`/api/sessions/${id}`);
      const data = await res.json();
      if (data.success && data.session) {
        setActiveSessionMessages(data.session.messages || []);
        // update session list entry (message count etc.) without clobbering messages
        setSessions(prev => prev.map(s => s.id === id
          ? { ...s, messageCount: (data.session.messages || []).length, endpoint: data.session.endpoint, model: data.session.model }
          : s
        ));
      }
    } catch (error) {
      console.error('Error fetching session details:', error);
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSessionMessages]);

  // When active session changes, load its full details (messages)
  useEffect(() => {
    setActiveSessionMessages([]);
    if (activeSession) fetchSessionDetails(activeSession);
  }, [activeSession]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>🤖 Agent Board</h1>
          <div className="header-info">
            <span className={`badge docker-status ${getDockerStatusColor()}`}>
              {(() => {
                const running = Object.values(dockerStatus?.containers || {}).filter(c => c.running).length;
                const total = Object.keys(dockerStatus?.containers || {}).length;
                return total > 0 ? `Services: ${running}/${total}` : 'Services: ...';
              })()}
            </span>
            <button
              className="btn-system"
              onClick={() => setShowSystemPanel(!showSystemPanel)}
            >
              ⚙️ System
            </button>
          </div>
        </div>
      </header>

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
                <p style={{fontSize:'0.8rem', color:'#666', marginTop:'0.5rem'}}>
                  Docker Runner models: <code>docker model pull ai/glm-4.7-flash:latest</code><br/>
                  Manage stack: <code>stack-manager.ps1</code>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Sidebar - Models & Sessions */}
        <aside className="sidebar">
          <section className="section">
            <h2>LLM Endpoints</h2>
            <div className="endpoint-selector">
    
              {Object.entries(ENDPOINT_META).map(([value, { model, label, desc, backendBadge }]) => {
                const epStatus = dockerStatus?.endpoints?.[value];
                const isLive = epStatus?.live ?? null;
                return (
                  <label key={value} className="endpoint-option">
                    <input
                      type="radio"
                      name="endpoint"
                      value={value}
                      checked={currentEndpoint === value}
                      onChange={() => {
                        setCurrentEndpoint(value);
                        setCurrentModel(model);
                        switchEndpoint(value);
                      }}
                    />
                    <div className="endpoint-info">
                      <div className="endpoint-name">
                        {label}
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', opacity: 0.6 }}>({backendBadge})</span>
                        {isLive === true && <span style={{ marginLeft: '0.4rem', color: '#4caf50' }}>●</span>}
                        {isLive === false && <span style={{ marginLeft: '0.4rem', color: '#f44336' }}>●</span>}
                      </div>
                      <div className="endpoint-description">{desc}</div>
                      <div style={{ fontSize: '0.7rem', opacity: 0.55 }}>{model}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="section">
            <h2>Sessions</h2>
            <button className="btn-primary" onClick={createSession}>
              + New Session
            </button>
            <div className="sessions-list">
              {sessions.map(session => {
                const isActive = activeSession === session.id;
                return (
                  <AgentStatusCard
                    key={session.id}
                    session={session}
                    isActive={isActive}
                    isStreaming={isActive && loading}
                    onClick={() => setActiveSession(session.id)}
                    onDelete={deleteSession}
                  />
                );
              })}
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
                  {loading && <span className="streaming-badge"> ⟳ streaming</span>}
                </div>
              </div>

              <div className="chat-container">
                {activeSessionMessages.length > 0 ? (
                  activeSessionMessages.map((msg, index) => (
                    <div key={index} className={`message ${msg.role}`}>
                      <div className="message-content">
                        <strong>{msg.role === 'user' ? 'You' : 'AI'}:</strong> {msg.content}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="messages-placeholder">
                    <p>No messages yet. Start a conversation!</p>
                  </div>
                )}
                {loading && streamingContent && (
                  <div className="message assistant streaming">
                    <div className="message-content">
                      <strong>AI:</strong> {streamingContent}<span className="cursor-blink">▍</span>
                    </div>
                  </div>
                )}
                {loading && !streamingContent && (
                  <div className="message assistant">
                    <div className="message-content" style={{opacity: 0.6, fontStyle: 'italic'}}>
                      <strong>AI:</strong> Thinking<span className="dot-pulse">...</span>
                    </div>
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>

              <form className="chat-input-form" onSubmit={sendMessage}>
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="Type your message..."
                  disabled={loading}
                />
                <button type="submit" disabled={loading} className="btn-send">
                  {loading ? 'Sending...' : 'Send'}
                </button>
              </form>
            </>
          ) : (
            <div className="empty-state">
              <h2>No session selected</h2>
              <p>Create a new session to get started with multi-model AI</p>
              <div className="endpoint-preview">
                <h3>Available Endpoints:</h3>
                <ul>
                  {Object.entries(ENDPOINT_META).map(([key, { label, desc, model }]) => {
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
      </div>
    </div>
  );
}

export default App;
