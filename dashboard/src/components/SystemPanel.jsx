import React from 'react';

const BACKEND_TYPE_LABEL = {
  'ollama-container': 'local', sandbox: 'sandbox', mcp: 'mcp',
  'docker-runner': 'runner', 'openllm-container': 'custom',
};
const SVC_ORDER = ['ollama', 'tool_content_gen', 'tool_website', 'docker-runner', 'nemoclaw', 'llm_openllm', 'bb_mcp'];

function SystemPanel({
  dockerStatus, systemServices, modelPulls, systemInfo,
  darkMode, onToggleTheme, onClose,
  serviceActionsInFlight, serviceActionErrors, servicesStarting,
  onRunServiceAction, onPullModel,
  runningServices, totalServices, knownModels,
  showMetricsPanel, onToggleMetrics,
}) {
  const [expandedSvcs, setExpandedSvcs] = React.useState({});

  const renderServiceRow = (serviceKey, info, endpointData = null) => {
    const canControl = !!(systemServices?.dockerControlEnabled && info.controllable);
    const eps = endpointData || [];
    const typeLabel = BACKEND_TYPE_LABEL[info.backendType] || '';
    const isDisabled = !!info.disabledReason;
    const isStarting = !info.running && !!servicesStarting?.[serviceKey];
    const anyModelUnready = info.running && eps.some(({ ep }) => ep.backendType === 'ollama-container' && !ep.modelInstalled);

    const epErrors = eps
      .map(({ epKey, ep }) => serviceActionErrors[`pull:${epKey}:${ep.model}`])
      .filter(Boolean);
    const allErrors = [...epErrors, serviceActionErrors[serviceKey]].filter(Boolean);

    if (!info.running && !expandedSvcs[serviceKey] && !isStarting) {
      return (
        <div key={serviceKey} className="svc-row-collapsed" onClick={() => setExpandedSvcs(p => ({ ...p, [serviceKey]: true }))}>
          <span className={`status-dot ${isDisabled ? 'disabled' : 'stopped'}`} />
          <span className="svc-name-dim">{info.label}</span>
          <span className="svc-status-dim">{isDisabled ? 'disabled' : info.status || 'offline'}</span>
          <span className="svc-expand-icon">›</span>
        </div>
      );
    }

    return (
      <div key={serviceKey} className={`docker-status-item${isDisabled ? ' svc-disabled' : ''}`}>
        <div className="docker-status-main">
          <div className="docker-service-info">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
              <span className="docker-service-name">{info.label}</span>
              {typeLabel && <span className={`svc-type-badge badge-${typeLabel}`}>{typeLabel}</span>}
              <span className={`docker-service-status ${info.running ? anyModelUnready ? 'warning' : 'running' : isDisabled ? 'disabled' : isStarting ? 'starting' : 'stopped'}`}>
                {info.running ? anyModelUnready ? '● not ready' : '● Live' : isDisabled ? '● disabled' : isStarting ? '● starting…' : `● ${info.status || 'offline'}`}
              </span>
              {!info.running && !isStarting && expandedSvcs[serviceKey] && (
                <button
                  className="btn-docker-action"
                  style={{ fontSize: '0.62rem', padding: '0.05rem 0.25rem', marginLeft: 'auto' }}
                  onClick={() => setExpandedSvcs(p => ({ ...p, [serviceKey]: false }))}
                  title="Collapse"
                >‹</button>
              )}
            </div>
            {info.ports && <div className="docker-service-port">{info.ports}</div>}
            {info.backendType === 'mcp' && !isDisabled && (
              <div style={{ fontSize: '0.67rem', marginTop: '0.1rem' }}>
                <span style={{ color: info.running ? 'var(--green)' : 'var(--text-faint)' }}>
                  {info.running ? '✓ health ok' : '✗ unreachable'}
                </span>
              </div>
            )}
            {eps.map(({ epKey, ep }) => {
              const pullKey = `${epKey}:${ep.model}`;
              const pull = modelPulls[pullKey];
              const pulling = pull?.status === 'pulling' || serviceActionsInFlight[`pull:${pullKey}`];
              const installed = ep.backendType === 'ollama-container' ? ep.modelInstalled : ep.modelLoaded;
              const isActiveRunner = ep.backendType === 'docker-runner' && dockerStatus?.activeDockerRunnerModel?.key === epKey;
              const wasKnown = !!knownModels[pullKey];
              const epDisabled = !!ep.disabledReason;
              if (epDisabled) {
                return (
                  <div key={epKey} className="service-model-row" style={{ opacity: 0.5 }}>
                    <span className="service-model-name">{ep.model}</span>
                    <span style={{ color: 'var(--text-faint)', fontSize: '0.67rem' }}>✗ {ep.disabledReason}</span>
                  </div>
                );
              }
              return (
                <div key={epKey} className="service-model-row">
                  <span className="service-model-name">{ep.model || 'no model configured'}</span>
                  {isActiveRunner && <span className="badge-active">Active</span>}
                  {installed && <span style={{ color: 'var(--green)', fontSize: '0.67rem' }}>✓</span>}
                  {!installed && ep.model && <span style={{ color: 'var(--yellow)', fontSize: '0.67rem' }}>· not pulled</span>}
                  {wasKnown && !ep.live && <span style={{ color: 'var(--yellow)', fontSize: '0.67rem' }}>· was installed</span>}
                  {pull?.status === 'pulling' && (
                    <span className="docker-service-pull-status pulling" style={{ fontSize: '0.67rem' }}>
                      {pull.percent != null ? `${pull.percent}%` : pull.message || 'Pulling…'}
                    </span>
                  )}
                  {pull?.status === 'failed' && !installed && (
                    <span className="docker-service-pull-status failed" style={{ fontSize: '0.67rem' }}>
                      ✗ {pull.error || 'failed'}
                    </span>
                  )}
                  {!installed && ep.model && (
                    <button
                      className="btn-docker-action"
                      style={{ fontSize: '0.67rem', padding: '0.1rem 0.35rem' }}
                      disabled={pulling}
                      onClick={() => onPullModel(epKey, ep.model)}
                    >{pulling ? '…' : !installed ? 'Pull' : 'Re-pull'}</button>
                  )}
                </div>
              );
            })}
            {info.disabledReason && (
              <div className="docker-service-disabled-reason">{info.disabledReason}</div>
            )}
          </div>
          {canControl && (
            <div className="docker-actions">
              {info.running ? (
                <>
                  <button
                    className="btn-service-icon restart-btn"
                    disabled={serviceActionsInFlight[`${serviceKey}:restart`]}
                    title="Restart"
                    onClick={() => onRunServiceAction(serviceKey, 'restart')}
                  >{serviceActionsInFlight[`${serviceKey}:restart`] ? '…' : '↺'}</button>
                  <button
                    className="btn-service-icon stop-btn"
                    disabled={serviceActionsInFlight[`${serviceKey}:stop`]}
                    title="Stop"
                    onClick={() => onRunServiceAction(serviceKey, 'stop')}
                  >{serviceActionsInFlight[`${serviceKey}:stop`] ? '…' : '■'}</button>
                </>
              ) : isStarting ? (
                <button className="btn-service-icon" disabled title="Starting">…</button>
              ) : (
                <button
                  className="btn-service-icon start-btn"
                  disabled={serviceActionsInFlight[`${serviceKey}:start`]}
                  title="Start"
                  onClick={() => onRunServiceAction(serviceKey, 'start')}
                >{serviceActionsInFlight[`${serviceKey}:start`] ? '…' : '▶'}</button>
              )}
            </div>
          )}
        </div>
        {allErrors.length > 0 && (
          <div className="docker-status-error-zone">
            {allErrors.map((err, i) => (
              <div key={i} className="docker-service-error">{err}</div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Build endpoint → container map and docker-runner virtual endpoints
  const containerToEndpoints = {};
  const dockerRunnerEndpoints = [];
  if (dockerStatus?.endpoints) {
    for (const [epKey, ep] of Object.entries(dockerStatus.endpoints)) {
      if (ep.backendType === 'ollama-container') {
        if (!containerToEndpoints['ollama']) containerToEndpoints['ollama'] = [];
        containerToEndpoints['ollama'].push({ epKey, ep });
      } else if (ep.backendType === 'openllm') {
        if (!containerToEndpoints['llm_openllm']) containerToEndpoints['llm_openllm'] = [];
        containerToEndpoints['llm_openllm'].push({ epKey, ep });
      } else if (ep.backendType === 'docker-runner') {
        dockerRunnerEndpoints.push({ epKey, ep });
      }
    }
  }

  // Unified service list: containers + docker-runner virtual row + tool services
  const allSvcs = [];
  if (dockerStatus?.containers) {
    for (const [name, status] of Object.entries(dockerStatus.containers)) {
      if (name === 'docker-runner') continue;
      const sk = name === 'bb-mcp' ? 'bb_mcp' : name;
      const sm = systemServices?.services?.[sk];
      allSvcs.push({ key: sk, info: {
        label: status.label || name, running: status.running,
        status: status.status, ports: status.ports,
        controllable: sm?.controllable, disabledReason: sm?.disabledReason,
        backendType: sm?.backendType,
      }, endpoints: containerToEndpoints[name] || null });
    }
  }
  if (dockerRunnerEndpoints.length > 0) {
    const runnerAnyLive = dockerRunnerEndpoints.some(({ ep }) => ep.live && !ep.disabledReason);
    const runnerAllDisabled = dockerRunnerEndpoints.every(({ ep }) => !!ep.disabledReason);
    const runnerDisabledReason = runnerAllDisabled
      ? `Models exceed device VRAM (${dockerStatus?.deviceProfile?.name || 'current'} profile)`
      : null;
    allSvcs.push({ key: 'docker-runner', info: {
      label: 'Docker Model Runner',
      running: runnerAnyLive,
      status: runnerAllDisabled ? 'disabled' : 'offline', ports: 'host-internal',
      controllable: false, disabledReason: runnerDisabledReason, backendType: 'docker-runner',
    }, endpoints: dockerRunnerEndpoints });
  }
  if (systemServices?.services) {
    for (const [key, meta] of Object.entries(systemServices.services)) {
      if (dockerStatus?.containers && key in dockerStatus.containers) continue;
      if (key === 'docker-runner') continue;
      allSvcs.push({ key, info: {
        label: meta.label, running: meta.running, status: meta.status,
        ports: meta.ports, controllable: meta.controllable,
        disabledReason: meta.disabledReason, backendType: meta.backendType,
      }, endpoints: null });
    }
  }
  allSvcs.sort((a, b) => {
    const r = info => info.running ? 0 : info.disabledReason ? 2 : 1;
    const dr = r(a.info) - r(b.info);
    if (dr) return dr;
    const pa = SVC_ORDER.indexOf(a.key), pb = SVC_ORDER.indexOf(b.key);
    return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
  });

  return (
    <aside className="drawer drawer-right">
      <div className="drawer-header">
        <h2>System</h2>
        <button
          className="icon-btn"
          onClick={onToggleTheme}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >{darkMode ? '☀️' : '🌙'}</button>
        <button className={`icon-btn ${showMetricsPanel ? 'active' : ''}`} onClick={onToggleMetrics} title="Metrics">📊</button>
        <button className="icon-btn" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="system-info">
        <div className="system-info-item">
          <h3>Stack Status</h3>
          {(() => {
            const anyNotReady = dockerStatus?.endpoints &&
              Object.values(dockerStatus.endpoints).some(ep => !ep.live && !ep.disabledReason);
            const healthy = dockerStatus?.dockerRunning && !anyNotReady;
            return (
              <div className={`value ${healthy ? '' : anyNotReady ? 'warning' : 'error'}`}>
                {healthy ? 'Healthy' : anyNotReady ? 'Degraded' : 'Offline'}
              </div>
            );
          })()}
        </div>
        <div className="system-info-item">
          <h3>Active Services</h3>
          <div className="value">
            {runningServices}/{totalServices}
          </div>
        </div>
        <div className="system-info-item">
          <h3>Memory</h3>
          <div className="value">{systemInfo?.memory?.rss ? `${Math.round(systemInfo.memory.rss / 1024 / 1024)} MB` : 'N/A'}</div>
        </div>
        <div className="system-info-item">
          <h3>Uptime</h3>
          <div className="value">{systemInfo?.uptime ? `${Math.round(systemInfo.uptime / 60)} min` : 'N/A'}</div>
        </div>
        <div className="system-info-item">
          <h3>Device</h3>
          <div className="value" style={{ fontSize: '0.9rem' }}>
            {dockerStatus?.deviceProfile?.name || 'N/A'}
          </div>
          {dockerStatus?.deviceProfile && (
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
              {dockerStatus.deviceProfile.gpu ? '● GPU' : '● CPU-only'}
            </div>
          )}
        </div>
        <div className="system-info-item">
          <h3>LLM</h3>
          <div style={{ fontSize: '0.68rem', color: 'var(--text)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all', lineHeight: 1.4, marginTop: '0.1rem' }}>
            {systemServices?.primaryLlm?.resolvedUrl?.replace(/^https?:\/\//, '') || 'N/A'}
          </div>
          <div style={{ fontSize: '0.65rem', marginTop: '0.2rem' }}>
            <span style={{ color: systemServices?.dockerControlEnabled ? 'var(--green)' : 'var(--text-faint)' }}>
              {systemServices?.dockerControlEnabled ? '● control on' : '● control off'}
            </span>
          </div>
        </div>
      </div>

      <div className="docker-status">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3>Services</h3>
          <button
            className="btn-docker-action"
            style={{ fontSize: '0.72rem' }}
            title="Pull all configured models"
            onClick={async () => {
              try { await fetch('/api/models/pull-all', { method: 'POST' }); }
              catch (err) { console.error('pull-all failed:', err); }
            }}
          >Pull All</button>
        </div>
        {allSvcs.map(({ key, info, endpoints }) => renderServiceRow(key, info, endpoints))}
      </div>
    </aside>
  );
}

export default SystemPanel;
