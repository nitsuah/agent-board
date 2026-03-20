import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Map endpoints to their actual model names (must match server LLM_CONFIG defaultModel)
const ENDPOINT_MODELS = {
  primary: 'llama2:latest',
  docker_runner: 'ai/qwen3-coder:latest',
  glm_flash: 'ai/glm-4.7-flash:latest',
};

function App() {
  const [sessions, setSessions] = useState([]);
  const [models, setModels] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [currentModel, setCurrentModel] = useState('llama2:latest');
  const [currentEndpoint, setCurrentEndpoint] = useState('primary');
  const [messageInput, setMessageInput] = useState('');
  const [useNemoClaw, setUseNemoClaw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dockerStatus, setDockerStatus] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [showSystemPanel, setShowSystemPanel] = useState(false);
  const chatBottomRef = useRef(null);

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
        body: JSON.stringify({ model: currentModel, endpoint: currentEndpoint })
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
      // Always refresh to get the actual server state (including AI reply or error text)
      fetchSessions();
      fetchSessionDetails(activeSession);
      if (!data.success) {
        console.error('LLM error:', data.response);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessageInput(sentMessage); // restore on network failure
      setActiveSessionMessages(prev => prev.filter(m => m !== optimisticMsg));
    } finally {
      setLoading(false);
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
                <h3>Container Status</h3>
                {dockerStatus?.containers && Object.entries(dockerStatus.containers).map(([name, status]) => (
                  <div key={name} className="docker-status-item">
                    <div className="docker-service-info">
                      <div className="docker-service-name">{name}</div>
                      <div className={`docker-service-status ${status.running ? 'running' : 'stopped'}`}>
                        {status.running ? 'Healthy' : status.status}
                      </div>
                      <div className="docker-service-port">{status.ports}</div>
                    </div>
                  </div>
                ))}
                <p style={{fontSize:'0.8rem', color:'#666', marginTop:'0.5rem'}}>
                  Use <code>stack-manager.ps1</code> on the host to start/stop services.
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
    
              {[
                { value: 'primary', label: 'Llama2', desc: 'General purpose (3.8 GB)', model: 'llama2:latest' },
                { value: 'docker_runner', label: 'Docker Runner', desc: 'Docker Desktop model runner', model: 'ai/qwen3-coder:latest' },
                { value: 'glm_flash', label: 'GLM Flash', desc: 'Fast inference (requires setup)', model: 'ai/glm-4.7-flash:latest' },
              ].map(({ value, label, desc, model }) => (
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
                    <div className="endpoint-name">{label}</div>
                    <div className="endpoint-description">{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </section>

          <section className="section">
            <h2>Sessions</h2>
            <button className="btn-primary" onClick={createSession}>
              + New Session
            </button>
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
                    </div>
                  </div>
                  <button
                    className="btn-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(session.id);
                    }}
                  >
                    ✕
                  </button>
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
                {loading && (
                  <div className="message assistant">
                    <div className="message-content" style={{opacity: 0.6, fontStyle: 'italic'}}>
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
                  <li><strong>Llama2</strong> - General purpose (running)</li>
                  <li><strong>Docker Runner</strong> - Docker Desktop model runner</li>
                  <li><strong>GLM Flash</strong> - Fast inference (requires setup)</li>
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
