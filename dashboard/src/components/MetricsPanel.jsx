import React from 'react';

const EXPERIENCE_META = {
  developer:   { icon: '💻', name: 'Developer' },
  research:    { icon: '🔬', name: 'Researcher' },
  safechat:    { icon: '🛡️', name: 'Safe Chat' },
  content_gen: { icon: '🎬', name: 'Content Studio' },
  website:     { icon: '🌐', name: 'Website Agent' },
};

function renderBar(value, max, color = 'var(--green)') {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="metric-bar-track">
      <div className="metric-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function MetricsPanel({ metricsSummary, metricsSafety, metricsFeedback, metricsErrors, liveEvents, taskSummary, onRefresh, onClose }) {
  return (
    <aside className="drawer drawer-right drawer-metrics">
      <div className="drawer-header">
        <h2>Metrics</h2>
        <button className="icon-btn" onClick={onRefresh} title="Refresh">↻</button>
        <button className="icon-btn" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="metrics-sidebar-cards">
        {[
          { label: 'Sessions', value: metricsSummary?.totalSessions ?? '…' },
          { label: 'Active', value: metricsSummary?.activeSessions ?? '…' },
          { label: 'Messages', value: metricsSummary?.totalMessages ?? '…' },
          { label: 'Blocked', value: metricsSafety?.totalBlocked ?? '…' },
          { label: '👍', value: metricsFeedback?.totalPositive ?? '…' },
          { label: '👎', value: metricsFeedback?.totalNegative ?? '…' },
          { label: 'Tasks', value: taskSummary?.total ?? 0 },
          { label: 'Pending', value: taskSummary?.byStatus?.pending ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="metrics-sidebar-card">
            <div className="metric-value">{value}</div>
            <div className="metric-label">{label}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '0 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="metric-panel">
          <h3>Model Usage</h3>
          {metricsSummary?.modelDistribution && Object.keys(metricsSummary.modelDistribution).length > 0
            ? Object.entries(metricsSummary.modelDistribution).map(([model, count]) => {
              const total = Object.values(metricsSummary.modelDistribution).reduce((a, b) => a + b, 0);
              return (
                <div key={model} className="metric-row">
                  <span className="metric-row-label">{model}</span>
                  {renderBar(count, total, 'var(--accent)')}
                  <span className="metric-row-value">{count}</span>
                </div>
              );
            })
            : <p className="task-empty">No data yet.</p>}
        </div>

        <div className="metric-panel">
          <h3>By Experience</h3>
          {metricsSummary?.experienceDistribution && Object.keys(metricsSummary.experienceDistribution).length > 0
            ? Object.entries(metricsSummary.experienceDistribution).map(([exp, count]) => {
              const total = Object.values(metricsSummary.experienceDistribution).reduce((a, b) => a + b, 0);
              const meta = EXPERIENCE_META[exp] || { icon: '?', name: exp };
              return (
                <div key={exp} className="metric-row">
                  <span className="metric-row-label">{meta.icon} {meta.name}</span>
                  {renderBar(count, total, 'var(--purple)')}
                  <span className="metric-row-value">{count}</span>
                </div>
              );
            })
            : <p className="task-empty">No data yet.</p>}
        </div>

        <div className="metric-panel">
          <h3>Safety</h3>
          {metricsSafety?.classificationBreakdown
            ? Object.entries(metricsSafety.classificationBreakdown).map(([cat, count]) => {
              const total = metricsSafety.totalClassified || 1;
              const color = cat === 'blocked' ? 'var(--red)' : cat === 'sensitive' ? 'var(--yellow)' : 'var(--green)';
              return (
                <div key={cat} className="metric-row">
                  <span className="metric-row-label" style={{ textTransform: 'capitalize' }}>{cat}</span>
                  {renderBar(count, total, color)}
                  <span className="metric-row-value">{count}</span>
                </div>
              );
            })
            : <p className="task-empty">No data yet.</p>}
        </div>

        <div className="metric-panel">
          <h3>Errors</h3>
          {metricsErrors ? (
            <>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                Total: <strong>{metricsErrors.total}</strong> · Rate: <strong>{metricsErrors.errorRatePercent}%</strong>
                {metricsErrors.recentCount > 0 && <span style={{ color: 'var(--red)' }}> · {metricsErrors.recentCount} recent</span>}
              </div>
              {metricsErrors.recent?.slice(-3).map((e, i) => (
                <div key={i} style={{ fontSize: '0.7rem', color: 'var(--red)', marginBottom: '0.2rem' }}>
                  [{new Date(e.timestamp).toLocaleTimeString()}] {e.error?.slice(0, 80)}
                </div>
              ))}
            </>
          ) : <p className="task-empty">No data yet.</p>}
        </div>

        <div className="metric-panel live-event-panel">
          <h3>Live Events</h3>
          {liveEvents.length > 0 ? (
            <div className="live-events-list">
              {liveEvents.slice(0, 10).map((event) => (
                <div key={event.event_id} className="live-event-item">
                  <div className="live-event-meta">
                    <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                    <strong>{event.event_type}</strong>
                  </div>
                  <div className="live-event-detail">{event.experience || 'unknown'} · {event.endpoint || 'n/a'}</div>
                </div>
              ))}
            </div>
          ) : <p className="task-empty">No live events yet.</p>}
        </div>
      </div>
    </aside>
  );
}

export default MetricsPanel;
