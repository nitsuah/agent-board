import React from 'react';

function AgentStatusCard({ session, isActive, isStreaming, queueCount, isPaused, onClick, onDelete, onStop, endpointLabel }) {
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
        {isStreaming && onStop && (
          <button
            className="btn-stop"
            title="Stop responding"
            onClick={(e) => { e.stopPropagation(); onStop(session.id); }}
          >■</button>
        )}
        <button
          className="btn-delete"
          title="Delete session"
          onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
        >✕</button>
      </div>
      <div className="agent-card-meta">
        <span className="agent-card-endpoint">{endpointLabel || session.endpoint}</span>
        <span className="agent-card-msgs">{session.messageCount}m</span>
        {queueCount > 0 && <span className="agent-card-queue">{queueCount}q</span>}
        {isPaused && <span className="agent-card-paused">⏸</span>}
        {isStreaming && <span style={{ color: 'var(--accent)' }}>⟳</span>}
      </div>
    </div>
  );
}

export default AgentStatusCard;
