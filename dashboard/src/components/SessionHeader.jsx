import React, { useState, useRef, useEffect } from 'react';
import { toast } from './Toast.jsx';

export default function SessionHeader({
  activeSession, activeSessionData, activeSessionMessages,
  loading, queueLengths, pausedSessions,
  renameSession, deleteSession, togglePause,
  forceSend, stopSession, fetchSessionDetails,
  selectableEndpointKeys, currentEndpoint, allEndpointMeta,
  handleEndpointSelection, demoMode, SAFETY_COLORS, EXPERIENCE_META,
  selectedExperience,
  nineRouterCombos, nineRouterCombo, setNineRouterCombo, is9Router,
  onStartReplay, replayBusy,
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (editingName && nameInputRef.current) nameInputRef.current.select();
  }, [editingName]);

  return (
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
        <select
          className="chat-model-select chat-model-select--header"
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

        {is9Router && (
          <select
            className="chat-model-select chat-model-select--header"
            value={nineRouterCombo}
            onChange={e => setNineRouterCombo(e.target.value)}
            title="9router combo (model group)"
            style={{ maxWidth: '110px' }}
          >
            {(nineRouterCombos.length > 0 ? nineRouterCombos : ['MAX']).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}

        {activeSessionData && EXPERIENCE_META && !demoMode.enabled && (
          <select
            className="chat-model-select chat-model-select--header"
            value={activeSessionData.experience || selectedExperience}
            onChange={async e => {
              const exp = e.target.value;
              try {
                await fetch(`/api/sessions/${activeSession}/experience`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ experience: exp }),
                });
                if (typeof fetchSessionDetails === 'function') fetchSessionDetails(activeSession);
              } catch { /* ignore */ }
            }}
            title="Switch experience for this session"
            style={{ maxWidth: '120px' }}
          >
            {Object.entries(EXPERIENCE_META).map(([key, exp]) => (
              <option key={key} value={key}>{exp.icon} {exp.name}</option>
            ))}
          </select>
        )}

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
            onClick={onStartReplay}
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
  );
}
