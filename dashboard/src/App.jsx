import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Map endpoints to their actual model names (must match server LLM_CONFIG defaultModel)
const ENDPOINT_MODELS = {
  primary: 'llama2:latest',
  qwen_coder: 'qwen3-coder:latest',
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

  const dockerAction = async (action, setup = 'primary') => {
    try {
      const res = await fetch(`/api/docker/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup })
      });
      const data = await res.json();
      if (data.success) {
        setTimeout(fetchDockerStatus, 2000); // Refresh status after action
      }
      return data;
    } catch (error) {
      console.error(`Error ${action}ing Docker:`, error);
      return { success: false, error: error.message };
    }
  };

  const activeSessionData = activeSession
    ? sessions.find(s => s.id === activeSession)
    : null;

  const getDockerStatusColor = () => {
    if (!dockerStatus) return 'gray';
    if (!dockerStatus.dockerRunning) return 'red';
    const runningContainers = Object.values(dockerStatus.containers || {}).filter(c => c.running).length;
    if (runningContainers >= 4) return 'green';
    if (runningContainers >= 2) return 'yellow';
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
              Docker: {dockerStatus?.dockerRunning ? 'Running' : 'Stopped'}
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
                  <h3>Docker Status</h3>
                  <div className={`value ${dockerStatus?.dockerRunning ? '' : 'error'}`}>
                    {dockerStatus?.dockerRunning ? 'Running' : 'Stopped'}
                  </div>
                </div>
                <div className="system-info-item">
                  <h3>Active Containers</h3>
                  <div className="value">
                    {dockerStatus?.containers ? Object.values(dockerStatus.containers).filter(c => c.running).length : 0}/5
                  </div>
                </div>
                <div className="system-info-item">
                  <h3>Memory Usage</h3>
                  <div className="value">{systemInfo?.memory || 'N/A'}</div>
                </div>
                <div className="system-info-item">
                  <h3>CPU Usage</h3>
                  <div className="value">{systemInfo?.cpu || 'N/A'}</div>
                </div>
              </div>

              <div className="docker-status">
                <h3>Container Status</h3>
                {dockerStatus?.containers && Object.entries(dockerStatus.containers).map(([name, status]) => (
                  <div key={name} className="docker-status-item">
                    <div className="docker-service-info">
                      <div className="docker-service-name">{name}</div>
                      <div className={`docker-service-status ${status.running ? 'running' : 'stopped'}`}>
                        {status.running ? 'Running' : 'Stopped'}
                      </div>
                      <div className="docker-service-port">{status.ports}</div>
                    </div>
                    <div className="docker-actions">
                      <button
                        className="btn-docker-action start"
                        onClick={() => dockerAction('start', name)}
                        disabled={status.running}
                      >
                        Start
                      </button>
                      <button
                        className="btn-docker-action stop"
                        onClick={() => dockerAction('stop', name)}
                        disabled={!status.running}
                      >
                        Stop
                      </button>
                      <button
                        className="btn-docker-action restart"
                        onClick={() => dockerAction('restart', name)}
                      >
                        Restart
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="system-actions">
                <button
                  className="btn-system-action primary"
                  onClick={() => dockerAction('start', 'primary')}
                >
                  Start All Services
                </button>
                <button
                  className="btn-system-action danger"
                  onClick={() => dockerAction('stop', 'all')}
                >
                  Stop All Services
                </button>
                <button
                  className="btn-system-action"
                  onClick={() => dockerAction('restart', 'all')}
                >
                  Restart All Services
                </button>
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
                { value: 'primary', label: 'Llama2', desc: 'Small local model (3.8 GB)', model: 'llama2:latest' },
                { value: 'qwen_coder', label: 'Qwen3-Coder', desc: 'Large coding model (18 GB)', model: 'qwen3-coder:latest' },
                { value: 'docker_runner', label: 'Docker Runner', desc: 'Docker Desktop model runner', model: 'ai/qwen3-coder:latest' },
                { value: 'glm_flash', label: 'GLM Flash', desc: 'Fast inference model', model: 'glm-4-flash:latest' },
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
                  <li><strong>Qwen Coder</strong> - Code generation (32B)</li>
                  <li><strong>GLM Flash</strong> - Fast inference (4B)</li>
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
