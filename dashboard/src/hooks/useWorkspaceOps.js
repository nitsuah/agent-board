import { useState, useRef } from 'react';

export function useWorkspaceOps() {
  const [workspacePath, setWorkspacePath] = useState('');
  const [workspaceLs, setWorkspaceLs] = useState(null);
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFilePath, setActiveFilePath] = useState(null);
  const [workspaceGitStatus, setWorkspaceGitStatus] = useState(null);
  const [workspaceBranches, setWorkspaceBranches] = useState({ branches: [], remotes: [], current: '' });
  const [wsNewBranch, setWsNewBranch] = useState(null); // null=hidden, ''=show input
  const [wsGitBusy, setWsGitBusy] = useState('');
  const [wsGitMsg, setWsGitMsg] = useState('');
  const [wsGitPopover, setWsGitPopover] = useState(false);
  const [workspaceCommitMsg, setWorkspaceCommitMsg] = useState('');
  const [workspaceActions, setWorkspaceActions] = useState({ committing: false, pushing: false, saving: false, error: null });
  const [artifactFiles, setArtifactFiles] = useState([]);
  const [wsShowExplorer, setWsShowExplorer] = useState(true);
  const [wsSearch, setWsSearch] = useState('');
  const [wsSearchResults, setWsSearchResults] = useState(null);
  const [wsSearchBusy, setWsSearchBusy] = useState(false);
  const [wsNewName, setWsNewName] = useState('');
  const [wsCreateMode, setWsCreateMode] = useState('');
  const [wsRenaming, setWsRenaming] = useState(null);
  const [wsBottomTab, setWsBottomTab] = useState('terminal');
  const [termHistory, setTermHistory] = useState([]);
  const [termInput, setTermInput] = useState('');
  const [termBusy, setTermBusy] = useState(false);
  const termEndRef = useRef(null);
  const [wsLayout, setWsLayout] = useState('single');
  const [wsExplorerWidth, setWsExplorerWidth] = useState(220);
  const [wsBottomHeight, setWsBottomHeight] = useState(220);
  const wsResizingRef = useRef(false);
  const wsGitPopoverRef = useRef(null);

  const browseWorkspace = async (path) => {
    try {
      const res = await fetch(`/api/workspace/ls?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!data.error) {
        setWorkspacePath(path);
        setWorkspaceLs(data);
      }
    } catch (err) { console.error('Workspace ls failed:', err); }
  };

  const openWorkspaceFile = async (path) => {
    const existing = openFiles.find(f => f.path === path);
    if (existing) { setActiveFilePath(path); return; }
    try {
      const res = await fetch(`/api/workspace/read?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!data.error) {
        setOpenFiles(prev => [...prev, { path: data.path, content: data.content, editContent: data.content, editing: true }]);
        setActiveFilePath(data.path);
      }
    } catch (err) { console.error('Workspace read failed:', err); }
  };

  const closeFile = (path) => {
    setOpenFiles(prev => {
      const remaining = prev.filter(f => f.path !== path);
      setActiveFilePath(cur => {
        if (cur !== path) return cur;
        return remaining.length ? remaining[remaining.length - 1].path : null;
      });
      return remaining;
    });
  };

  const refreshWorkspaceGit = async () => {
    try {
      const res = await fetch('/api/workspace/git/status');
      const data = await res.json();
      if (!data.error) setWorkspaceGitStatus(data);
    } catch (err) { console.error('Workspace git status failed:', err); }
  };

  const fetchArtifacts = async () => {
    try {
      const res = await fetch('/api/workspace/ls?path=artifacts');
      const data = await res.json();
      setArtifactFiles(data.error ? [] : (data.entries || []).filter(e => e.type === 'file'));
    } catch { setArtifactFiles([]); }
  };

  const commitWorkspace = async () => {
    if (!workspaceCommitMsg) return;
    setWorkspaceActions(p => ({ ...p, committing: true, error: null }));
    try {
      const res = await fetch('/api/workspace/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: workspaceCommitMsg }),
      });
      const data = await res.json();
      if (data.error) {
        setWorkspaceActions(p => ({ ...p, committing: false, error: data.error }));
      } else {
        setWorkspaceCommitMsg('');
        setWorkspaceActions(p => ({ ...p, committing: false, error: null }));
        refreshWorkspaceGit();
      }
    } catch (err) {
      setWorkspaceActions(p => ({ ...p, committing: false, error: err.message }));
    }
  };

  const pushWorkspace = async () => {
    setWorkspaceActions(p => ({ ...p, pushing: true, error: null }));
    try {
      const res = await fetch('/api/workspace/git/push', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        setWorkspaceActions(p => ({ ...p, pushing: false, error: data.error }));
      } else {
        setWorkspaceActions(p => ({ ...p, pushing: false, error: null }));
        refreshWorkspaceGit();
      }
    } catch (err) {
      setWorkspaceActions(p => ({ ...p, pushing: false, error: err.message }));
    }
  };

  const saveWorkspaceFile = async (path) => {
    const file = openFiles.find(f => f.path === (path || activeFilePath));
    if (!file || !file.editing) return;
    const content = file.editContent ?? file.content;
    setWorkspaceActions(p => ({ ...p, saving: true, error: null }));
    try {
      const res = await fetch('/api/workspace/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path, content }),
      });
      const data = await res.json();
      if (data.error) {
        setWorkspaceActions(p => ({ ...p, saving: false, error: data.error }));
      } else {
        setOpenFiles(prev => prev.map(f => f.path === file.path ? { ...f, content, editContent: null, editing: false } : f));
        setWorkspaceActions(p => ({ ...p, saving: false, error: null }));
        refreshWorkspaceGit();
      }
    } catch (err) {
      setWorkspaceActions(p => ({ ...p, saving: false, error: err.message }));
    }
  };

  const runTermCommand = async (cmd) => {
    if (!cmd.trim() || termBusy) return;
    const entry = { cmd, stdout: '', stderr: '', exitCode: null, ts: Date.now() };
    setTermHistory(h => [...h, entry]);
    setTermInput('');
    setTermBusy(true);
    try {
      const res = await fetch('/api/workspace/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      setTermHistory(h => h.map((e, i) => i === h.length - 1 ? { ...e, ...data } : e));
    } catch (err) {
      setTermHistory(h => h.map((e, i) => i === h.length - 1 ? { ...e, stderr: err.message, exitCode: 1 } : e));
    }
    setTermBusy(false);
    setTimeout(() => termEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const startExplorerResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = wsExplorerWidth;
    wsResizingRef.current = true;
    const onMove = (ev) => {
      if (!wsResizingRef.current) return;
      setWsExplorerWidth(Math.max(140, Math.min(480, startW + ev.clientX - startX)));
    };
    const onUp = () => { wsResizingRef.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startBottomResize = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = wsBottomHeight;
    const onMove = (ev) => setWsBottomHeight(Math.max(80, Math.min(600, startH - (ev.clientY - startY))));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const deleteWorkspaceEntry = async (path) => {
    if (!window.confirm(`Delete ${path}?`)) return;
    try {
      await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      closeFile(path);
      browseWorkspace(workspacePath);
      refreshWorkspaceGit();
    } catch (err) { console.error('Delete failed:', err); }
  };

  const createWorkspaceEntry = async (type) => {
    if (!wsNewName.trim()) return;
    const newPath = workspacePath ? `${workspacePath}/${wsNewName.trim()}` : wsNewName.trim();
    if (type === 'dir') {
      await fetch('/api/workspace/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      });
    } else {
      await fetch('/api/workspace/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath, content: '' }),
      });
    }
    setWsNewName('');
    setWsCreateMode('');
    browseWorkspace(workspacePath);
  };

  const renameWorkspaceEntry = async (oldName, newName) => {
    if (!newName.trim() || newName === oldName) { setWsRenaming(null); return; }
    const basePath = workspacePath;
    const fromPath = basePath ? `${basePath}/${oldName}` : oldName;
    const toPath = basePath ? `${basePath}/${newName.trim()}` : newName.trim();
    await fetch('/api/workspace/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromPath, to: toPath }),
    });
    setWsRenaming(null);
    closeFile(fromPath);
    browseWorkspace(workspacePath);
  };

  const searchWorkspace = async () => {
    if (!wsSearch.trim()) return;
    setWsSearchBusy(true);
    setWsSearchResults(null);
    try {
      const res = await fetch('/api/workspace/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: wsSearch }),
      });
      const data = await res.json();
      setWsSearchResults(data.files || []);
    } catch { setWsSearchResults([]); }
    finally { setWsSearchBusy(false); }
  };

  const fetchBranches = async () => {
    try {
      const res = await fetch('/api/workspace/git/branches');
      const data = await res.json();
      if (!data.error) setWorkspaceBranches(data);
    } catch { /* ignore */ }
  };

  const checkoutBranch = async (branch, create = false) => {
    setWsGitBusy('checkout');
    setWsGitMsg('');
    try {
      const res = await fetch('/api/workspace/git/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, create }),
      });
      const data = await res.json();
      if (data.error) { setWsGitMsg(`✗ ${data.error}`); }
      else { setWsGitMsg(`✓ On ${data.branch}`); setWsNewBranch(''); refreshWorkspaceGit(); fetchBranches(); browseWorkspace(''); }
    } catch (err) { setWsGitMsg(`✗ ${err.message}`); }
    finally { setWsGitBusy(''); }
  };

  const pullBranch = async () => {
    setWsGitBusy('pull');
    setWsGitMsg('');
    try {
      const res = await fetch('/api/workspace/git/pull', { method: 'POST' });
      const data = await res.json();
      if (data.error) setWsGitMsg(`✗ ${data.error}`);
      else { setWsGitMsg(`✓ ${data.result || 'Up to date'}`); refreshWorkspaceGit(); }
    } catch (err) { setWsGitMsg(`✗ ${err.message}`); }
    finally { setWsGitBusy(''); }
  };

  const discardFile = async (file) => {
    setWsGitBusy('discard');
    try {
      const res = await fetch('/api/workspace/git/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file }),
      });
      const data = await res.json();
      if (data.error) setWsGitMsg(`✗ ${data.error}`);
      else { refreshWorkspaceGit(); if (file && openFiles.find(f => f.path === file)) { closeFile(file); openWorkspaceFile(file); } }
    } catch { /* ignore */ }
    finally { setWsGitBusy(''); }
  };

  return {
    workspacePath, workspaceLs, openFiles, setOpenFiles, activeFilePath, setActiveFilePath,
    workspaceGitStatus, workspaceBranches, wsNewBranch, setWsNewBranch,
    wsGitBusy, wsGitMsg, wsGitPopover, setWsGitPopover,
    workspaceCommitMsg, setWorkspaceCommitMsg, workspaceActions,
    artifactFiles, wsShowExplorer, setWsShowExplorer,
    wsSearch, setWsSearch, wsSearchResults, setWsSearchResults, wsSearchBusy,
    wsNewName, setWsNewName, wsCreateMode, setWsCreateMode, wsRenaming, setWsRenaming,
    wsBottomTab, setWsBottomTab, termHistory, termInput, setTermInput, termBusy, termEndRef,
    wsLayout, setWsLayout, wsExplorerWidth, wsBottomHeight, wsGitPopoverRef,
    browseWorkspace, openWorkspaceFile, closeFile, refreshWorkspaceGit, fetchArtifacts,
    commitWorkspace, pushWorkspace, saveWorkspaceFile, runTermCommand,
    startExplorerResize, startBottomResize, deleteWorkspaceEntry, createWorkspaceEntry,
    renameWorkspaceEntry, searchWorkspace, fetchBranches, checkoutBranch, pullBranch, discardFile,
  };
}
