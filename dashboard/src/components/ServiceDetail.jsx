import React from 'react';

export default function ServiceDetail({
  node, systemServices, dockerStatus, modelPulls,
  serviceActionsInFlight, onRunServiceAction, onPullModel,
}) {
  const svcKey = node.svcKey;
  const svc = systemServices?.services?.[svcKey];
  const canControl = !!(systemServices?.dockerControlEnabled && svc?.controllable);
  const isRunning = svc?.running ?? false;

  const containerEndpoints = svcKey === 'ollama'
    ? Object.entries(dockerStatus?.endpoints || {}).filter(([, ep]) => ep.backendType === 'ollama-container')
    : svcKey === 'llm_openllm'
    ? Object.entries(dockerStatus?.endpoints || {}).filter(([, ep]) => ep.backendType === 'openllm-container')
    : [];

  return (
    <div style={{ fontSize: '0.72rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <span style={{ color: isRunning ? 'var(--green)' : 'var(--text-faint)' }}>
          {isRunning ? '● running' : '○ offline'}
        </span>
        {canControl && (
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {isRunning ? (
              <>
                <button
                  className="btn-service-icon restart-btn"
                  disabled={serviceActionsInFlight?.[`${svcKey}:restart`]}
                  title="Restart"
                  onClick={() => onRunServiceAction?.(svcKey, 'restart')}
                >{serviceActionsInFlight?.[`${svcKey}:restart`] ? '…' : '↺'}</button>
                <button
                  className="btn-service-icon stop-btn"
                  disabled={serviceActionsInFlight?.[`${svcKey}:stop`]}
                  title="Stop"
                  onClick={() => onRunServiceAction?.(svcKey, 'stop')}
                >{serviceActionsInFlight?.[`${svcKey}:stop`] ? '…' : '■'}</button>
              </>
            ) : (
              <button
                className="btn-service-icon start-btn"
                disabled={serviceActionsInFlight?.[`${svcKey}:start`]}
                title="Start"
                onClick={() => onRunServiceAction?.(svcKey, 'start')}
              >{serviceActionsInFlight?.[`${svcKey}:start`] ? '…' : '▶'}</button>
            )}
          </div>
        )}
      </div>
      {svc?.ports && (
        <div style={{ color: 'var(--text-faint)', marginBottom: '0.3rem', fontFamily: 'var(--font-mono)', fontSize: '0.67rem' }}>
          port {svc.ports}
        </div>
      )}
      {svc?.stats && isRunning && (
        <div style={{ color: 'var(--text-faint)', fontSize: '0.63rem', fontFamily: 'var(--font-mono)', marginBottom: '0.3rem', display: 'flex', gap: '0.5rem' }}>
          <span>CPU {svc.stats.cpu}</span><span>{svc.stats.mem}</span><span>({svc.stats.memPerc})</span>
        </div>
      )}
      {containerEndpoints.map(([epKey, ep]) => {
        const pullKey = `${epKey}:${ep.model}`;
        const pull = modelPulls?.[pullKey];
        const installed = ep.modelInstalled ?? ep.modelLoaded;
        const pulling = pull?.status === 'pulling';
        return (
          <div key={epKey} style={{ marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.67rem' }}>{ep.model || '—'}</span>
            {installed && <span style={{ color: 'var(--green)', fontSize: '0.63rem' }}>✓</span>}
            {!installed && ep.model && <span style={{ color: 'var(--yellow)', fontSize: '0.63rem' }}>not pulled</span>}
            {pull?.status === 'pulling' && (
              <span style={{ color: 'var(--accent)', fontSize: '0.63rem' }}>
                {pull.percent != null ? `${pull.percent}%` : 'pulling…'}
              </span>
            )}
            {!installed && ep.model && onPullModel && (
              <button
                className="btn-docker-action"
                style={{ fontSize: '0.63rem', padding: '0.1rem 0.3rem' }}
                disabled={pulling}
                onClick={() => onPullModel(epKey, ep.model)}
              >Pull</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
