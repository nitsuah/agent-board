import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [sessions, setSessions] = useState([]);
  const [models, setModels] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [currentModel, setCurrentModel] = useState('mistral');
  const [messageInput, setMessageInput] = useState('');
  const [useNemoClaw, setUseNemoClaw] = useState(false);
  const [loading, setLoading] = useState(false);

  // Fetch available models
  useEffect(() => {
    fetchModels();
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
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

  const createSession = async () => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: currentModel })
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

    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${activeSession}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageInput, useNemoClaw })
      });
      const data = await res.json();
      if (data.success) {
        setMessageInput('');
        setActiveSession(activeSession); // Force refresh
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setLoading(false);
    }
  };

  const switchModel = async (model) => {
    if (!activeSession) return;
    try {
      await fetch(`/api/sessions/${activeSession}/model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      });
      setCurrentModel(model);
    } catch (error) {
      console.error('Error switching model:', error);
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

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>🤖 Agent Dashboard</h1>
          <div className="header-info">
            <span className="badge">Local LLM: 8080</span>
            <span className="badge">NemoClaw: 8081</span>
          </div>
        </div>
      </header>

      <div className="container">
        {/* Sidebar - Models & Sessions */}
        <aside className="sidebar">
          <section className="section">
            <h2>Models</h2>
            <div className="model-selector">
              {models.map(model => (
                <button
                  key={model.name}
                  className={`model-btn ${currentModel === model.model ? 'active' : ''}`}
                  onClick={() => {
                    setCurrentModel(model.model);
                    if (activeSession) switchModel(model.model);
                  }}
                >
                  {model.model}
                  <span className="size">{model.size}</span>
                </button>
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
                      {session.model} • {session.messageCount} msgs
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

          <section className="section">
            <h2>Safety</h2>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={useNemoClaw}
                onChange={(e) => setUseNemoClaw(e.target.checked)}
              />
              <span>Use NemoClaw (Safe Mode)</span>
            </label>
            {useNemoClaw && (
              <div className="safety-notice">
                ✓ OpenShell Security enabled
              </div>
            )}
          </section>
        </aside>

        {/* Main Chat Area */}
        <main className="main">
          {activeSessionData ? (
            <>
              <div className="chat-header">
                <h2>{activeSessionData.name}</h2>
                <div className="chat-meta">
                  Model: <strong>{activeSessionData.model}</strong>
                </div>
              </div>

              <div className="chat-container">
                <div className="messages-placeholder">
                  <p>Session started • Ready to chat</p>
                </div>
              </div>

              <form className="chat-input-form" onSubmit={sendMessage}>
                <input
                  type="text"
                  placeholder="Type a message or question..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
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
              <p>Create a new session to get started</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
