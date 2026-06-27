import React, { useState, useEffect, useCallback } from 'react';
import { toast } from './Toast.jsx';

function DiscoveredServiceRow({ svc, addingKey, setAddingKey, toast, fetchByokEndpoints, setDiscovered, setKnownProviders, isCloudProvider }) {
  return (
    <div style={{ marginTop: '0.4rem', fontSize: '0.72rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.4rem' }}>
      <div style={{ minWidth: 0 }}>
        <span style={{ color: 'var(--text)', fontWeight: 500 }}>{svc.name}</span>
        {svc.requiresAuth && !isCloudProvider && (
          <span style={{ marginLeft: '0.4rem', fontSize: '0.63rem', color: 'var(--yellow, #f5a623)', background: 'rgba(245,166,35,0.12)', borderRadius: '3px', padding: '0 0.25rem' }}>key required</span>
        )}
        {isCloudProvider && svc.requiresKey && (
          <span style={{ marginLeft: '0.4rem', fontSize: '0.63rem', color: 'var(--text-muted)' }}>{svc.keyHint}</span>
        )}
        <div style={{ color: 'var(--text-faint)', fontSize: '0.63rem', marginTop: '0.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {svc.url}
          {!isCloudProvider && <span style={{ color: 'var(--text-muted)', marginLeft: '0.35rem' }}>{svc.apiStyle}</span>}
        </div>
        {svc.models && svc.models.length > 0 && (
          <div style={{ color: 'var(--text-faint)', fontSize: '0.63rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {svc.models.slice(0, 3).join(', ')}{svc.models.length > 3 ? ` +${svc.models.length - 3}` : ''}
          </div>
        )}
      </div>
      {svc.alreadyRegistered ? (
        <span style={{ fontSize: '0.65rem', color: 'var(--green)', flexShrink: 0, paddingTop: '0.1rem' }}>✓ added</span>
      ) : (
        <button
          className="btn-docker-action"
          style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', flexShrink: 0 }}
          disabled={addingKey === svc.key}
          onClick={async () => {
            setAddingKey(svc.key);
            try {
              const res = await fetch('/api/config/endpoints', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  key: svc.key,
                  name: svc.name,
                  url: svc.url,
                  apiStyle: svc.apiStyle,
                  defaultModel: svc.defaultModel || '',
                }),
              });
              const data = await res.json();
              if (data.success) {
                toast.success?.(`Added: ${svc.name}`);
                fetchByokEndpoints();
                if (setDiscovered) setDiscovered(prev => prev.map(s => s.key === svc.key ? { ...s, alreadyRegistered: true } : s));
                if (setKnownProviders) setKnownProviders(prev => prev.map(s => s.key === svc.key ? { ...s, alreadyRegistered: true } : s));
              } else {
                toast.error(data.error || 'Failed to add');
              }
            } catch (err) { toast.error(err.message); }
            finally { setAddingKey(null); }
          }}
        >{addingKey === svc.key ? '…' : isCloudProvider ? '+ Configure' : '+ Add'}</button>
      )}
    </div>
  );
}

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
  const [expandedSvcs, setExpandedSvcs] = useState({});
  const [diagResults, setDiagResults] = useState(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [byokEndpoints, setByokEndpoints] = useState([]);
  const [byokForm, setByokForm] = useState({ key: '', name: '', url: '', apiStyle: 'openai', defaultModel: '', apiKey: '' });
  const [byokOpen, setByokOpen] = useState(false);
  const [byokBusy, setByokBusy] = useState(false);
  const [discovered, setDiscovered] = useState(null);
  const [knownProviders, setKnownProviders] = useState(null);
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [addingKey, setAddingKey] = useState(null);

  const fetchByokEndpoints = useCallback(async () => {
    try {
      const res = await fetch('/api/config/endpoints');
      const data = await res.json();
      if (data.success) setByokEndpoints(data.endpoints.filter(e => !e.builtin));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchByokEndpoints(); }, [fetchByokEndpoints]);

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
            {info.running && info.stats && (
              <div style={{ fontSize: '0.63rem', color: 'var(--text-faint)', marginTop: '0.15rem', fontFamily: 'var(--font-mono)', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span title="CPU usage">CPU {info.stats.cpu}</span>
                <span title="Memory usage">{info.stats.mem}</span>
                <span title="Memory %">({info.stats.memPerc})</span>
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

      <div className="docker-status" style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3>Diagnostics</h3>
          <button
            className="btn-docker-action"
            style={{ fontSize: '0.72rem' }}
            disabled={diagBusy}
            onClick={async () => {
              setDiagBusy(true);
              try {
                const res = await fetch('/api/system/config-check');
                const data = await res.json();
                setDiagResults(data);
              } catch (err) { setDiagResults({ error: err.message }); }
              finally { setDiagBusy(false); }
            }}
          >{diagBusy ? '…' : 'Run'}</button>
        </div>
        {diagResults && !diagResults.error && (
          <div style={{ marginTop: '0.4rem', fontSize: '0.68rem' }}>
            <div style={{ marginBottom: '0.3rem', color: 'var(--text-muted)' }}>
              {diagResults.summary.passing} passing · {diagResults.summary.failing} failing · {diagResults.summary.disabled} disabled
              {' · '}<span style={{ color: diagResults.dockerControlEnabled ? 'var(--green)' : 'var(--text-faint)' }}>
                {diagResults.dockerControlEnabled ? 'control on' : 'control off'}
              </span>
            </div>
            {diagResults.checks.map(c => (
              <div key={c.key} style={{ display: 'flex', gap: '0.3rem', alignItems: 'baseline', lineHeight: 1.5 }}>
                <span style={{ color: c.reachable === true ? 'var(--green)' : c.reachable === false ? 'var(--red)' : 'var(--text-faint)' }}>
                  {c.reachable === true ? '✓' : c.reachable === false ? '✗' : '—'}
                </span>
                <span style={{ color: 'var(--text)' }}>{c.label}</span>
                {c.hint && <span style={{ color: 'var(--text-faint)', fontSize: '0.63rem' }}>— {c.hint}</span>}
              </div>
            ))}
          </div>
        )}
        {diagResults?.error && (
          <div style={{ fontSize: '0.68rem', color: 'var(--red)', marginTop: '0.3rem' }}>{diagResults.error}</div>
        )}
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
              catch (err) { toast.error(`Pull all failed: ${err.message}`); }
            }}
          >Pull All</button>
        </div>
        {allSvcs.map(({ key, info, endpoints }) => renderServiceRow(key, info, endpoints))}
      </div>

      <div className="docker-status">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3>External Endpoints (BYOK)</h3>
          <button className="btn-docker-action" style={{ fontSize: '0.72rem' }} onClick={() => setByokOpen(p => !p)}>
            {byokOpen ? 'Cancel' : '+ Add'}
          </button>
        </div>
        {byokOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.5rem' }}>
            {[
              ['key', 'Endpoint key (e.g. claude)', byokForm.key],
              ['name', 'Display name', byokForm.name],
              ['url', 'API base URL', byokForm.url],
              ['defaultModel', 'Default model (optional)', byokForm.defaultModel],
              ['apiKey', 'API key (optional)', byokForm.apiKey],
            ].map(([field, placeholder, value]) => (
              <input
                key={field}
                type={field === 'apiKey' ? 'password' : 'text'}
                placeholder={placeholder}
                value={value}
                className="select"
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem' }}
                onChange={e => setByokForm(p => ({ ...p, [field]: e.target.value }))}
              />
            ))}
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Style:</label>
              <select
                value={byokForm.apiStyle}
                className="select"
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.4rem' }}
                onChange={e => setByokForm(p => ({ ...p, apiStyle: e.target.value }))}
              >
                <option value="openai">OpenAI-compatible</option>
                <option value="anthropic">Anthropic</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>
            <button
              className="btn-primary"
              style={{ fontSize: '0.75rem' }}
              disabled={byokBusy || !byokForm.key || !byokForm.url}
              onClick={async () => {
                setByokBusy(true);
                try {
                  const res = await fetch('/api/config/endpoints', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(byokForm),
                  });
                  const data = await res.json();
                  if (data.success) {
                    toast.success?.(`Added endpoint: ${byokForm.key}`);
                    setByokForm({ key: '', name: '', url: '', apiStyle: 'openai', defaultModel: '', apiKey: '' });
                    setByokOpen(false);
                    fetchByokEndpoints();
                  } else {
                    toast.error(data.error || 'Failed to add endpoint');
                  }
                } catch (err) { toast.error(err.message); }
                finally { setByokBusy(false); }
              }}
            >{byokBusy ? 'Adding…' : 'Add Endpoint'}</button>
          </div>
        )}
        {byokEndpoints.length === 0 && !byokOpen && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '0.4rem' }}>
            No external endpoints added. Click + Add to register a Claude, OpenAI, or custom API key.
          </div>
        )}
        {byokEndpoints.map(ep => (
          <div key={ep.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.4rem', fontSize: '0.72rem' }}>
            <div>
              <span style={{ color: 'var(--text)' }}>{ep.name}</span>
              <span style={{ color: 'var(--text-faint)', marginLeft: '0.4rem' }}>{ep.apiStyle}</span>
              {ep.hasApiKey && <span style={{ color: 'var(--green)', marginLeft: '0.4rem' }}>● key set</span>}
            </div>
            <button
              className="btn-docker-action"
              style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}
              onClick={async () => {
                try {
                  await fetch(`/api/config/endpoints/${ep.key}`, { method: 'DELETE' });
                  fetchByokEndpoints();
                } catch (err) { toast.error(err.message); }
              }}
            >✕</button>
          </div>
        ))}

        <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Discover Local Services</span>
            <button
              className="btn-docker-action"
              style={{ fontSize: '0.72rem' }}
              disabled={discoverBusy}
              onClick={async () => {
                setDiscoverBusy(true);
                setDiscovered(null);
                setKnownProviders(null);
                try {
                  const res = await fetch('/api/discover/endpoints');
                  const data = await res.json();
                  if (data.success) {
                    setDiscovered(data.discovered);
                    setKnownProviders(data.knownProviders || []);
                    if (data.discovered.length === 0) toast.info?.(`Scanned ${data.scanned} ports — nothing found`);
                  } else {
                    toast.error(data.error || 'Discovery failed');
                  }
                } catch (err) { toast.error(err.message); }
                finally { setDiscoverBusy(false); }
              }}
            >{discoverBusy ? 'Scanning…' : '⟳ Scan'}</button>
          </div>
          {discoverBusy && (
            <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', marginTop: '0.3rem' }}>
              Probing localhost + host.docker.internal on common LLM ports…
            </div>
          )}
          {discovered !== null && discovered.length === 0 && !discoverBusy && (
            <div style={{ fontSize: '0.68rem', color: 'var(--text-faint)', marginTop: '0.3rem' }}>
              No local LLM services found.
            </div>
          )}
          {discovered && discovered.length > 0 && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-faint)', fontWeight: 600, marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Local / Docker</div>
              {discovered.map(svc => (
                <DiscoveredServiceRow key={svc.key} svc={svc} addingKey={addingKey} setAddingKey={setAddingKey} toast={toast} fetchByokEndpoints={fetchByokEndpoints} setDiscovered={setDiscovered} />
              ))}
            </div>
          )}
          {knownProviders && knownProviders.length > 0 && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-faint)', fontWeight: 600, marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cloud Providers (BYOK)</div>
              {knownProviders.map(svc => (
                <DiscoveredServiceRow key={svc.key} svc={svc} addingKey={addingKey} setAddingKey={setAddingKey} toast={toast} fetchByokEndpoints={fetchByokEndpoints} setDiscovered={null} setKnownProviders={setKnownProviders} isCloudProvider />
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

export default SystemPanel;
