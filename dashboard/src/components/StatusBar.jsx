import React from 'react';

export default function StatusBar({
  wsConnected,
  currentEndpoint,
  allEndpointMeta,
  runningServices,
  totalServices,
  showSystemPanel,
  onToggleSystemPanel,
}) {
  return (
    <div className="status-bar">
      <div className="status-bar-left" />
      <div className="status-bar-right">
        <span
          className={`status-bar-dot ${wsConnected ? 'green' : 'red'}`}
          title={wsConnected ? 'Connected' : 'Offline'}
        />
        {allEndpointMeta[currentEndpoint] && (
          <span
            className="status-bar-item status-bar-item-mobile-icon"
            title={`Model: ${allEndpointMeta[currentEndpoint].label}`}
          >
            <span className="status-bar-icon">🤖</span>
            <span className="status-bar-label">{allEndpointMeta[currentEndpoint].label}</span>
          </span>
        )}
        <button
          className={`status-bar-cog ${showSystemPanel ? 'active' : ''}`}
          onClick={onToggleSystemPanel}
          title={`System — ${runningServices}/${totalServices} services`}
        >
          ⚙️ <span className="status-bar-label">{totalServices > 0 ? `${runningServices}/${totalServices}` : '…'}</span>
        </button>
      </div>
    </div>
  );
}
