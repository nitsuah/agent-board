import React, { useState } from 'react';
import { getFriendlyServiceError } from '../utils/serviceErrors.js';

const BACKEND_TYPE_LABEL = {
  'ollama-container': 'local', sandbox: 'sandbox', mcp: 'mcp',
  'docker-runner': 'runner', 'openllm-container': 'custom',
};

export default function ServiceRow({
  serviceKey, info, endpointData,
  dockerStatus, modelPulls, knownModels,
  serviceActionsInFlight, serviceActionErrors, servicesStarting,
  onRunServiceAction, onPullModel,
}) {
  const [expanded, setExpanded] = useState(false);

  const canControl = !!(info.controllable);
  const eps = endpointData || [];
  const typeLabel = BACKEND_TYPE_LABEL[info.backendType] || '';
  const isDisabled = !!info.disabledReason;
  const isStarting = !info.running && !!servicesStarting?.[serviceKey];
  const anyModelUnready = info.running && eps.some(({ ep }) => ep.backendType === 'ollama-container' && !ep.modelInstalled);

  const epErrors = eps
    .map(({ epKey, ep }) => serviceActionErrors[`pull:${epKey}:${ep.model}`])
    .filter(Boolean);
  const allErrors = [...epErrors, serviceActionErrors[serviceKey]].filter(Boolean);

  if (!info.running && !expanded && !isStarting) {
    return (
      <div
        className="svc-row-collapsed"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(true)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true); } }}
      >
        <span className={`status-dot ${isDisabled ? 'disabled' : 'stopped'}`} />
        <span className="svc-name-dim">{info.label}</span>
        <span className="svc-status-dim">{isDisabled ? 'disabled' : info.status || 'offline'}</span>
        <span className="svc-expand-icon">›</span>
      </div>
    );
  }

  return (
    <div className={`docker-status-item${isDisabled ? ' svc-disabled' : ''}`}>
      <div className="docker-status-main">
        <div className="docker-service-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
            <span className="docker-service-name">{info.label}</span>
            {typeLabel && <span className={`svc-type-badge badge-${typeLabel}`}>{typeLabel}</span>}
            <span className={`docker-service-status ${info.running ? anyModelUnready ? 'warning' : 'running' : isDisabled ? 'disabled' : isStarting ? 'starting' : 'stopped'}`}>
              {info.running
                ? anyModelUnready ? '● not ready' : '● Live'
                : isDisabled ? '● disabled' : isStarting ? '● starting…' : `● ${info.status || 'offline'}`}
            </span>
            {!info.running && !isStarting && expanded && (
              <button
                className="btn-docker-action"
                style={{ fontSize: '0.62rem', padding: '0.05rem 0.25rem', marginLeft: 'auto' }}
                onClick={() => setExpanded(false)}
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
            <div key={i} className="docker-service-error">{getFriendlyServiceError(err)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
