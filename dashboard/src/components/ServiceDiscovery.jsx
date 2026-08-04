import React, { useState } from 'react';
import { toast } from './Toast.jsx';

function DiscoveredServiceRow({ svc, addingKey, setAddingKey, fetchByokEndpoints, setDiscovered, onEndpointAdded }) {
  const needsKey = svc.requiresAuth;
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  async function handleAdd() {
    if (needsKey && !apiKey.trim()) { setShowKey(true); return; }
    setAddingKey(svc.key);
    try {
      const res = await fetch('/api/config/endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: svc.key, name: svc.name, url: svc.url,
          apiStyle: svc.apiStyle, defaultModel: svc.defaultModel || '',
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success?.(`Added: ${svc.name}`);
        fetchByokEndpoints();
        onEndpointAdded?.();
        if (setDiscovered) setDiscovered(prev => prev.map(s => s.key === svc.key ? { ...s, alreadyRegistered: true } : s));
      } else {
        toast.error(data.error || 'Failed to add');
      }
    } catch (err) { toast.error(err.message); }
    finally { setAddingKey(null); }
  }

  return (
    <div style={{ marginTop: '0.4rem', fontSize: '0.72rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.4rem' }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ color: 'var(--text)', fontWeight: 500 }}>{svc.name}</span>
          {needsKey && (
            <span style={{ marginLeft: '0.4rem', fontSize: '0.63rem', color: 'var(--yellow, #f5a623)', background: 'rgba(245,166,35,0.12)', borderRadius: '3px', padding: '0 0.25rem' }}>key required</span>
          )}
          <div style={{ color: 'var(--text-faint)', fontSize: '0.63rem', marginTop: '0.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {svc.url}
            <span style={{ color: 'var(--text-muted)', marginLeft: '0.35rem' }}>{svc.apiStyle}</span>
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
            onClick={handleAdd}
          >{addingKey === svc.key ? '…' : '+ Add'}</button>
        )}
      </div>
      {!svc.alreadyRegistered && (showKey || needsKey) && (
        <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <input
            type="password"
            placeholder={svc.keyHint || 'API key'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            style={{
              flex: 1, fontSize: '0.68rem', padding: '0.2rem 0.4rem',
              background: 'var(--input-bg, var(--bg2))', border: '1px solid var(--border)',
              borderRadius: '4px', color: 'var(--text)', outline: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          />
          {showKey && !needsKey && (
            <button
              className="btn-docker-action"
              style={{ fontSize: '0.63rem', padding: '0.15rem 0.35rem', flexShrink: 0 }}
              onClick={() => setShowKey(false)}
            >✕</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ServiceDiscovery({ fetchByokEndpoints, onEndpointAdded }) {
  const [discovered, setDiscovered] = useState(null);
  const [busy, setBusy] = useState(false);
  const [addingKey, setAddingKey] = useState(null);

  const handleScan = async () => {
    setBusy(true);
    setDiscovered(null);
    try {
      const res = await fetch('/api/discover/endpoints');
      const data = await res.json();
      if (data.success) {
        setDiscovered(data.discovered);
        if (data.discovered.length === 0) toast.info?.(`Scanned ${data.scanned} ports — nothing found`);
      } else {
        toast.error(data.error || 'Discovery failed');
      }
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const groups = [];
  if (discovered && discovered.length > 0) {
    const ollamaSvcs = discovered.filter(s => s.apiStyle === 'ollama');
    const namedSvcs = discovered.filter(s => s.apiStyle !== 'ollama' && s.name && !/^(OpenAI-compatible|Service) on/.test(s.name));
    const genericSvcs = discovered.filter(s => s.apiStyle !== 'ollama' && (!s.name || /^(OpenAI-compatible|Service) on/.test(s.name)));
    if (ollamaSvcs.length > 0) groups.push({ label: 'Ollama', svcs: ollamaSvcs });
    if (namedSvcs.length > 0) {
      const subMap = new Map();
      for (const s of namedSvcs) {
        const family = s.name.split(/[\s(]/)[0];
        if (!subMap.has(family)) subMap.set(family, []);
        subMap.get(family).push(s);
      }
      for (const [label, svcs] of subMap) groups.push({ label, svcs });
    }
    if (genericSvcs.length > 0) groups.push({ label: 'OpenAI-compatible', svcs: genericSvcs });
  }

  return (
    <div style={{ marginTop: '0.6rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Discover local services</span>
        <button
          className="btn-docker-action"
          style={{ fontSize: '0.68rem' }}
          disabled={busy}
          onClick={handleScan}
        >{busy ? 'Scanning…' : '⟳ Scan'}</button>
      </div>
      {groups.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          {groups.map(group => (
            <div key={group.label} style={{ marginBottom: '0.4rem' }}>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.1rem' }}>
                {group.label}
              </div>
              {group.svcs.map(svc => (
                <DiscoveredServiceRow
                  key={svc.key}
                  svc={svc}
                  addingKey={addingKey}
                  setAddingKey={setAddingKey}
                  fetchByokEndpoints={fetchByokEndpoints}
                  setDiscovered={setDiscovered}
                  onEndpointAdded={onEndpointAdded}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
