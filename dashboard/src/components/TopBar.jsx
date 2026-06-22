import React from 'react';
import { EXPERIENCE_META } from '../constants/app-config.js';

export default function TopBar({
  activeTab, setActiveTab,
  wsLayout, setWsLayout,
  browseWorkspace, refreshWorkspaceGit, fetchBranches, fetchArtifacts,
  demoMode,
  showNewSessionMenu, setShowNewSessionMenu, newSessionMenuRef,
  selectedExperience, setSelectedExperience,
  allEndpointMeta, selectableEndpointKeys, currentEndpoint, handleEndpointSelection,
  sessions, activeSession, setActiveSession, fetchSessionDetails,
  wsConnected,
  showMetricsPanel, setShowMetricsPanel, showSystemPanel, setShowSystemPanel,
  dockerStatus, fetchContentClients,
  runningServices, totalServices,
  createSession,
}) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        <span className="topbar-title">🤖 Agent Board</span>
        <div className="topbar-tabs">
          <button
            className={`icon-btn ${(activeTab === 'chat' && wsLayout === 'single') ? 'active' : ''}`}
            onClick={() => { setActiveTab('chat'); setWsLayout('single'); }}
            title="Chat"
          >💬</button>
          <button
            className={`icon-btn ${(activeTab === 'workspace' && wsLayout === 'single') ? 'active' : ''}`}
            onClick={() => { setActiveTab('workspace'); setWsLayout('single'); browseWorkspace(''); refreshWorkspaceGit(); fetchBranches(); fetchArtifacts(); }}
            title="Workspace"
          >🗂️</button>
          <button
            className={`icon-btn ${wsLayout === 'split-h' ? 'active' : ''}`}
            onClick={() => { setWsLayout('split-h'); browseWorkspace(''); refreshWorkspaceGit(); fetchBranches(); }}
            title="Split view — side by side"
          >⊟</button>
          <button
            className={`icon-btn ${wsLayout === 'split-v' ? 'active' : ''}`}
            onClick={() => { setWsLayout('split-v'); browseWorkspace(''); refreshWorkspaceGit(); fetchBranches(); }}
            title="Split view — stacked"
          >⊠</button>
        </div>
        <div className="topbar-divider" />
      </div>

      <div className="topbar-center">
        {demoMode.enabled && <span className="pill pill-demo">Demo</span>}

        <div className="topbar-new-wrap" ref={newSessionMenuRef}>
          <button
            className="topbar-new-btn"
            onClick={() => setShowNewSessionMenu(p => !p)}
          >+ New ▾</button>
          {showNewSessionMenu && (
            <div className="topbar-new-panel">
              <div className="topbar-new-summary">
                {EXPERIENCE_META[selectedExperience]?.icon} {EXPERIENCE_META[selectedExperience]?.name}
                <span className="topbar-new-dot">·</span>
                {allEndpointMeta[selectableEndpointKeys.includes(currentEndpoint) ? currentEndpoint : (selectableEndpointKeys[0] || currentEndpoint)]?.label || currentEndpoint}
              </div>
              <button
                className="btn-primary"
                style={{ width: '100%', fontSize: '0.8rem', marginTop: '0.2rem' }}
                onClick={() => { createSession(); setShowNewSessionMenu(false); }}
              >
                Create Session
              </button>
            </div>
          )}
        </div>

        <select
          className="topbar-select"
          value={selectedExperience}
          onChange={e => setSelectedExperience(e.target.value)}
          disabled={demoMode.enabled}
          title="Switch experience"
        >
          {Object.entries(EXPERIENCE_META)
            .filter(([key]) => !demoMode.enabled || key === 'safechat')
            .map(([key, exp]) => (
              <option key={key} value={key}>{exp.icon} {exp.name}</option>
            ))}
        </select>

        <select
          className="topbar-select topbar-select-model"
          value={selectableEndpointKeys.includes(currentEndpoint) ? currentEndpoint : (selectableEndpointKeys[0] || '')}
          onChange={e => handleEndpointSelection(e.target.value)}
          disabled={selectableEndpointKeys.length === 0 || demoMode.enabled}
          title="Switch model"
        >
          {selectableEndpointKeys.length === 0 ? (
            <option value="">No models online</option>
          ) : selectableEndpointKeys.map(key => (
            <option key={key} value={key}>{allEndpointMeta[key]?.label || key}</option>
          ))}
        </select>

        {sessions.length > 0 && (
          <select
            className="topbar-select topbar-select-session"
            value={activeSession || ''}
            onChange={e => { if (e.target.value) { setActiveSession(e.target.value); fetchSessionDetails(e.target.value); } }}
            title="Switch session"
          >
            {!activeSession && <option value="">Select session…</option>}
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="topbar-right">
        <span className={`live-dot-wrap ${wsConnected ? 'live' : 'offline'}`} title={wsConnected ? 'Live feed connected' : 'Offline'}>
          <span className="live-dot" />
        </span>

        <button
          className={`icon-btn ${showMetricsPanel ? 'active' : ''}`}
          onClick={() => {
            setShowMetricsPanel(p => { if (!p) setShowSystemPanel(false); return !p; });
          }}
          title="Metrics"
        >📊</button>

        <button
          className={`icon-btn svc-cog-btn ${showSystemPanel ? 'active' : ''}`}
          onClick={() => {
            setShowSystemPanel(prev => {
              const next = !prev;
              if (next) {
                setShowMetricsPanel(false);
                if (dockerStatus?.workspace?.configured) {
                  browseWorkspace('');
                  refreshWorkspaceGit();
                }
                fetchContentClients();
              }
              return next;
            });
          }}
          title={`System — ${runningServices}/${totalServices} services`}
        >⚙️ <span className="svc-cog-count">{totalServices > 0 ? `${runningServices}/${totalServices}` : '…'}</span></button>
      </div>
    </div>
  );
}
