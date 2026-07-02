import React, { useState } from 'react';
import { EXPERIENCE_META } from '../constants/app-config.js';

export default function TopBar({
  activeTab, setActiveTab,
  wsLayout, setWsLayout,
  browseWorkspace, refreshWorkspaceGit, fetchBranches, fetchArtifacts,
  demoMode,
  showNewSessionMenu, setShowNewSessionMenu, newSessionMenuRef,
  selectedExperience, setSelectedExperience,
  allEndpointMeta, selectableEndpointKeys, currentEndpoint, handleEndpointSelection,
  sessions, activeSession, setActiveSession, fetchSessionDetails, deleteSession,
  wsConnected,
  createSession,
  systemServices,
}) {
  const [sessionSearch, setSessionSearch] = useState('');
  const filteredSessions = sessionSearch.trim()
    ? sessions.filter(s => s.name.toLowerCase().includes(sessionSearch.toLowerCase()))
    : sessions;

  const isServiceUp = (key) => {
    if (key === 'content_gen') return systemServices?.services?.tool_content_gen?.status === 'up';
    if (key === 'website') return systemServices?.services?.tool_website?.status === 'up';
    return true;
  };

  return (
    <div className="topbar">
      {/* ── Far-left: motor icon → hub ── */}
      <button
        className="topbar-motor-btn"
        title="Go to hub"
        onClick={() => { setActiveTab('chat'); setWsLayout('single'); }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 0, marginRight: '0.1rem' }}
      >
        {/* Gear/motor icon */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>

      <div className="topbar-divider" />

      {/* ── Layout view buttons — Chat first ── */}
      <div className="topbar-tabs">
        <button className={`icon-btn ${(activeTab === 'chat' && wsLayout === 'single') ? 'active' : ''}`} onClick={() => { setActiveTab('chat'); setWsLayout('single'); }} title="Chat">
          <span style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.02em' }}>Chat</span>
        </button>
        <button className={`icon-btn ${(activeTab === 'workspace' && wsLayout === 'single') ? 'active' : ''}`} onClick={() => { setActiveTab('workspace'); setWsLayout('single'); browseWorkspace(''); refreshWorkspaceGit(); fetchBranches(); fetchArtifacts(); }} title="Workspace">🗂️</button>
        <button className={`icon-btn ${wsLayout === 'split-h' ? 'active' : ''}`} onClick={() => { setWsLayout('split-h'); browseWorkspace(''); refreshWorkspaceGit(); fetchBranches(); }} title="Split — side by side">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="2" width="6" height="12" rx="1"/><rect x="9" y="2" width="6" height="12" rx="1"/></svg>
        </button>
        <button className={`icon-btn ${wsLayout === 'split-v' ? 'active' : ''}`} onClick={() => { setWsLayout('split-v'); browseWorkspace(''); refreshWorkspaceGit(); fetchBranches(); }} title="Split — stacked">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="14" height="6" rx="1"/><rect x="1" y="9" width="14" height="6" rx="1"/></svg>
        </button>
      </div>

      <div className="topbar-divider" />

      {/* ── Session tabs inline ── */}
      <div className="topbar-session-tabs">
        {demoMode.enabled && <span className="pill pill-demo">Demo</span>}
        {sessions.length > 4 && (
          <input
            className="session-search-input"
            type="search"
            placeholder="Filter…"
            value={sessionSearch}
            onChange={e => setSessionSearch(e.target.value)}
            title="Filter sessions by name"
          />
        )}
        {filteredSessions.map(s => (
          <div
            key={s.id}
            className={`session-tab ${activeSession === s.id ? 'active' : ''}`}
            title={`${s.experience || 'session'} · ${s.messageCount} msg${s.messageCount !== 1 ? 's' : ''} · ${s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}`}
            onClick={() => {
              setActiveSession(s.id);
              fetchSessionDetails(s.id);
              // If already in workspace view, switch to split so chat is visible
              if (activeTab === 'workspace') {
                setWsLayout('split-h');
                setActiveTab('chat');
              } else {
                setActiveTab('chat');
                setWsLayout('single');
              }
            }}
          >
            <span className="session-tab-icon">{EXPERIENCE_META[s.experience]?.icon || '💬'}</span>
            <span className="session-tab-name">{s.name}</span>
            <button className="session-tab-close" onClick={e => { e.stopPropagation(); deleteSession(s.id); }} title="Close tab">×</button>
          </div>
        ))}
      </div>

    </div>
  );
}
