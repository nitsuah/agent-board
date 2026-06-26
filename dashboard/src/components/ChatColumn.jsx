import React from 'react';
import MessageList from './MessageList.jsx';
import ToolWorkbench from './ToolWorkbench.jsx';

export default function ChatColumn({
  activeSessionData,
  activeSessionMessages,
  activeSession,
  loading,
  streamingContent,
  queueLengths,
  pausedSessions,
  messageInput,
  setMessageInput,
  sendMessage,
  handleMessageInputKeyDown,
  sendFeedback,
  togglePause,
  deleteSession,
  forceSend,
  stopSession,
  handleEndpointSelection,
  selectableEndpointKeys,
  currentEndpoint,
  allEndpointMeta,
  useNemoClaw,
  setUseNemoClaw,
  demoMode,
  chatBottomRef,
  serviceActionsInFlight,
  runServiceAction,
  EXPERIENCE_TOOLS,
  SAFETY_COLORS,
  EXPERIENCE_META,
  selectedExperience,
  setSelectedExperience,
  createSession,
  dockerStatus,
}) {
  return (
    <div className="chat-column">
      {activeSessionData ? (
        <>
          <div className="chat-header">
            <h2>{activeSessionData.name}</h2>
            <div className="chat-meta">
              {activeSessionData.endpoint} • {activeSessionData.messageCount} messages
              {loading && <span className="streaming-badge"> ⟳ streaming</span>}
              {queueLengths[activeSession] > 0 && (
                <span className="queue-badge">{queueLengths[activeSession]} queued</span>
              )}
              {activeSessionData.safetyMode && (
                <span style={{ marginLeft: '0.5rem', color: SAFETY_COLORS[activeSessionData.safetyMode], fontWeight: 600, fontSize: '0.75rem' }}>
                  🛡 {activeSessionData.safetyMode}
                </span>
              )}
            </div>
            <div className="chat-header-actions">
              <button
                className={`btn-secondary btn-sm ${pausedSessions.has(activeSession) ? 'active' : ''}`}
                title={pausedSessions.has(activeSession) ? 'Responses paused — click to resume' : 'Pause auto-response'}
                onClick={() => togglePause(activeSession)}
              >{pausedSessions.has(activeSession) ? '▶ Resume' : '⏸ Pause'}</button>
              <button
                className="btn-secondary btn-sm"
                title="Delete session"
                onClick={() => deleteSession(activeSession)}
              >✕ Delete</button>
            </div>
          </div>

          {EXPERIENCE_TOOLS[activeSessionData.experience] && (
            <ToolWorkbench
              toolKey={EXPERIENCE_TOOLS[activeSessionData.experience].toolKey}
              serviceKey={EXPERIENCE_TOOLS[activeSessionData.experience].serviceKey}
              onRunService={runServiceAction}
              serviceActionsInFlight={serviceActionsInFlight}
            />
          )}

          <MessageList
            messages={activeSessionMessages}
            loading={loading}
            streamingContent={streamingContent}
            onFeedback={sendFeedback}
            chatBottomRef={chatBottomRef}
          />

          <form className="chat-input-form" onSubmit={sendMessage}>
            <input
              type="text"
              value={messageInput}
              onChange={e => setMessageInput(e.target.value)}
              onKeyDown={handleMessageInputKeyDown}
              placeholder={loading ? 'Type to queue next message…' : 'Type your message… (Enter or Ctrl+Enter to send)'}
              maxLength={4000}
            />
            <span className="input-counter" style={messageInput.length > 3200 ? { color: messageInput.length > 3800 ? 'var(--red)' : 'var(--yellow, orange)' } : undefined}>
              {messageInput.length}/4000
            </span>
            <select
              className="select-inline"
              value={selectableEndpointKeys.includes(currentEndpoint) ? currentEndpoint : (selectableEndpointKeys[0] || '')}
              onChange={e => handleEndpointSelection(e.target.value)}
              title="Choose model endpoint"
              disabled={selectableEndpointKeys.length === 0 || demoMode.enabled}
            >
              {selectableEndpointKeys.length === 0 ? (
                <option value="">No models online</option>
              ) : (
                selectableEndpointKeys.map((key) => (
                  <option key={key} value={key}>{allEndpointMeta[key]?.label || key}</option>
                ))
              )}
            </select>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={useNemoClaw}
                onChange={e => setUseNemoClaw(e.target.checked)}
              />
              NemoClaw
            </label>
            {loading && queueLengths[activeSession] > 0 && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                title="Stop current response and send next queued message immediately"
                onClick={() => forceSend(activeSession)}
              >⚡ Force ({queueLengths[activeSession]})</button>
            )}
            {loading && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                title="Stop responding"
                onClick={() => stopSession(activeSession)}
              >■ Stop</button>
            )}
            <button type="submit" className="btn-send">
              {loading ? '+ Queue' : 'Send'}
            </button>
          </form>
        </>
      ) : (
        <div className="empty-state">
          <h2>No session selected</h2>
          <p>Choose an experience and create a session to get started.</p>

          <div className="experience-options">
            {Object.entries(EXPERIENCE_META)
              .filter(([key]) => !demoMode.enabled || key === 'safechat')
              .map(([key, exp]) => (
              <div
                key={key}
                className={`experience-option ${selectedExperience === key ? 'selected' : ''}`}
                onClick={() => setSelectedExperience(key)}
              >
                <span className="exp-icon">{exp.icon}</span>
                <div>
                  <div className="exp-name">{exp.name}</div>
                  <div className="exp-desc">{exp.description}</div>
                </div>
                {selectedExperience === key && <span className="exp-check">✓</span>}
              </div>
            ))}
          </div>

          <button className="btn-primary" onClick={createSession} style={{ marginBottom: '1.5rem' }}>
            + Start a {EXPERIENCE_META[selectedExperience]?.name} Session
          </button>

          <div className="endpoint-preview">
            <h3>Available Endpoints:</h3>
            <ul>
              {Object.entries(allEndpointMeta)
                .filter(([key]) => selectableEndpointKeys.includes(key))
                .map(([key, { label, desc }]) => {
                const ep = dockerStatus?.endpoints?.[key];
                return (
                  <li key={key}>
                    <strong>{label}</strong> — {desc}
                    {ep && <span style={{ marginLeft: '0.4rem', color: ep.live ? 'var(--green)' : 'var(--text-faint)' }}>
                      {ep.live ? '● live' : '● offline'}
                    </span>}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
