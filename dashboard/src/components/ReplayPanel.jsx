import React from 'react';

export default function ReplayPanel({ replayData, replayStep, setReplayStep, onClose }) {
  if (!replayData) return null;
  return (
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
        <button className="btn-secondary btn-sm" onClick={onClose}>✕ Exit</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
        {replayData.steps.slice(0, replayStep + 1).map((step, i) => (
          <div key={i} style={{ marginBottom: '1rem', opacity: i < replayStep ? 0.55 : 1, transition: 'opacity 0.2s' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', marginBottom: '0.2rem' }}>
              <span style={{ fontWeight: 600, color: step.role === 'user' ? 'var(--accent)' : 'var(--green)' }}>
                {step.role === 'user' ? 'You' : 'AI'}
              </span>
              {step.timestamp && <span style={{ marginLeft: '0.5rem' }}>{new Date(step.timestamp).toLocaleTimeString()}</span>}
              {step.blocked && <span style={{ marginLeft: '0.5rem', color: 'var(--red)' }}>⛔ blocked</span>}
              {step.redacted && <span style={{ marginLeft: '0.5rem', color: 'var(--orange)' }}>✂ redacted</span>}
              {step.toolLog?.length > 0 && (
                <span style={{ marginLeft: '0.5rem', color: 'var(--text-muted)' }}>
                  🔧 {step.toolLog.length} tool call{step.toolLog.length !== 1 ? 's' : ''}
                </span>
              )}
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
        <button className="btn-secondary btn-sm" disabled={replayStep === 0} onClick={() => setReplayStep(s => Math.max(0, s - 1))}>← Prev</button>
        <button className="btn-secondary btn-sm" disabled={replayStep >= (replayData.totalSteps - 1)} onClick={() => setReplayStep(s => Math.min(replayData.totalSteps - 1, s + 1))}>Next →</button>
        <button className="btn-secondary btn-sm" onClick={() => setReplayStep(0)}>⏮ Start</button>
        <button className="btn-secondary btn-sm" onClick={() => setReplayStep(replayData.totalSteps - 1)}>End ⏭</button>
        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
          {replayData.model} · {replayData.experience}
        </span>
      </div>
    </div>
  );
}
