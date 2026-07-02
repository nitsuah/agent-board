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
      {/* ── Far-left: motor-pool logo / new-session button ── */}
      <div className="topbar-new-wrap" ref={newSessionMenuRef} style={{ marginRight: '0.25rem' }}>
        <button className="topbar-new-btn topbar-logo-btn" onClick={() => setShowNewSessionMenu(p => !p)} title="New session">
          <span className="topbar-logo-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="3"/>
              <line x1="12" y1="2" x2="12" y2="5"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
              <line x1="2" y1="12" x2="5" y2="12"/>
              <line x1="19" y1="12" x2="22" y2="12"/>
            </svg>
          </span>
          <span className="topbar-logo-label">motor-pool</span>
          <span className="topbar-logo-caret">▾</span>
        </button>
        {showNewSessionMenu && (
          <div className="topbar-new-panel">
            <div className="topbar-new-section-label">Experience</div>
            {Object.entries(EXPERIENCE_META)
              .filter(([key]) => isServiceUp(key))
              .filter(([key]) => !demoMode.enabled || key === 'safechat')
              .map(([key, exp]) => (
                <div
                  key={key}
                  className={`topbar-new-option ${selectedExperience === key ? 'selected' : ''}`}
                  onClick={() => setSelectedExperience(key)}
                >
                  {exp.icon} {exp.name}
                  {selectedExperience === key && <span className="topbar-check">✓</span>}
                </div>
              ))}
            {selectableEndpointKeys.length > 1 && (
              <>
                <div className="topbar-new-section-label">Model</div>
                {selectableEndpointKeys.map(key => (
                  <div
                    key={key}
                    className={`topbar-new-option ${currentEndpoint === key ? 'selected' : ''}`}
                    onClick={() => handleEndpointSelection(key)}
                  >
                    {allEndpointMeta[key]?.label || key}
                    {currentEndpoint === key && <span className="topbar-check">✓</span>}
                  </div>
                ))}
              </>
            )}
            <button
              className="btn-primary"
              style={{ width: '100%', marginTop: '0.5rem' }}
              onClick={() => { createSession(); setShowNewSessionMenu(false); }}
            >+ Create Session</button>
          </div>
        )}
      </div>

      <div className="topbar-divider" />

      {/* ── Layout view buttons ── */}
      <div className="topbar-tabs">
        <button className={`icon-btn ${(activeTab === 'chat' && wsLayout === 'single') ? 'active' : ''}`} onClick={() => { setActiveTab('chat'); setWsLayout('single'); }} title="Chat">💬</button>
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
