import React, { useRef, useEffect } from 'react';
import { EXPERIENCE_TOOLS } from '../constants/app-config.js';

export default function WorkspaceView({
  dockerStatus,
  workspacePath, workspaceLs, openFiles, setOpenFiles, activeFilePath, setActiveFilePath,
  workspaceGitStatus, workspaceBranches, wsNewBranch, setWsNewBranch,
  wsGitBusy, wsGitMsg, wsGitPopover, setWsGitPopover, wsGitPopoverRef,
  workspaceCommitMsg, setWorkspaceCommitMsg, workspaceActions,
  wsShowExplorer, setWsShowExplorer,
  wsSearch, setWsSearch, wsSearchResults, setWsSearchResults, wsSearchBusy,
  wsNewName, setWsNewName, wsCreateMode, setWsCreateMode, wsRenaming, setWsRenaming,
  wsBottomTab, setWsBottomTab, termHistory, termInput, setTermInput, termBusy, termEndRef,
  wsExplorerWidth, wsBottomHeight,
  browseWorkspace, openWorkspaceFile, closeFile, refreshWorkspaceGit, fetchArtifacts, fetchBranches,
  commitWorkspace, pushWorkspace, saveWorkspaceFile, runTermCommand,
  startExplorerResize, startBottomResize, deleteWorkspaceEntry, createWorkspaceEntry,
  renameWorkspaceEntry, searchWorkspace, checkoutBranch, pullBranch, discardFile,
  artifactFiles,
  tasks, taskTitle, setTaskTitle, taskPriority, setTaskPriority,
  createTask, updateTaskStatus, dispatchTask, deleteTask,
  activeSession, setActiveSession, fetchSessionDetails, setActiveTab,
  selectedExperience,
  contentClients, contentFiles, contentExpanded, setContentExpanded,
  fetchContentClients, fetchContentFiles, downloadContentFile,
}) {
  const termInputRef = useRef(null);

  // Re-focus terminal input after command finishes or tab switches to terminal
  useEffect(() => {
    if (!termBusy && wsBottomTab === 'terminal') {
      termInputRef.current?.focus();
    }
  }, [termBusy, wsBottomTab]);

  return (
    <div className="workspace-view">

      {/* ── Workspace toolbar with compact git ─────────────────────── */}
      <div className="ws-toolbar">
        <div className="ws-toolbar-left">
          {dockerStatus?.workspace?.configured ? (
            <>
              <span className="ws-root-label">{dockerStatus.workspace.root}</span>
              {workspaceBranches.branches.length > 0 ? (
                <select
                  className="ws-branch-select-inline"
                  value={workspaceBranches.current || workspaceGitStatus?.branch || ''}
                  onChange={e => checkoutBranch(e.target.value)}
                  disabled={wsGitBusy === 'checkout'}
                  title="Switch branch"
                >
                  {workspaceBranches.branches.map(b => <option key={b} value={b}>{b}</option>)}
                  {workspaceBranches.remotes.filter(r => !workspaceBranches.branches.includes(r.replace(/^origin\//, ''))).map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              ) : workspaceGitStatus && (
                <span className={`ws-branch-badge ${workspaceGitStatus.dirty ? 'dirty' : 'clean'}`}>
                  ⎇ {workspaceGitStatus.branch}{workspaceGitStatus.dirty ? ' ●' : ''}
                </span>
              )}
              <div className="ws-new-branch-inline">
                <input
                  className="ws-new-branch-input"
                  type="text"
                  placeholder="new-branch…"
                  value={wsNewBranch}
                  onChange={e => setWsNewBranch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && wsNewBranch && checkoutBranch(wsNewBranch, true)}
                />
                {wsNewBranch && (
                  <button className="ws-new-branch-btn" disabled={wsGitBusy === 'checkout'} onClick={() => checkoutBranch(wsNewBranch, true)} title="Create branch">+</button>
                )}
              </div>
            </>
          ) : (
            <span className="ws-root-label" style={{ opacity: 0.45 }}>No workspace mounted</span>
          )}
        </div>
        <div className="ws-toolbar-right">
          {dockerStatus?.workspace?.configured && (
            <>
              {workspaceGitStatus?.dirty && (
                <div className="ws-git-inline" ref={wsGitPopoverRef}>
                  <button
                    className={`ws-changes-btn ${wsGitPopover ? 'active' : ''}`}
                    onClick={() => setWsGitPopover(p => !p)}
                    title="View changes and commit"
                  >
                    {workspaceGitStatus.files.length} change{workspaceGitStatus.files.length !== 1 ? 's' : ''} ●
                  </button>
                  {wsGitPopover && (
                    <div className="ws-git-popover">
                      <div className="ws-git-popover-files">
                        {workspaceGitStatus.files.map(f => (
                          <div key={f.file} className="ws-popover-file">
                            <code className="ws-git-status-code">{f.status}</code>
                            <span className="ws-changed-file-name" onClick={() => { openWorkspaceFile(f.file); setWsGitPopover(false); }}>{f.file}</span>
                            <button className="ws-entry-btn ws-entry-btn-del" title="Discard" disabled={wsGitBusy === 'discard'} onClick={() => discardFile(f.file)}>↩</button>
                          </div>
                        ))}
                      </div>
                      <div className="ws-git-popover-commit">
                        <input
                          className="workspace-commit-msg"
                          type="text"
                          placeholder="Commit message…"
                          value={workspaceCommitMsg}
                          onChange={e => setWorkspaceCommitMsg(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && commitWorkspace()}
                        />
                        <button className="btn-docker-action" disabled={!workspaceCommitMsg || workspaceActions.committing} onClick={commitWorkspace}>
                          {workspaceActions.committing ? '…' : '✓ Commit'}
                        </button>
                      </div>
                      {wsGitMsg && <div className={`ws-git-msg ${wsGitMsg.startsWith('✗') ? 'err' : 'ok'}`}>{wsGitMsg}</div>}
                    </div>
                  )}
                </div>
              )}
              <button className="btn-docker-action ws-git-btn" disabled={wsGitBusy === 'pull'} onClick={pullBranch} title="Pull">
                {wsGitBusy === 'pull' ? '…' : '↓ Pull'}
              </button>
              <button className="btn-docker-action ws-git-btn" disabled={workspaceActions.pushing} onClick={pushWorkspace} title="Push">
                {workspaceActions.pushing ? '…' : '↑ Push'}
              </button>
              {workspaceActions.error && <span className="ws-git-err-icon" title={workspaceActions.error}>⚠</span>}
              <button className={`icon-btn ${wsShowExplorer ? 'active' : ''}`} onClick={() => setWsShowExplorer(p => !p)} title="Toggle Explorer">≡</button>
              <button className="icon-btn" onClick={() => { browseWorkspace(workspacePath); refreshWorkspaceGit(); fetchBranches(); }} title="Refresh">↻</button>
            </>
          )}
        </div>
      </div>

      {/* ── IDE 2-panel area ──────────────────────────────────────── */}
      {!dockerStatus?.workspace?.configured ? (
        <div className="ws-not-configured">
          <div style={{ opacity: 0.55, fontWeight: 600 }}>Optional — not configured</div>
          <div style={{ fontSize: '0.78rem', lineHeight: 1.6, marginTop: '0.4rem', opacity: 0.7 }}>
            Mount a local project folder so the AI can read, write, and git-commit files.<br />
            Set <code>WORKSPACE_PATH=C:/path/to/project</code> in <code>config/.env</code> then apply
            <code> docker-compose.workspace.yml</code> overlay.
          </div>
        </div>
      ) : (
        <div className={`ws-ide ${wsShowExplorer ? 'show-explorer' : ''}`}>

          {/* ── Explorer panel ─────────────────────────────────── */}
          {wsShowExplorer && (
            <div className="ws-panel ws-explorer-panel" style={{ width: wsExplorerWidth, minWidth: wsExplorerWidth, maxWidth: wsExplorerWidth }}>
              <div className="ws-panel-title">
                EXPLORER
                <div className="ws-explorer-actions">
                  <button className="icon-btn" title="New file" onClick={() => { setWsCreateMode('file'); setWsNewName(''); }}>+F</button>
                  <button className="icon-btn" title="New folder" onClick={() => { setWsCreateMode('dir'); setWsNewName(''); }}>+D</button>
                </div>
              </div>

              <div className="ws-search-row">
                <input
                  className="ws-search-input"
                  type="text"
                  placeholder="Search files…"
                  value={wsSearch}
                  onChange={e => { setWsSearch(e.target.value); if (!e.target.value) setWsSearchResults(null); }}
                  onKeyDown={e => e.key === 'Enter' && searchWorkspace()}
                />
                {wsSearch && (
                  <button className="icon-btn" style={{ fontSize: '0.7rem' }} onClick={searchWorkspace} disabled={wsSearchBusy}>
                    {wsSearchBusy ? '…' : '⌕'}
                  </button>
                )}
                {wsSearchResults !== null && (
                  <button className="icon-btn" style={{ fontSize: '0.65rem' }} onClick={() => { setWsSearchResults(null); setWsSearch(''); }}>✕</button>
                )}
              </div>

              {wsCreateMode && (
                <div className="ws-create-row">
                  <input
                    className="ws-create-input"
                    autoFocus
                    type="text"
                    placeholder={wsCreateMode === 'dir' ? 'folder name…' : 'filename…'}
                    value={wsNewName}
                    onChange={e => setWsNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') createWorkspaceEntry(wsCreateMode);
                      if (e.key === 'Escape') setWsCreateMode('');
                    }}
                  />
                  <button className="ws-create-confirm" onClick={() => createWorkspaceEntry(wsCreateMode)}>✓</button>
                  <button className="ws-create-cancel" onClick={() => setWsCreateMode('')}>✕</button>
                </div>
              )}

              <div className="workspace-breadcrumb">
                <span className="workspace-path-seg" onClick={() => browseWorkspace('')}>root</span>
                {workspacePath.split('/').filter(Boolean).map((seg, i, arr) => (
                  <span key={i}>
                    {' / '}
                    <span className="workspace-path-seg" onClick={() => browseWorkspace(arr.slice(0, i + 1).join('/'))}>
                      {seg}
                    </span>
                  </span>
                ))}
              </div>

              <div className="workspace-entries">
                {wsSearchResults !== null ? (
                  wsSearchResults.length === 0
                    ? <div style={{ opacity: 0.4, fontSize: '0.78rem', padding: '0.3rem 0.5rem' }}>No matches</div>
                    : wsSearchResults.map(f => (
                      <div
                        key={f}
                        className={`workspace-entry ${activeFilePath === f ? 'selected' : ''}`}
                        onClick={() => openWorkspaceFile(f)}
                      >
                        📄 {f}
                      </div>
                    ))
                ) : (
                  workspaceLs?.entries?.map(e => {
                    const fullPath = workspacePath ? `${workspacePath}/${e.name}` : e.name;
                    const isRenaming = wsRenaming?.name === e.name;
                    return (
                      <div
                        key={e.name}
                        className={`workspace-entry ${activeFilePath === fullPath ? 'selected' : ''}`}
                      >
                        {isRenaming ? (
                          <input
                            className="ws-rename-input"
                            autoFocus
                            value={wsRenaming.newName}
                            onChange={ev => setWsRenaming(r => ({ ...r, newName: ev.target.value }))}
                            onKeyDown={ev => {
                              if (ev.key === 'Enter') renameWorkspaceEntry(e.name, wsRenaming.newName);
                              if (ev.key === 'Escape') setWsRenaming(null);
                            }}
                            onBlur={() => renameWorkspaceEntry(e.name, wsRenaming.newName)}
                          />
                        ) : (
                          <span
                            className="ws-entry-name"
                            onClick={() => { if (e.type === 'dir') browseWorkspace(fullPath); else openWorkspaceFile(fullPath); }}
                          >
                            {e.type === 'dir' ? '📁' : '📄'} {e.name}
                            {e.size != null && <span className="ws-file-size"> {(e.size / 1024).toFixed(1)}k</span>}
                          </span>
                        )}
                        {!isRenaming && (
                          <span className="ws-entry-actions">
                            <button
                              className="ws-entry-btn"
                              title="Rename"
                              onClick={ev => { ev.stopPropagation(); setWsRenaming({ name: e.name, newName: e.name }); }}
                            >✎</button>
                            <button
                              className="ws-entry-btn ws-entry-btn-del"
                              title="Delete"
                              onClick={ev => { ev.stopPropagation(); deleteWorkspaceEntry(fullPath); }}
                            >✕</button>
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
                {!wsSearchResults && workspaceLs?.entries?.length === 0 && (
                  <div style={{ opacity: 0.4, fontSize: '0.78rem', padding: '0.3rem 0.5rem' }}>(empty)</div>
                )}
              </div>
            </div>
          )}

          {/* ── Drag resize handle ─────────────────────────────── */}
          {wsShowExplorer && (
            <div className="ws-resize-handle" onMouseDown={startExplorerResize} />
          )}

          {/* ── Editor panel with file tabs ─────────────────────── */}
          <div className="ws-panel ws-editor-panel">
            {openFiles.length > 0 && (
              <div className="ws-file-tabs">
                {openFiles.map(f => (
                  <div
                    key={f.path}
                    className={`ws-file-tab ${f.path === activeFilePath ? 'active' : ''}`}
                    onClick={() => setActiveFilePath(f.path)}
                    title={f.path}
                  >
                    <span className="ws-tab-name">{f.path.split('/').pop()}</span>
                    {f.editContent !== null && <span className="ws-unsaved-dot" title="Unsaved" />}
                    <button className="ws-tab-close" onClick={e => { e.stopPropagation(); closeFile(f.path); }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {(() => {
              const af = openFiles.find(f => f.path === activeFilePath);
              if (!af) return (
                <div className="ws-editor-empty">
                  <div style={{ opacity: 0.3, fontSize: '0.85rem' }}>Select a file to view or edit</div>
                </div>
              );
              return (
                <>
                  <div className="ws-editor-tab-actions">
                    {af.editing ? (
                      <>
                        <button className="ws-btn-save" disabled={workspaceActions.saving} onClick={() => saveWorkspaceFile()}>
                          {workspaceActions.saving ? 'Saving…' : '✓ Save'}
                        </button>
                        <button className="ws-btn-discard" onClick={() => setOpenFiles(prev => prev.map(f => f.path === activeFilePath ? { ...f, editing: false, editContent: null } : f))}>
                          ✕ Discard
                        </button>
                      </>
                    ) : (
                      <button className="ws-btn-edit" onClick={() => setOpenFiles(prev => prev.map(f => f.path === activeFilePath ? { ...f, editing: true, editContent: f.content } : f))}>
                        ✎ Edit
                      </button>
                    )}
                  </div>
                  {workspaceActions.error && <div className="ws-editor-error">{workspaceActions.error}</div>}
                  {af.editing ? (
                    <textarea
                      className="ws-editor-textarea"
                      value={af.editContent ?? af.content}
                      onChange={e => setOpenFiles(prev => prev.map(f => f.path === activeFilePath ? { ...f, editContent: e.target.value } : f))}
                      spellCheck={false}
                    />
                  ) : (
                    <pre className="workspace-file-content">{af.content}</pre>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Bottom resize handle ─────────────────────────────────── */}
      <div className="ws-bottom-resize-handle" onMouseDown={startBottomResize} />

      {/* ── Bottom tabbed panel ───────────────────────────────────── */}
      <div className="ws-bottom-panel-outer" style={{ height: wsBottomHeight }}>
        <div className="ws-bottom-tabs-bar">
          {[
            { key: 'terminal', label: 'TERMINAL' },
            { key: 'tasks', label: 'TASKS' },
            { key: 'artifacts', label: 'ARTIFACTS' },
            { key: 'output', label: 'OUTPUT' },
          ].map(({ key, label }) => (
            <button key={key} className={`ws-bottom-tab-btn ${wsBottomTab === key ? 'active' : ''}`} onClick={() => setWsBottomTab(key)}>
              {label}
              {key === 'tasks' && tasks.filter(t => t.status !== 'completed').length > 0 && (
                <span className="ws-tab-badge">{tasks.filter(t => t.status !== 'completed').length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="ws-bottom-tab-content">

          {wsBottomTab === 'terminal' && (
            <div className="ws-terminal">
              <div className="ws-term-history">
                {termHistory.length === 0 && (
                  <div className="ws-term-welcome">Connected to workspace shell. Type a command to begin.</div>
                )}
                {termHistory.map((entry, i) => (
                  <div key={i} className="ws-term-entry">
                    <div className="ws-term-cmd"><span className="ws-term-prompt">$</span> {entry.cmd}</div>
                    {entry.stdout && <pre className="ws-term-stdout">{entry.stdout}</pre>}
                    {entry.stderr && <pre className="ws-term-stderr">{entry.stderr}</pre>}
                    {entry.exitCode != null && entry.exitCode !== 0 && (
                      <div className="ws-term-exit">exit {entry.exitCode}</div>
                    )}
                  </div>
                ))}
                <div ref={termEndRef} />
              </div>
              <div className="ws-term-input-row">
                <span className="ws-term-prompt">$</span>
                <input
                  ref={termInputRef}
                  className="ws-term-input"
                  type="text"
                  value={termInput}
                  onChange={e => setTermInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      runTermCommand(termInput);
                      setTimeout(() => termInputRef.current?.focus(), 100);
                    }
                  }}
                  placeholder={termBusy ? 'Running…' : 'Enter command…'}
                  disabled={termBusy}
                  spellCheck={false}
                  autoComplete="off"
                />
                {termBusy && <span className="ws-term-busy">⟳</span>}
              </div>
            </div>
          )}

          {wsBottomTab === 'tasks' && (
            <div className="ws-tasks-tab">
              <div className="task-create-row">
                <input type="text" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Add a task…" maxLength={140} onKeyDown={e => e.key === 'Enter' && createTask()} />
                <select value={taskPriority} onChange={e => setTaskPriority(e.target.value)}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="urgent">urgent</option>
                </select>
                <button className="btn-primary" onClick={createTask}>Add</button>
              </div>
              <div className="task-list">
                {tasks.slice(0, 20).map(task => (
                  <div key={task.id} className={`task-item status-${task.status}`}>
                    <div className="task-item-head">
                      <strong>{task.title}</strong>
                      <span className={`task-priority ${task.priority}`}>{task.priority}</span>
                    </div>
                    <div className="task-item-meta">
                      <span>{task.status.replace('_', ' ')}</span>
                      {task.sessionId ? (
                        <span className="task-session-link" onClick={() => { setActiveSession(task.sessionId); fetchSessionDetails(task.sessionId); setActiveTab('chat'); }} title="Go to session">{task.assignedSessionName || 'session →'}</span>
                      ) : (
                        <span style={{ opacity: 0.4 }}>unassigned</span>
                      )}
                    </div>
                    <div className="task-item-actions">
                      {task.status === 'pending' && <button className="task-dispatch-btn" onClick={() => dispatchTask(task)}>▶ Dispatch</button>}
                      <button onClick={() => updateTaskStatus(task.id, 'completed')}>Done</button>
                      <button onClick={() => deleteTask(task.id)}>Delete</button>
                    </div>
                  </div>
                ))}
                {tasks.length === 0 && <div className="task-empty">No tasks yet.</div>}
              </div>
            </div>
          )}

          {wsBottomTab === 'artifacts' && (
            <div className="ws-artifacts-tab">
              <div className="ws-tab-header">
                <span>ARTIFACTS</span>
                <button className="icon-btn" onClick={fetchArtifacts} title="Refresh">↻</button>
              </div>
              {!dockerStatus?.workspace?.configured ? (
                <div className="ws-files-empty">Workspace not configured.</div>
              ) : artifactFiles.length === 0 ? (
                <div className="ws-files-empty">Research Mode saves files here.</div>
              ) : artifactFiles.map(f => (
                <div key={f.name} className="ws-file-row">
                  <span>{f.name}</span>
                  <a href={`/api/workspace/read?path=${encodeURIComponent('artifacts/' + f.name)}`} target="_blank" rel="noreferrer" className="ws-file-link">↓ view</a>
                </div>
              ))}
            </div>
          )}

          {wsBottomTab === 'output' && (
            <div className="ws-output-tab">
              {EXPERIENCE_TOOLS[selectedExperience] ? (
                <>
                  <div className="ws-tab-header">
                    <span>OUTPUT FILES</span>
                    <button className="icon-btn" onClick={fetchContentClients} title="Refresh">↻</button>
                  </div>
                  {contentClients.length === 0 ? (
                    <div className="ws-files-empty">No output yet.</div>
                  ) : contentClients.map(slug => (
                    <div key={slug} style={{ fontSize: '0.82rem', marginBottom: '0.3rem' }}>
                      <div className="ws-file-group-header" onClick={() => { const next = !contentExpanded[slug]; setContentExpanded(prev => ({ ...prev, [slug]: next })); if (next && !contentFiles[slug]) fetchContentFiles(slug); }}>
                        {contentExpanded[slug] ? '▼' : '▶'} {slug}
                      </div>
                      {contentExpanded[slug] && (
                        <div style={{ paddingLeft: '0.7rem' }}>
                          {!contentFiles[slug] && <div style={{ opacity: 0.5 }}>Loading…</div>}
                          {contentFiles[slug]?.map(f => (
                            <div key={f.path} className="ws-file-row">
                              <span>{f.path}</span>
                              <button className="btn-docker-action" style={{ fontSize: '0.65rem', padding: '0.08rem 0.3rem' }} onClick={() => downloadContentFile(slug, f.path)}>↓</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              ) : (
                <div className="ws-files-empty">No output files available.</div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
