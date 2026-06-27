import React, { useRef, useEffect, useState } from 'react';
import MessageList from './MessageList.jsx';
import ToolWorkbench from './ToolWorkbench.jsx';

function useAutoResize(value) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);
  return ref;
}

export default function ChatColumn({
  renameSession,
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
  fetchSessionDetails,
  forceSend,
  stopSession,
  forkSession,
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
  sessions,
  setActiveSession,
}) {
  const textareaRef = useAutoResize(messageInput);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const nameInputRef = useRef(null);
  const [replayMode, setReplayMode] = useState(false);
  const [replayData, setReplayData] = useState(null);
  const [replayStep, setReplayStep] = useState(0);
  const [replayBusy, setReplayBusy] = useState(false);

  useEffect(() => {
    if (editingName && nameInputRef.current) nameInputRef.current.select();
  }, [editingName]);

  return (
    <div className="chat-column">
      {activeSessionData ? (
        <>
          <div className="chat-header">
            {editingName ? (
              <input
                ref={nameInputRef}
                className="chat-name-edit"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onBlur={() => { renameSession(activeSession, nameInput); setEditingName(false); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameSession(activeSession, nameInput); setEditingName(false); }
                  if (e.key === 'Escape') setEditingName(false);
                }}
                maxLength={80}
              />
            ) : (
              <h2
                title="Click to rename"
                style={{ cursor: 'pointer' }}
                onClick={() => { setNameInput(activeSessionData.name); setEditingName(true); }}
              >{activeSessionData.name}</h2>
            )}
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
                title="Export conversation as Markdown"
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = `/api/sessions/${activeSession}/export`;
                  a.download = '';
                  a.click();
                }}
              >⬇ Export</button>
              {activeSessionMessages.length > 0 && (
                <button
                  className="btn-secondary btn-sm"
                  title="Step through conversation replay"
                  disabled={replayBusy}
                  onClick={async () => {
                    setReplayBusy(true);
                    try {
                      const res = await fetch(`/api/sessions/${activeSession}/replay`);
                      const data = await res.json();
                      if (data.success) {
                        setReplayData(data.replay);
                        setReplayStep(0);
                        setReplayMode(true);
                      }
                    } catch { /* ignore */ }
                    finally { setReplayBusy(false); }
                  }}
                >{replayBusy ? '…' : '▶ Replay'}</button>
              )}
              {activeSessionMessages.length > 0 && (
                <button
                  className="btn-secondary btn-sm"
                  title="Clear all messages in this session"
                  onClick={async () => {
                    if (!confirm('Clear all messages in this session?')) return;
                    const res = await fetch(`/api/sessions/${activeSession}/messages`, { method: 'DELETE' });
                    const data = await res.json().catch(() => ({}));
                    if (data.success && typeof data.cleared === 'number') {
                      if (typeof fetchSessionDetails === 'function') fetchSessionDetails(activeSession);
                    }
                  }}
                >⌫ Clear</button>
              )}
              <button
                className="btn-secondary btn-sm"
                title="Restart session — clears messages and resets error state"
                onClick={async () => {
                  if (!confirm('Restart this session? All messages will be cleared.')) return;
                  await fetch(`/api/sessions/${activeSession}/restart`, { method: 'POST' });
                  if (typeof fetchSessionDetails === 'function') fetchSessionDetails(activeSession);
                }}
              >↺ Restart</button>
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
            onFork={forkSession ? (msgIdx) => forkSession(activeSession, msgIdx) : undefined}
            chatBottomRef={chatBottomRef}
          />

          <form className="chat-input-form" onSubmit={sendMessage}>
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              rows={1}
              value={messageInput}
              onChange={e => setMessageInput(e.target.value)}
              onKeyDown={handleMessageInputKeyDown}
              placeholder={loading ? 'Type to queue next message…' : 'Type your message… (Enter or Ctrl+Enter to send, Shift+Enter for newline)'}
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

          {sessions && sessions.length > 0 && (
            <div className="empty-state-recent">
              <div className="empty-state-recent-label">Recent sessions</div>
              <div className="empty-state-recent-list">
                {sessions.slice(0, 6).map(s => (
                  <div
                    key={s.id}
                    className="empty-state-recent-item"
                    onClick={() => setActiveSession(s.id)}
                  >
                    <span className="empty-state-recent-icon">
                      {EXPERIENCE_META[s.experience]?.icon || '💬'}
                    </span>
                    <span className="empty-state-recent-name">{s.name}</span>
                    <span className="empty-state-recent-meta">
                      {s.messageCount != null ? `${s.messageCount} msgs` : ''}
                      {s.updatedAt ? ` · ${new Date(s.updatedAt).toLocaleDateString()}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {replayMode && replayData && (
        <div style={{
          position: 'absolute', inset: 0, background: 'var(--surface)', zIndex: 100,
          display: 'flex', flexDirection: 'column', borderLeft: '2px solid var(--accent)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1rem', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>▶ Replay</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{replayData.name}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginLeft: 'auto' }}>
              Step {replayStep + 1} / {replayData.totalSteps || '—'}
            </span>
            <button className="btn-secondary btn-sm" onClick={() => { setReplayMode(false); setReplayData(null); }}>✕ Exit</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
            {replayData.steps.slice(0, replayStep + 1).map((step, i) => (
              <div key={i} style={{
                marginBottom: '1rem',
                opacity: i < replayStep ? 0.55 : 1,
                transition: 'opacity 0.2s',
              }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: 600, color: step.role === 'user' ? 'var(--accent)' : 'var(--green)' }}>
                    {step.role === 'user' ? 'You' : 'AI'}
                  </span>
                  {step.timestamp && <span style={{ marginLeft: '0.5rem' }}>{new Date(step.timestamp).toLocaleTimeString()}</span>}
                  {step.blocked && <span style={{ marginLeft: '0.5rem', color: 'var(--red)' }}>⛔ blocked</span>}
                  {step.redacted && <span style={{ marginLeft: '0.5rem', color: 'var(--orange)' }}>✂ redacted</span>}
                  {step.toolLog?.length > 0 && <span style={{ marginLeft: '0.5rem', color: 'var(--text-muted)' }}>🔧 {step.toolLog.length} tool call{step.toolLog.length !== 1 ? 's' : ''}</span>}
                  {step.feedback && <span style={{ marginLeft: '0.5rem', color: 'var(--accent)' }}>👍 {step.feedback}</span>}
                </div>
                <div style={{
                  background: step.role === 'user' ? 'var(--surface-3)' : 'var(--surface-2)',
                  borderRadius: '0.4rem', padding: '0.5rem 0.75rem',
                  fontSize: '0.82rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  border: i === replayStep ? '1px solid var(--accent)' : '1px solid transparent',
                }}>
                  {step.content}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', padding: '0.6rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', alignItems: 'center' }}>
            <button
              className="btn-secondary btn-sm"
              disabled={replayStep === 0}
              onClick={() => setReplayStep(s => Math.max(0, s - 1))}
            >← Prev</button>
            <button
              className="btn-secondary btn-sm"
              disabled={replayStep >= (replayData.totalSteps - 1)}
              onClick={() => setReplayStep(s => Math.min(replayData.totalSteps - 1, s + 1))}
            >Next →</button>
            <button
              className="btn-secondary btn-sm"
              onClick={() => setReplayStep(0)}
            >⏮ Start</button>
            <button
              className="btn-secondary btn-sm"
              onClick={() => setReplayStep(replayData.totalSteps - 1)}
            >End ⏭</button>
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
              {replayData.model} · {replayData.experience}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
