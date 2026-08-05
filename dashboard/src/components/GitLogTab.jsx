import React, { useState, useEffect, useCallback } from 'react';

export default function GitLogTab({ workspaceConfigured }) {
  const [commits, setCommits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!workspaceConfigured) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/workspace/git/log?limit=30');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) setErr(data.error);
      else setCommits(data.commits || []);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }, [workspaceConfigured]);

  useEffect(() => { load(); }, [load]);

  if (!workspaceConfigured) return <div className="ws-files-empty">Workspace not configured.</div>;
  return (
    <div className="ws-git-log-tab">
      <div className="ws-tab-header">
        <span>GIT LOG</span>
        <button className="icon-btn" onClick={load} title="Refresh" disabled={busy}>↻</button>
      </div>
      {err && <div className="ws-files-empty" style={{ color: 'var(--red)' }}>{err}</div>}
      {busy && commits.length === 0 && <div className="ws-files-empty">Loading…</div>}
      {commits.length === 0 && !busy && !err && <div className="ws-files-empty">No commits yet.</div>}
      <div className="ws-git-log-list">
        {commits.map(c => (
          <div key={c.hash} className="ws-git-log-entry" title={c.hash}>
            <span className="ws-git-log-hash">{c.short}</span>
            <span className="ws-git-log-subject">{c.subject}</span>
            <span className="ws-git-log-meta">{c.author} · {c.relative}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
