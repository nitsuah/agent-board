import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './App.css';

// ── Anonymous user identity ────────────────────────────────────────────────
function getOrCreateUserId() {
  const key = 'agent_board_user_id';
  let id = localStorage.getItem(key);
  if (!id) {
    // Use crypto.randomUUID() when available (all modern browsers), fall back to Date+random
    id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? 'anon_' + crypto.randomUUID()
      : 'anon_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 11);
    localStorage.setItem(key, id);
  }
  return id;
}

function getUserRole() {
  return localStorage.getItem('agent_board_user_role') || null;
}

function shouldShowOnboarding() {
  return localStorage.getItem('agent_board_onboarding_dismissed') !== '1';
}

// Max characters to show for error messages in the metrics UI
const ERROR_DISPLAY_MAX_LEN = 80;
const ENDPOINT_META = {
  primary:       { model: 'llama3.2:3b',            label: 'Llama 3.2 3B',  desc: 'Ollama container · 2.0 GB',      backendBadge: 'Ollama' },
  docker_runner: { model: 'ai/qwen3-coder:latest',  label: 'Qwen3-Coder',   desc: 'Docker Model Runner · 16.45 GB', backendBadge: 'Docker Runner' },
  glm_flash:     { model: 'ai/glm-4.7-flash:latest',label: 'GLM-4.7-Flash', desc: 'Docker Model Runner · 16.31 GB', backendBadge: 'Docker Runner' },
  openllm:       { model: 'custom (OPENLLM_MODEL)', label: 'OpenLLM',       desc: 'Custom/HF model · OpenAI-compatible · port 8082', backendBadge: 'OpenLLM' },
};

// ── Experience definitions (mirrors server EXPERIENCE_CONFIGS) ─────────────
const EXPERIENCE_META = {
  developer:   { icon: '💻', name: 'Developer', description: 'Full model access, standard safety.' },
  research:    { icon: '🔬', name: 'Researcher', description: 'Long-form reasoning. Slightly looser rails.' },
  safechat:    { icon: '🛡️', name: 'Safe Chat',  description: 'Strict safety. Simple UI for any user.' },
  content_gen: { icon: '🎬', name: 'Content Studio', description: 'Generate AI short videos (content-gen tool).' },
  website:     { icon: '🌐', name: 'Website Agent',  description: 'Lead discovery + B2B site generation (website tool).' },
};

const EXPERIENCE_ENDPOINTS = {
  developer: ['primary', 'docker_runner', 'glm_flash', 'openllm'],
  research: ['primary', 'docker_runner', 'glm_flash', 'openllm'],
  safechat: ['primary'],
  content_gen: ['primary', 'docker_runner', 'glm_flash', 'openllm'],
  website: ['primary', 'docker_runner', 'glm_flash', 'openllm']
};

// Experiences backed by an MCP tool server: the chat is paired with a
// workbench panel that lists and executes the server's tools via /api/tools.
const EXPERIENCE_TOOLS = {
  content_gen: { toolKey: 'content_gen', serviceKey: 'tool_content_gen' },
  website: { toolKey: 'website', serviceKey: 'tool_website' },
};

// ── Safety mode badge colours ──────────────────────────────────────────────
const SAFETY_COLORS = { strict: 'var(--red)', standard: 'var(--yellow)', research: 'var(--green)' };

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Markdown — lightweight renderer for AI responses.
 * Handles code blocks (with Copy button), inline code, bold, headers, bullet lists, line breaks.
 */
function Markdown({ content }) {
  const [copied, setCopied] = React.useState(null);

  const copyCode = (code, idx) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(idx);
    setTimeout(() => setCopied(c => c === idx ? null : c), 1500);
  };

  // Collect code blocks first so we can render them as React elements (not dangerouslySetInnerHTML)
  const segments = React.useMemo(() => {
    if (!content) return [];
    const parts = [];
    let remaining = content;
    let codeIdx = 0;
    const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    codeBlockRe.lastIndex = 0;
    while ((match = codeBlockRe.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'code', lang: match[1] || 'text', value: match[2].trim(), idx: codeIdx++ });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) parts.push({ type: 'text', value: content.slice(lastIndex) });
    return parts;
  }, [content]);

  const renderText = (text) => {
    let html = escHtml(text);
    // Bold
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    // Inline code (already HTML-escaped, so backticks are safe)
    html = html.replace(/`([^`\n]+)`/g, '<code class="md-code-inline">$1</code>');
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');
    // Bullet list items — wrap groups in <ul>
    html = html.replace(/^[-*•] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)(?=\s*(?:<li>|$))/g, '$1');
    html = html.replace(/(<li>[\s\S]*<\/li>)/g, '<ul class="md-ul">$1</ul>');
    // Double newline → paragraph break, single newline → line break
    html = html.replace(/\n\n/g, '</p><p class="md-p">');
    html = html.replace(/\n/g, '<br>');
    html = `<p class="md-p">${html}</p>`;
    html = html.replace(/<p class="md-p"><\/p>/g, '');
    return html;
  };

  return (
    <div className="md-content">
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <div key={i} className="md-code-block">
            <div className="md-code-header">
              <span className="md-code-lang">{seg.lang}</span>
              <button className="md-copy-btn" onClick={() => copyCode(seg.value, seg.idx)}>
                {copied === seg.idx ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <pre><code>{seg.value}</code></pre>
          </div>
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: renderText(seg.value) }} />
        )
      )}
    </div>
  );
}

/**
 * AgentStatusCard — compact card showing a single session's live status.
 */
function AgentStatusCard({ session, isActive, isStreaming, queueCount, isPaused, onClick, onDelete, onStop, endpointLabel }) {
  const ago = (date) => {
    const secs = Math.floor((Date.now() - new Date(date)) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
  };

  const statusLabel = isStreaming ? 'streaming' : session.messageCount > 0 ? 'idle' : 'new';
  const statusClass = isStreaming ? 'streaming' : session.messageCount > 0 ? 'idle' : 'new';

  return (
    <div
      className={`agent-card ${isActive ? 'active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className="agent-card-header">
        <span className={`agent-status-dot ${statusClass}`} title={statusLabel} />
        <span className="agent-card-name">{session.name}</span>
        {isStreaming && onStop && (
          <button
            className="btn-stop"
            title="Stop responding"
            onClick={(e) => { e.stopPropagation(); onStop(session.id); }}
          >■</button>
        )}
        <button
          className="btn-delete"
          title="Delete session"
          onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
        >✕</button>
      </div>
      <div className="agent-card-meta">
        <span className="agent-card-endpoint">{endpointLabel || session.endpoint}</span>
        <span className="agent-card-msgs">{session.messageCount}m</span>
        {queueCount > 0 && <span className="agent-card-queue">{queueCount}q</span>}
        {isPaused && <span className="agent-card-paused">⏸</span>}
        {isStreaming && <span style={{ color: 'var(--accent)' }}>⟳</span>}
      </div>
    </div>
  );
}

/**
 * ToolField — one form input derived from a JSON-schema property.
 */
function ToolField({ name, schema, required, value, onChange }) {
  const label = (
    <span className="tool-field-label">
      {name}{required ? ' *' : ''}
      {schema.description && <span className="tool-field-desc"> — {schema.description}</span>}
    </span>
  );

  if (schema.type === 'boolean') {
    return (
      <label className="tool-field tool-field-checkbox">
        <input
          type="checkbox"
          checked={value ?? schema.default ?? false}
          onChange={e => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  }

  if (Array.isArray(schema.enum)) {
    return (
      <label className="tool-field">
        {label}
        <select
          className="select"
          value={value ?? schema.default ?? schema.enum[0]}
          onChange={e => onChange(e.target.value)}
        >
          {schema.enum.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </label>
    );
  }

  return (
    <label className="tool-field">
      {label}
      <input
        type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'}
        value={value ?? schema.default ?? ''}
        placeholder={schema.default !== undefined ? String(schema.default) : ''}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * ToolWorkbench — lists an MCP tool server's tools and executes them.
 * Shown alongside chat for tool-backed experiences (Content Studio, Website Agent).
 */
function ToolWorkbench({ toolKey, serviceKey, onRunService, serviceActionsInFlight }) {
  const [toolServer, setToolServer] = useState(null);
  const [dockerControlEnabled, setDockerControlEnabled] = useState(false);
  const [tools, setTools] = useState([]);
  const [toolsError, setToolsError] = useState(null);
  const [openTool, setOpenTool] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [callState, setCallState] = useState({ running: false, tool: null, result: null, error: null });
  const [collapsed, setCollapsed] = useState(false);

  const fetchToolServer = useCallback(async () => {
    try {
      const res = await fetch('/api/tools');
      const data = await res.json();
      if (data.success) {
        setDockerControlEnabled(!!data.dockerControlEnabled);
        setToolServer(data.tools.find(t => t.key === toolKey) || null);
      }
    } catch (error) {
      console.error('Error fetching tool servers:', error);
      setToolServer(null);
    }
  }, [toolKey]);

  useEffect(() => {
    fetchToolServer();
    const interval = setInterval(fetchToolServer, 10000);
    return () => clearInterval(interval);
  }, [fetchToolServer]);

  useEffect(() => {
    if (!toolServer?.running) {
      setTools([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tools/${toolKey}/tools`);
        const data = await res.json();
        if (cancelled) return;
        if (data.success) {
          setTools(data.tools);
          setToolsError(null);
        } else {
          setToolsError(data.error || 'Failed to list tools');
        }
      } catch (error) {
        if (!cancelled) setToolsError(error.message);
      }
    })();
    return () => { cancelled = true; };
  }, [toolKey, toolServer?.running]);

  const setField = (tool, field, value) => {
    setFormValues(prev => ({ ...prev, [tool]: { ...prev[tool], [field]: value } }));
  };

  const runTool = async (tool) => {
    const schema = tool.inputSchema || {};
    const props = schema.properties || {};
    const values = formValues[tool.name] || {};
    const args = {};
    for (const [name, propSchema] of Object.entries(props)) {
      let value = values[name];
      if (value === undefined) value = propSchema.default;
      // Untouched enum selects display their first option — submit it too
      if (value === undefined && Array.isArray(propSchema.enum)) value = propSchema.enum[0];
      if (value === undefined || value === '') continue;
      if (propSchema.type === 'number' || propSchema.type === 'integer') {
        const num = Number(value);
        if (!Number.isNaN(num)) args[name] = num;
      } else if (propSchema.type === 'boolean') {
        args[name] = !!value;
      } else {
        args[name] = value;
      }
    }

    setCallState({ running: true, tool: tool.name, result: null, error: null });
    try {
      const res = await fetch(`/api/tools/${toolKey}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tool.name, arguments: args }),
      });
      const data = await res.json();
      setOpenTool(null);
      if (data.success && !data.isError) {
        setCallState({ running: false, tool: tool.name, result: data.content || '(no output)', error: null });
      } else {
        // MCP isError responses carry the explanation in content
        setCallState({ running: false, tool: tool.name, result: null, error: data.content || data.error || 'Tool call failed' });
      }
      setTimeout(() => document.querySelector('.tool-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    } catch (error) {
      setOpenTool(null);
      setCallState({ running: false, tool: tool.name, result: null, error: error.message });
      setTimeout(() => document.querySelector('.tool-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    }
  };

  const startActionId = `${serviceKey}:start`;

  return (
    <div className="tool-workbench">
      <div className="tool-workbench-header" onClick={() => setCollapsed(prev => !prev)}>
        <span className={`agent-status-dot ${toolServer?.running ? 'idle' : 'new'}`} />
        <strong>{toolServer?.name || 'Tool server'}</strong>
        <span className="tool-workbench-status">
          {toolServer ? (toolServer.running ? 'online' : 'offline') : 'checking…'}
        </span>
        <span className="tool-workbench-toggle">{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div className="tool-workbench-body">
          {toolServer && !toolServer.running && (
            <div className="tool-workbench-offline">
              <p>
                The {toolServer.name} server is not running ({toolServer.url}).
                {dockerControlEnabled
                  ? ' Start it below, or run on the host:'
                  : ' Start it on the host:'}
              </p>
              <code>docker compose -f config/docker-compose.yml --project-directory . --profile tools up -d {toolServer.composeService}</code>
              {dockerControlEnabled && (
                <button
                  className="btn-primary"
                  disabled={serviceActionsInFlight[startActionId]}
                  onClick={() => onRunService(serviceKey, 'start').then(fetchToolServer)}
                >
                  {serviceActionsInFlight[startActionId] ? 'Starting…' : `▶ Start ${toolServer.composeService}`}
                </button>
              )}
            </div>
          )}

          {toolServer?.running && toolsError && (
            <div className="tool-workbench-offline">
              <p>Tool list unavailable: {toolsError}</p>
            </div>
          )}

          {toolServer?.running && !toolsError && tools.map(tool => (
            <div key={tool.name} className={`tool-entry ${openTool === tool.name ? 'open' : ''}`}>
              <div className="tool-entry-header" onClick={() => setOpenTool(prev => prev === tool.name ? null : tool.name)}>
                <strong>{tool.name}</strong>
                <span className="tool-entry-desc">{tool.description}</span>
              </div>
              {openTool === tool.name && (
                <div className="tool-entry-form">
                  {Object.entries(tool.inputSchema?.properties || {}).map(([field, fieldSchema]) => (
                    <ToolField
                      key={field}
                      name={field}
                      schema={fieldSchema}
                      required={(tool.inputSchema?.required || []).includes(field)}
                      value={formValues[tool.name]?.[field]}
                      onChange={value => setField(tool.name, field, value)}
                    />
                  ))}
                  <button
                    className="btn-primary"
                    disabled={callState.running}
                    onClick={() => runTool(tool)}
                  >
                    {callState.running && callState.tool === tool.name ? '⟳ Running… (long jobs can take minutes)' : `▶ Run ${tool.name}`}
                  </button>
                </div>
              )}
            </div>
          ))}

          {(callState.result || callState.error) && (
            <div className={`tool-result ${callState.error ? 'error' : ''}`}>
              <div className="tool-result-header">
                <strong>{callState.tool}</strong> {callState.error ? 'failed' : 'result'}
                <button className="icon-btn" onClick={() => setCallState({ running: false, tool: null, result: null, error: null })} title="Clear result">✕</button>
              </div>
              <pre>{callState.error || callState.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  const userId = useRef(getOrCreateUserId());

  const [sessions, setSessions] = useState([]);
  const [models, setModels] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [activeSessionMessages, setActiveSessionMessages] = useState([]);
  const [currentModel, setCurrentModel] = useState(ENDPOINT_META.primary.model);
  const [currentEndpoint, setCurrentEndpoint] = useState('primary');
  const [messageInput, setMessageInput] = useState('');
  const [useNemoClaw, setUseNemoClaw] = useState(false);
  // Per-session streaming state — tracks which sessions are actively receiving a response
  const [loadingSessions, setLoadingSessions] = useState(new Set());
  const [streamingBySession, setStreamingBySession] = useState({});
  const streamAbortControllersRef = useRef(new Map());
  const [dockerStatus, setDockerStatus] = useState(null);
  const [systemServices, setSystemServices] = useState(null);
  const [serviceActionsInFlight, setServiceActionsInFlight] = useState({});
  const [serviceActionErrors, setServiceActionErrors] = useState({});
  const [modelPulls, setModelPulls] = useState({});
  const [systemInfo, setSystemInfo] = useState(null);
  const [showSystemPanel, setShowSystemPanel] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showNewSessionMenu, setShowNewSessionMenu] = useState(false);
  const newSessionMenuRef = useRef(null);
  const [demoMode, setDemoMode] = useState({ enabled: false, enforcedExperience: null, allowedEndpoints: [] });
  const [liveEvents, setLiveEvents] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);

  // Content file browser (website agent output)
  const [contentClients, setContentClients] = useState([]);
  const [contentFiles, setContentFiles] = useState({}); // slug -> file list
  const [contentExpanded, setContentExpanded] = useState({}); // slug -> bool

  // Known pulled models persisted in localStorage so tiles survive container restarts
  const [knownModels, setKnownModels] = useState(() => {
    try { return JSON.parse(localStorage.getItem('agent_board_pulled_models') || '{}'); } catch { return {}; }
  }); // { "endpointKey:model": { endpointKey, model, pulledAt } }

  // Workspace file I/O
  const [workspacePath, setWorkspacePath] = useState('');
  const [workspaceLs, setWorkspaceLs] = useState(null);
  // Multi-file editor tabs
  const [openFiles, setOpenFiles] = useState([]); // [{ path, content, editContent: null|string, editing: bool }]
  const [activeFilePath, setActiveFilePath] = useState(null);
  const [workspaceGitStatus, setWorkspaceGitStatus] = useState(null);
  const [workspaceBranches, setWorkspaceBranches] = useState({ branches: [], remotes: [], current: '' });
  const [wsNewBranch, setWsNewBranch] = useState('');
  const [wsGitBusy, setWsGitBusy] = useState('');
  const [wsGitMsg, setWsGitMsg] = useState('');
  const [wsGitPopover, setWsGitPopover] = useState(false); // compact git popover
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
  const [showMetricsPanel, setShowMetricsPanel] = useState(false);
  // Bottom panel tabs + terminal
  const [wsBottomTab, setWsBottomTab] = useState('terminal');
  const [termHistory, setTermHistory] = useState([]); // [{cmd, stdout, stderr, exitCode, ts}]
  const [termInput, setTermInput] = useState('');
  const [termBusy, setTermBusy] = useState(false);
  const termEndRef = useRef(null);
  // Layout: split view
  const [wsLayout, setWsLayout] = useState('single'); // 'single'|'split-h'|'split-v'
  const [wsExplorerWidth, setWsExplorerWidth] = useState(220);
  const wsResizingRef = useRef(false);
  const wsGitPopoverRef = useRef(null);

  // Theme toggle (dark default)
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('agent_board_theme');
    const isDark = saved !== 'light';
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    return isDark;
  });

  const toggleTheme = () => {
    setDarkMode(prev => {
      const next = !prev;
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
      localStorage.setItem('agent_board_theme', next ? 'dark' : 'light');
      return next;
    });
  };

  // Experience selector
  const [selectedExperience, setSelectedExperience] = useState('developer');

  // Active tab: 'chat' | 'metrics'
  const [activeTab, setActiveTab] = useState('chat');
  const [showOnboarding, setShowOnboarding] = useState(shouldShowOnboarding);

  // Metrics data
  const [metricsSummary, setMetricsSummary] = useState(null);
  const [metricsSafety, setMetricsSafety] = useState(null);
  const [metricsFeedback, setMetricsFeedback] = useState(null);
  const [metricsErrors, setMetricsErrors] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [taskSummary, setTaskSummary] = useState({ total: 0, byStatus: {} });
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');

  // Per-session message queue: queued messages waiting to be sent after current response
  const messageQueuesRef = useRef({}); // { sessionId: string[] } — source of truth
  const [queueLengths, setQueueLengths] = useState({}); // mirrors ref for UI re-renders
  // Paused sessions won't auto-process the next queued message after a response ends
  const pausedSessionsRef = useRef(new Set());
  const [pausedSessions, setPausedSessions] = useState(new Set());

  const chatBottomRef = useRef(null);

  // Derived per-active-session helpers (backwards-compat with single-session UI)
  const loading = loadingSessions.has(activeSession);
  const streamingContent = streamingBySession[activeSession] || '';

  // Merge static ENDPOINT_META with any custom endpoints reported by the server.
  // Custom endpoints (backendType: 'custom') are dynamically registered via
  // CUSTOM_LLM_ENDPOINTS and won't be in the static map.
  const allEndpointMeta = useMemo(() => {
    const result = { ...ENDPOINT_META };
    if (!dockerStatus?.endpoints) return result;
    for (const [key, ep] of Object.entries(dockerStatus.endpoints)) {
      if (!result[key]) {
        result[key] = {
          model: ep.model || '',
          label: ep.name || key,
          desc: ep.hasApiKey ? `${ep.type || 'custom'} · API key set` : (ep.backendType || 'custom'),
          backendBadge: ep.type === 'cloud' ? 'Cloud API' : 'Custom',
        };
      }
    }
    return result;
  }, [dockerStatus]);

  const getAvailableEndpoints = useCallback((experienceKey) => {
    if (demoMode.enabled) {
      return ['primary'];
    }
    const base = EXPERIENCE_ENDPOINTS[experienceKey] || EXPERIENCE_ENDPOINTS.developer;
    // Include custom (cloud/user-registered) endpoints from the server alongside static ones
    const customKeys = Object.entries(dockerStatus?.endpoints || {})
      .filter(([, ep]) => ep.backendType === 'custom')
      .map(([k]) => k);
    return customKeys.length ? [...new Set([...base, ...customKeys])] : base;
  }, [demoMode.enabled, dockerStatus]);

  const getPreferredModelForEndpoint = useCallback((endpoint) => {
    const configuredModel = allEndpointMeta[endpoint]?.model || currentModel;
    const endpointModels = models.filter((model) => model.id === endpoint);
    const getModelIdentifier = (model) => model?.name || model?.model;

    if (!endpointModels.length) {
      return configuredModel;
    }

    // Prefer an exact match with the configured default model
    const exactConfiguredMatch = endpointModels.find((model) => {
      const identifier = getModelIdentifier(model);
      return identifier === configuredModel || model?.model === configuredModel;
    });
    if (exactConfiguredMatch) {
      return getModelIdentifier(exactConfiguredMatch);
    }

    // Fall back to a tagged variant (e.g. "llama2" matches "llama2:latest")
    const taggedConfiguredMatch = endpointModels.find((model) => {
      const identifier = getModelIdentifier(model);
      return (
        typeof configuredModel === 'string' &&
        typeof identifier === 'string' &&
        identifier.startsWith(`${configuredModel}:`)
      );
    });
    if (taggedConfiguredMatch) {
      return getModelIdentifier(taggedConfiguredMatch);
    }

    // Use the endpoint-marked default if present
    const endpointDefault = endpointModels.find(
      (model) => model?.default || model?.isDefault || model?.is_default
    );
    if (endpointDefault) {
      return getModelIdentifier(endpointDefault);
    }

    return configuredModel || getModelIdentifier(endpointModels[0]);
  }, [models, currentModel]);

  // ── Data fetching ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetchModels();
    fetchSessions();
    fetchTasks();
    fetchDockerStatus();
    fetchSystemServices();
    fetchSystemInfo();
    fetchDemoMode();
    fetchModelPullStatus();

    const sessionInterval = setInterval(fetchSessions, 5000);
    const taskInterval = setInterval(fetchTasks, 7000);
    const dockerInterval = setInterval(fetchDockerStatus, 10000);
    const servicesInterval = setInterval(fetchSystemServices, 10000);
    const pullStatusInterval = setInterval(fetchModelPullStatus, 10000);
    return () => {
      clearInterval(sessionInterval);
      clearInterval(taskInterval);
      clearInterval(dockerInterval);
      clearInterval(servicesInterval);
      clearInterval(pullStatusInterval);
    };
  }, []);

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      if (data.success) setModels(data.models);
    } catch (error) { console.error('Error fetching models:', error); }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      if (data.success) setSessions(data.sessions);
    } catch (error) { console.error('Error fetching sessions:', error); }
  };

  const fetchDockerStatus = async () => {
    try {
      const res = await fetch('/api/docker/status');
      const data = await res.json();
      setDockerStatus(data);
    } catch (error) {
      console.error('Error fetching Docker status:', error);
      setDockerStatus({ dockerRunning: false, errors: ['Failed to connect'] });
    }
  };

  const fetchSystemInfo = async () => {
    try {
      const res = await fetch('/api/system/info');
      const data = await res.json();
      if (data.success) setSystemInfo(data.system);
    } catch (error) { console.error('Error fetching system info:', error); }
  };

  const fetchSystemServices = async () => {
    try {
      const res = await fetch('/api/system/services');
      const data = await res.json();
      if (data.success) {
        setSystemServices(data);
      }
    } catch (error) {
      console.error('Error fetching system services:', error);
      setSystemServices(null);
    }
  };

  const browseWorkspace = async (path) => {
    try {
      const res = await fetch(`/api/workspace/ls?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!data.error) {
        setWorkspacePath(path);
        setWorkspaceLs(data);
        setWorkspaceFileView(null);
      }
    } catch (err) { console.error('Workspace ls failed:', err); }
  };

  const openWorkspaceFile = async (path) => {
    // If already open, just switch to it
    const existing = openFiles.find(f => f.path === path);
    if (existing) { setActiveFilePath(path); return; }
    try {
      const res = await fetch(`/api/workspace/read?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!data.error) {
        setOpenFiles(prev => [...prev, { path: data.path, content: data.content, editContent: null, editing: false }]);
        setActiveFilePath(data.path);
      }
    } catch (err) { console.error('Workspace read failed:', err); }
  };

  const closeFile = (path) => {
    setOpenFiles(prev => prev.filter(f => f.path !== path));
    setActiveFilePath(prev => {
      if (prev !== path) return prev;
      const remaining = openFiles.filter(f => f.path !== path);
      return remaining.length ? remaining[remaining.length - 1].path : null;
    });
  };

  const setFileEditing = (path, editing) => {
    setOpenFiles(prev => prev.map(f =>
      f.path === path ? { ...f, editing, editContent: editing ? (f.editContent ?? f.content) : null } : f
    ));
  };

  const updateFileEditContent = (path, content) => {
    setOpenFiles(prev => prev.map(f => f.path === path ? { ...f, editContent: content } : f));
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

  const runServiceAction = async (serviceKey, action) => {
    const actionId = `${serviceKey}:${action}`;
    setServiceActionsInFlight(prev => ({ ...prev, [actionId]: true }));
    setServiceActionErrors(prev => ({ ...prev, [serviceKey]: null }));
    try {
      const res = await fetch(`/api/system/services/${serviceKey}/${action}`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!data.success) {
        console.error('Service action failed:', data.error || 'Unknown error');
        setServiceActionErrors(prev => ({ ...prev, [serviceKey]: data.error || 'Action failed' }));
      }
      await Promise.all([fetchDockerStatus(), fetchSystemServices()]);
    } catch (error) {
      console.error('Service action failed:', error);
      setServiceActionErrors(prev => ({ ...prev, [serviceKey]: error.message }));
    } finally {
      setServiceActionsInFlight(prev => ({ ...prev, [actionId]: false }));
    }
  };

  const fetchModelPullStatus = async () => {
    try {
      const res = await fetch('/api/models/pull-status');
      const data = await res.json();
      if (data.success) setModelPulls(data.pulls || {});
    } catch (error) { console.error('Error fetching model pull status:', error); }
  };

  const pullModel = async (endpoint, model) => {
    const pullKey = `${endpoint}:${model}`;
    const actionId = `pull:${pullKey}`;
    setServiceActionsInFlight(prev => ({ ...prev, [actionId]: true }));
    setServiceActionErrors(prev => ({ ...prev, [actionId]: null }));
    try {
      const res = await fetch('/api/models/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, model })
      });
      const data = await res.json();
      if (!data.success) {
        setServiceActionErrors(prev => ({ ...prev, [actionId]: data.error || 'Pull failed' }));
      } else {
        // Record the pull in localStorage so the tile persists if the container restarts
        const record = { endpointKey: endpoint, model, pulledAt: new Date().toISOString() };
        setKnownModels(prev => {
          const next = { ...prev, [pullKey]: record };
          try { localStorage.setItem('agent_board_pulled_models', JSON.stringify(next)); } catch { /* storage full */ }
          return next;
        });
      }
      await fetchModelPullStatus();
    } catch (error) {
      setServiceActionErrors(prev => ({ ...prev, [actionId]: error.message }));
    } finally {
      setServiceActionsInFlight(prev => ({ ...prev, [actionId]: false }));
    }
  };

  const unloadDockerModel = async (model) => {
    try {
      const res = await fetch('/api/models/unload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model })
      });
      const data = await res.json();
      if (!data.success) console.error('Unload failed:', data.error);
      else await fetchDockerStatus();
    } catch (err) { console.error('Unload error:', err); }
  };

  const fetchContentClients = async () => {
    try {
      const res = await fetch('/api/content/clients');
      const data = await res.json();
      if (data.success) setContentClients(data.clients || []);
    } catch { /* ignore */ }
  };

  const fetchContentFiles = async (slug) => {
    try {
      const res = await fetch(`/api/content/clients/${encodeURIComponent(slug)}/files`);
      const data = await res.json();
      if (data.success) setContentFiles(prev => ({ ...prev, [slug]: data.files || [] }));
    } catch { /* ignore */ }
  };

  const downloadContentFile = (slug, filePath) => {
    const url = `/api/content/download/${encodeURIComponent(slug)}/${filePath}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath.split('/').pop();
    a.click();
  };

  const fetchDemoMode = async () => {
    try {
      const res = await fetch('/api/demo-mode');
      const data = await res.json();
      if (data.success) {
        setDemoMode({
          enabled: !!data.enabled,
          enforcedExperience: data.enforcedExperience || null,
          allowedEndpoints: data.allowedEndpoints || []
        });
      }
    } catch (error) {
      console.error('Error fetching demo mode:', error);
    }
  };

  const fetchMetrics = useCallback(async () => {
    try {
      const [summary, safety, feedback, errors] = await Promise.all([
        fetch('/api/metrics/summary').then(r => r.json()),
        fetch('/api/metrics/safety').then(r => r.json()),
        fetch('/api/metrics/feedback').then(r => r.json()),
        fetch('/api/metrics/errors').then(r => r.json()),
      ]);
      if (summary.success) setMetricsSummary(summary.summary);
      if (safety.success) setMetricsSafety(safety.safety);
      if (feedback.success) setMetricsFeedback(feedback.feedback);
      if (errors.success) setMetricsErrors(errors.errors);
    } catch (error) { console.error('Error fetching metrics:', error); }
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (data.success) {
        setTasks(data.tasks || []);
        setTaskSummary(data.summary || { total: 0, byStatus: {} });
      }
    } catch (error) {
      console.error('Error fetching tasks:', error);
    }
  };

  useEffect(() => {
    if (demoMode.enabled) {
      setSelectedExperience('safechat');
      setCurrentEndpoint('primary');
      setCurrentModel(ENDPOINT_META.primary.model);
    }
  }, [demoMode.enabled]);

  useEffect(() => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${window.location.host}/ws/events`);

    socket.onopen = () => setWsConnected(true);
    socket.onclose = () => setWsConnected(false);
    socket.onerror = () => setWsConnected(false);
    socket.onmessage = (msg) => {
      try {
        const payload = JSON.parse(msg.data);
        if (payload.type !== 'event' || !payload.event) {
          return;
        }

        setLiveEvents((prev) => [payload.event, ...prev].slice(0, 30));

        const { event_type: eventType, endpoint, model, metadata } = payload.event;
        if (eventType?.startsWith('model_pull_') && endpoint && model) {
          const pullKey = `${endpoint}:${model}`;
          setModelPulls((prev) => ({ ...prev, [pullKey]: { endpoint, model, ...metadata } }));
        }
      } catch {
        // Ignore malformed payloads.
      }
    };

    return () => socket.close();
  }, []);

  useEffect(() => {
    if (activeTab === 'metrics') {
      fetchMetrics();
      const interval = setInterval(fetchMetrics, 10000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchMetrics]);

  // ── Session helpers ────────────────────────────────────────────────────────
  const createSession = async () => {
    try {
      const availableEndpoints = getAvailableEndpoints(selectedExperience);
      const onlineEndpoints = availableEndpoints.filter((key) => {
        const endpointStatus = dockerStatus?.endpoints?.[key];
        return endpointStatus ? endpointStatus.live === true : true;
      });
      const endpointPool = onlineEndpoints.length ? onlineEndpoints : availableEndpoints;
      const endpoint = endpointPool.includes(currentEndpoint)
        ? currentEndpoint
        : endpointPool[0];
      const model = getPreferredModelForEndpoint(endpoint);

      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          endpoint,
          userId: userId.current,
          userRole: getUserRole(),
          experience: selectedExperience
        })
      });
      const data = await res.json();
      if (data.success) {
        setCurrentEndpoint(data.session.endpoint);
        setCurrentModel(data.session.model);
        setActiveSession(data.session.id);
        fetchSessions();
      }
    } catch (error) { console.error('Error creating session:', error); }
  };

  const fetchSessionDetails = async (id) => {
    try {
      const res = await fetch(`/api/sessions/${id}`);
      const data = await res.json();
      if (data.success && data.session) {
        setActiveSessionMessages(data.session.messages || []);
        setCurrentEndpoint(data.session.endpoint);
        setCurrentModel(data.session.model);
        setSessions(prev => prev.map(s => s.id === id
          ? {
              ...s,
              messageCount: (data.session.messages || []).length,
              endpoint: data.session.endpoint,
              model: data.session.model,
              experience: data.session.experience,
              safetyMode: data.session.safetyMode
            }
          : s
        ));
      }
    } catch (error) { console.error('Error fetching session details:', error); }
  };

  // ── Queue helpers ─────────────────────────────────────────────────────────
  const enqueueMessage = (sessionId, message) => {
    if (!messageQueuesRef.current[sessionId]) messageQueuesRef.current[sessionId] = [];
    messageQueuesRef.current[sessionId].push(message);
    setQueueLengths(prev => ({ ...prev, [sessionId]: (messageQueuesRef.current[sessionId] || []).length }));
  };

  const dequeueNext = (sessionId) => {
    const queue = messageQueuesRef.current[sessionId];
    if (!queue || queue.length === 0) return null;
    const msg = queue.shift();
    setQueueLengths(prev => {
      const len = (messageQueuesRef.current[sessionId] || []).length;
      const next = { ...prev };
      if (len === 0) delete next[sessionId]; else next[sessionId] = len;
      return next;
    });
    return msg;
  };

  const clearQueue = (sessionId) => {
    messageQueuesRef.current[sessionId] = [];
    setQueueLengths(prev => { const next = { ...prev }; delete next[sessionId]; return next; });
  };

  const togglePause = (sessionId) => {
    const next = new Set(pausedSessionsRef.current);
    if (next.has(sessionId)) {
      next.delete(sessionId);
      pausedSessionsRef.current = next;
      setPausedSessions(next);
      // Resume: immediately process queued message if any
      const nextMsg = dequeueNext(sessionId);
      if (nextMsg) sendMessageCore(sessionId, nextMsg);
    } else {
      next.add(sessionId);
      pausedSessionsRef.current = next;
      setPausedSessions(next);
    }
  };

  const stopSession = (sessionId) => {
    const ctrl = streamAbortControllersRef.current.get(sessionId);
    if (ctrl) {
      ctrl.abort();
      streamAbortControllersRef.current.delete(sessionId);
    }
    setLoadingSessions(prev => { const next = new Set(prev); next.delete(sessionId); return next; });
    setStreamingBySession(prev => { const next = { ...prev }; delete next[sessionId]; return next; });
  };

  const forceSend = (sessionId) => {
    stopSession(sessionId);
    const nextMsg = dequeueNext(sessionId);
    if (nextMsg) setTimeout(() => sendMessageCore(sessionId, nextMsg), 50);
  };

  // Core send: sends one message directly to the API, then processes the queue on completion.
  const sendMessageCore = async (sessionId, messageText) => {
    const optimisticMsg = { role: 'user', content: messageText, timestamp: new Date() };
    if (sessionId === activeSession) {
      setActiveSessionMessages(prev => [...prev, optimisticMsg]);
    }
    setLoadingSessions(prev => new Set([...prev, sessionId]));
    setStreamingBySession(prev => ({ ...prev, [sessionId]: '' }));

    const controller = new AbortController();
    streamAbortControllersRef.current.set(sessionId, controller);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, useSafeMode: useNemoClaw }),
        signal: controller.signal
      });

      if (!res.ok || !res.body) throw new Error(`Stream request failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const event = JSON.parse(json);
            if (event.type === 'token') {
              accumulated += event.content;
              setStreamingBySession(prev => ({ ...prev, [sessionId]: accumulated }));
            } else if (event.type === 'done' || event.type === 'error') {
              if (event.type === 'error') console.error('LLM stream error:', event.message);
              setStreamingBySession(prev => { const next = { ...prev }; delete next[sessionId]; return next; });
              fetchSessions();
              fetchSessionDetails(sessionId);
            }
          } catch { /* skip malformed SSE line */ }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Error sending message via stream, falling back:', error);
        try {
          const res = await fetch(`/api/sessions/${sessionId}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: messageText, useSafeMode: useNemoClaw })
          });
          const data = await res.json();
          fetchSessions();
          fetchSessionDetails(sessionId);
          if (!data.success) console.error('LLM error:', data.response);
        } catch (fbErr) {
          console.error('Fallback also failed:', fbErr);
          if (sessionId === activeSession) {
            setActiveSessionMessages(prev => prev.filter(m => m !== optimisticMsg));
          }
        }
      }
    } finally {
      streamAbortControllersRef.current.delete(sessionId);
      setLoadingSessions(prev => { const next = new Set(prev); next.delete(sessionId); return next; });
      setStreamingBySession(prev => { const next = { ...prev }; delete next[sessionId]; return next; });
      // Auto-process next queued message for this session (if not paused)
      if (!pausedSessionsRef.current.has(sessionId)) {
        const nextMsg = dequeueNext(sessionId);
        if (nextMsg) setTimeout(() => sendMessageCore(sessionId, nextMsg), 50);
      }
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    const sessionId = activeSession;
    if (!sessionId || !messageInput.trim()) return;
    const message = messageInput.trim();
    setMessageInput('');

    if (loadingSessions.has(sessionId)) {
      // Session already streaming — queue the message
      enqueueMessage(sessionId, message);
      return;
    }
    sendMessageCore(sessionId, message);
  };

  const handleMessageInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (activeSession && messageInput.trim()) sendMessage(e);
    }
  };

  const switchEndpoint = async (endpoint, model) => {
    if (!activeSession) return;
    try {
      const res = await fetch(`/api/sessions/${activeSession}/model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, model })
      });
      const data = await res.json();
      if (!data.success) {
        console.error('Error switching endpoint:', data.error || data.message || 'Unknown error');
        return;
      }

      setCurrentEndpoint(endpoint);
      setCurrentModel(model);
      fetchSessions();
    } catch (error) { console.error('Error switching endpoint:', error); }
  };

  const handleEndpointSelection = (endpoint) => {
    const model = getPreferredModelForEndpoint(endpoint);
    setCurrentEndpoint(endpoint);
    setCurrentModel(model);
    switchEndpoint(endpoint, model);
  };

  const deleteSession = async (id) => {
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (activeSession === id) setActiveSession(null);
      fetchSessions();
    } catch (error) { console.error('Error deleting session:', error); }
  };

  const sendFeedback = async (messageIndex, positive) => {
    if (!activeSession) return;
    const targetMessage = activeSessionMessages[messageIndex];
    if (!targetMessage || targetMessage.role !== 'assistant' || targetMessage.feedback) {
      return;
    }

    try {
      const res = await fetch(`/api/sessions/${activeSession}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIndex, positive })
      });

      const data = await res.json();
      if (!data.success) {
        console.error('Error sending feedback:', data.error || 'Unknown error');
        return;
      }

      const feedbackValue = positive ? 'up' : 'down';
      setActiveSessionMessages((prev) => prev.map((msg, idx) => (
        idx === messageIndex ? { ...msg, feedback: feedbackValue } : msg
      )));
    } catch (error) { console.error('Error sending feedback:', error); }
  };

  const createTask = async () => {
    if (!taskTitle.trim()) return;

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle.trim(),
          priority: taskPriority,
          sessionId: activeSession || null
        })
      });

      const data = await res.json();
      if (!data.success) {
        console.error('Error creating task:', data.error || 'Unknown error');
        return;
      }

      setTaskTitle('');
      setTaskPriority('medium');
      fetchTasks();
    } catch (error) {
      console.error('Error creating task:', error);
    }
  };

  const updateTaskStatus = async (taskId, status) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (!data.success) {
        console.error('Error updating task status:', data.error || 'Unknown error');
        return;
      }
      fetchTasks();
    } catch (error) {
      console.error('Error updating task status:', error);
    }
  };

  const routeTaskToSession = async (taskId) => {
    if (!activeSession) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession })
      });
      const data = await res.json();
      if (!data.success) {
        console.error('Error routing task:', data.error || 'Unknown error');
        return;
      }
      fetchTasks();
    } catch (error) {
      console.error('Error routing task:', error);
    }
  };

  const dispatchTask = async (task) => {
    try {
      const availableEndpoints = getAvailableEndpoints(selectedExperience);
      const endpoint = availableEndpoints.includes(currentEndpoint) ? currentEndpoint : availableEndpoints[0];
      const model = getPreferredModelForEndpoint(endpoint);
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experience: selectedExperience, endpoint, model })
      });
      const data = await res.json();
      const sessionId = data.session?.id;
      if (!sessionId) return;
      // Update task status
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress', sessionId })
      });
      // Load session into state before switching
      await fetchSessions();
      await fetchSessionDetails(sessionId);
      setActiveSession(sessionId);
      // Switch to chat (or split view shows both)
      if (wsLayout === 'single') setActiveTab('chat');
      // Send via streaming path
      sendMessageCore(sessionId, task.title);
      fetchTasks();
    } catch (err) { console.error('dispatchTask failed:', err); }
  };

  const deleteTask = async (taskId) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) {
        console.error('Error deleting task:', data.error || 'Unknown error');
        return;
      }
      fetchTasks();
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────
  const activeSessionData = activeSession ? sessions.find(s => s.id === activeSession) : null;

  useEffect(() => {
    if (!showNewSessionMenu) return;
    const handle = (e) => { if (!newSessionMenuRef.current?.contains(e.target)) setShowNewSessionMenu(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showNewSessionMenu]);

  useEffect(() => {
    if (!wsGitPopover) return;
    const handle = (e) => { if (!wsGitPopoverRef.current?.contains(e.target)) setWsGitPopover(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [wsGitPopover]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSessionMessages]);

  useEffect(() => {
    setActiveSessionMessages([]);
    if (activeSession) fetchSessionDetails(activeSession);
  }, [activeSession]);

  useEffect(() => {
    const availableEndpoints = getAvailableEndpoints(activeSessionData?.experience || selectedExperience);
    const onlineEndpoints = availableEndpoints.filter((key) => {
      const endpointStatus = dockerStatus?.endpoints?.[key];
      return endpointStatus ? endpointStatus.live === true : true;
    });
    const endpointPool = onlineEndpoints.length ? onlineEndpoints : availableEndpoints;

    if (!endpointPool.includes(currentEndpoint)) {
      const nextEndpoint = endpointPool[0];
      setCurrentEndpoint(nextEndpoint);
      setCurrentModel(allEndpointMeta[nextEndpoint]?.model || ENDPOINT_META.primary.model);
    }
  }, [activeSessionData, currentEndpoint, dockerStatus, getAvailableEndpoints, selectedExperience]);

  const visibleEndpointKeys = getAvailableEndpoints(activeSessionData?.experience || selectedExperience);
  const selectableEndpointKeys = visibleEndpointKeys.filter((key) => {
    const endpointStatus = dockerStatus?.endpoints?.[key];
    return endpointStatus ? endpointStatus.live === true : true;
  });
  // Count all services: docker containers + standalone tool services
  const allServiceEntries = [
    ...Object.values(dockerStatus?.containers || {}),
    ...Object.entries(systemServices?.services || {})
      .filter(([k]) => !(dockerStatus?.containers || {})[k] && k !== 'docker-runner')
      .map(([, v]) => v),
  ];
  const runningServices = allServiceEntries.filter(s => s.running).length;
  const totalServices = allServiceEntries.length;

  const dismissOnboarding = () => {
    localStorage.setItem('agent_board_onboarding_dismissed', '1');
    setShowOnboarding(false);
  };

  const [expandedSvcs, setExpandedSvcs] = React.useState({});

  // ── Metrics helpers ────────────────────────────────────────────────────────
  const renderBar = (value, max, color = 'var(--green)') => {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return (
      <div className="metric-bar-track">
        <div className="metric-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">🤖 Agent Board</span>
          <div className="topbar-tabs">
            <button
              className={`icon-btn ${(activeTab === 'chat' && wsLayout === 'single') ? 'active' : ''}`}
              onClick={() => { setActiveTab('chat'); setWsLayout('single'); }}
              title="Chat"
            >💬</button>
            <button
              className={`icon-btn ${(activeTab === 'workspace' && wsLayout === 'single') ? 'active' : ''}`}
              onClick={() => { setActiveTab('workspace'); setWsLayout('single'); browseWorkspace(''); refreshWorkspaceGit(); fetchBranches(); fetchArtifacts(); }}
              title="Workspace"
            >🗂️</button>
            <button
              className={`icon-btn ${wsLayout === 'split-h' ? 'active' : ''}`}
              onClick={() => { setWsLayout('split-h'); browseWorkspace(''); refreshWorkspaceGit(); fetchBranches(); }}
              title="Split view — side by side"
            >⊟</button>
            <button
              className={`icon-btn ${wsLayout === 'split-v' ? 'active' : ''}`}
              onClick={() => { setWsLayout('split-v'); browseWorkspace(''); refreshWorkspaceGit(); fetchBranches(); }}
              title="Split view — stacked"
            >⊠</button>
          </div>
          <div className="topbar-divider" />
        </div>

        <div className="topbar-center">
          {demoMode.enabled && <span className="pill pill-demo">Demo</span>}

          {/* New session dropdown — first in center */}
          <div className="topbar-new-wrap" ref={newSessionMenuRef}>
            <button
              className="topbar-new-btn"
              onClick={() => setShowNewSessionMenu(p => !p)}
            >+ New ▾</button>
            {showNewSessionMenu && (
              <div className="topbar-new-panel">
                <div className="topbar-new-summary">
                  {EXPERIENCE_META[selectedExperience]?.icon} {EXPERIENCE_META[selectedExperience]?.name}
                  <span className="topbar-new-dot">·</span>
                  {allEndpointMeta[selectableEndpointKeys.includes(currentEndpoint) ? currentEndpoint : (selectableEndpointKeys[0] || currentEndpoint)]?.label || currentEndpoint}
                </div>
                <button
                  className="btn-primary"
                  style={{ width: '100%', fontSize: '0.8rem', marginTop: '0.2rem' }}
                  onClick={() => { createSession(); setShowNewSessionMenu(false); }}
                >
                  Create Session
                </button>
              </div>
            )}
          </div>

          {/* Experience dropdown */}
          <select
            className="topbar-select"
            value={selectedExperience}
            onChange={e => setSelectedExperience(e.target.value)}
            disabled={demoMode.enabled}
            title="Switch experience"
          >
            {Object.entries(EXPERIENCE_META)
              .filter(([key]) => !demoMode.enabled || key === 'safechat')
              .map(([key, exp]) => (
                <option key={key} value={key}>{exp.icon} {exp.name}</option>
              ))}
          </select>

          {/* Model dropdown (purple) */}
          <select
            className="topbar-select topbar-select-model"
            value={selectableEndpointKeys.includes(currentEndpoint) ? currentEndpoint : (selectableEndpointKeys[0] || '')}
            onChange={e => handleEndpointSelection(e.target.value)}
            disabled={selectableEndpointKeys.length === 0 || demoMode.enabled}
            title="Switch model"
          >
            {selectableEndpointKeys.length === 0 ? (
              <option value="">No models online</option>
            ) : selectableEndpointKeys.map(key => (
              <option key={key} value={key}>{allEndpointMeta[key]?.label || key}</option>
            ))}
          </select>

          {/* Session switcher */}
          {sessions.length > 0 && (
            <select
              className="topbar-select topbar-select-session"
              value={activeSession || ''}
              onChange={e => { if (e.target.value) { setActiveSession(e.target.value); fetchSessionDetails(e.target.value); } }}
              title="Switch session"
            >
              {!activeSession && <option value="">Select session…</option>}
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="topbar-right">
          {/* Live feed: pulsing dot only */}
          <span className={`live-dot-wrap ${wsConnected ? 'live' : 'offline'}`} title={wsConnected ? 'Live feed connected' : 'Offline'}>
            <span className="live-dot" />
          </span>

          {/* 📊 Metrics panel toggle */}
          <button
            className={`icon-btn ${showMetricsPanel ? 'active' : ''}`}
            onClick={() => {
              setShowMetricsPanel(p => { if (!p) setShowSystemPanel(false); return !p; });
            }}
            title="Metrics"
          >📊</button>

          {/* Combined ⚙️ + service count */}
          <button
            className={`icon-btn svc-cog-btn ${showSystemPanel ? 'active' : ''}`}
            onClick={() => {
              setShowSystemPanel(prev => {
                const next = !prev;
                if (next) {
                  setShowMetricsPanel(false);
                  if (dockerStatus?.workspace?.configured) {
                    browseWorkspace('');
                    refreshWorkspaceGit();
                  }
                  fetchContentClients();
                }
                return next;
              });
            }}
            title={`System — ${runningServices}/${totalServices} services`}
          >⚙️ <span className="svc-cog-count">{totalServices > 0 ? `${runningServices}/${totalServices}` : '…'}</span></button>
        </div>
      </div>

      {showOnboarding && (
        <div className="onboarding-strip">
          <div className="onboarding-copy">
            <strong>Welcome to Agent Board.</strong>
            <span>
              Choose an experience, pick a model, then click <strong>+ New ▾</strong> to create a session.
              {totalServices > 0 && ` ${runningServices}/${totalServices} services are live.`}
              {demoMode.enabled && ' Demo mode is locked to Safe Chat and the primary model endpoint.'}
            </span>
          </div>
          <div className="onboarding-actions">
            <button className="btn-primary" onClick={createSession}>Create Session</button>
            <button className="btn-secondary" onClick={dismissOnboarding}>Dismiss</button>
          </div>
        </div>
      )}

      <div className="layout">
        {/* Main content: workspace, chat, or split layout */}
        <div className={`content${wsLayout !== 'single' ? ` layout-${wsLayout}` : ''}`}>
          {(wsLayout !== 'single' || activeTab === 'workspace') && (
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

                      {/* Search bar */}
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

                      {/* Create input */}
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

                      {/* Breadcrumb */}
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

                      {/* File / search results */}
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

              {/* ── Bottom tabbed panel ───────────────────────────────────── */}
              <div className="ws-bottom-panel-outer">
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

                  {/* TERMINAL */}
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
                          className="ws-term-input"
                          type="text"
                          value={termInput}
                          onChange={e => setTermInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && runTermCommand(termInput)}
                          placeholder={termBusy ? 'Running…' : 'Enter command…'}
                          disabled={termBusy}
                          spellCheck={false}
                          autoComplete="off"
                        />
                        {termBusy && <span className="ws-term-busy">⟳</span>}
                      </div>
                    </div>
                  )}

                  {/* TASKS */}
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

                  {/* ARTIFACTS */}
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

                  {/* OUTPUT */}
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
          )}
          {(wsLayout !== 'single' || activeTab !== 'workspace') && (
            <div className="chat-column">
              {activeSessionData ? (
                <>
                  <div className="chat-header">
                    <h2>{activeSessionData.name}</h2>
                    <div className="chat-meta">
                      {activeSessionData.endpoint} • {activeSessionData.messageCount} messages
                      {loading && <span className="streaming-badge"> ⟳ streaming</span>}
                      {queueLengths[activeSession] > 0 && (
                        <span className="queue-badge">{queueLengths[activeSession]} queued</span>
                      )}
                      {activeSessionData.safetyMode && (
                        <span style={{ marginLeft: '0.5rem', color: SAFETY_COLORS[activeSessionData.safetyMode], fontWeight: 600, fontSize: '0.75rem' }}>
                          🛡 {activeSessionData.safetyMode}
                        </span>
                      )}
                    </div>
                    <div className="chat-header-actions">
                      <button
                        className={`btn-secondary btn-sm ${pausedSessions.has(activeSession) ? 'active' : ''}`}
                        title={pausedSessions.has(activeSession) ? 'Responses paused — click to resume' : 'Pause auto-response'}
                        onClick={() => togglePause(activeSession)}
                      >{pausedSessions.has(activeSession) ? '▶ Resume' : '⏸ Pause'}</button>
                      <button
                        className="btn-secondary btn-sm"
                        title="Delete session"
                        onClick={() => deleteSession(activeSession)}
                      >✕ Delete</button>
                    </div>
                  </div>

                  {EXPERIENCE_TOOLS[activeSessionData.experience] && (
                    <ToolWorkbench
                      toolKey={EXPERIENCE_TOOLS[activeSessionData.experience].toolKey}
                      serviceKey={EXPERIENCE_TOOLS[activeSessionData.experience].serviceKey}
                      onRunService={runServiceAction}
                      serviceActionsInFlight={serviceActionsInFlight}
                    />
                  )}

                  <div className="chat-container">
                    {activeSessionMessages.length > 0 ? (
                      activeSessionMessages.map((msg, index) => (
                        <div key={index} className={`message ${msg.role}`}>
                          <div className="message-content">
                            <span className="message-role">{msg.role === 'user' ? 'You' : 'AI'}</span>
                            {msg.role === 'assistant'
                              ? <Markdown content={msg.content} />
                              : <span className="message-text">{msg.content}</span>
                            }
                            {msg.blocked && (
                              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--red)' }}>
                                [blocked by safety filter]
                              </span>
                            )}
                          </div>
                          {msg.role === 'assistant' && (
                            <div className="message-feedback">
                              {msg.feedback ? (
                                <span className="feedback-saved">
                                  Feedback saved: {msg.feedback === 'up' ? '👍' : '👎'}
                                </span>
                              ) : (
                                <>
                                  <button
                                    className="btn-feedback"
                                    onClick={() => sendFeedback(index, true)}
                                    title="This was helpful"
                                  >👍</button>
                                  <button
                                    className="btn-feedback"
                                    onClick={() => sendFeedback(index, false)}
                                    title="This wasn't helpful"
                                  >👎</button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="messages-placeholder">
                        <p>No messages yet. Start a conversation!</p>
                      </div>
                    )}
                    {loading && streamingContent && (
                      <div className="message assistant streaming">
                        <div className="message-content">
                          <span className="message-role">AI</span>
                          <Markdown content={streamingContent} />
                          <span className="cursor-blink">▍</span>
                        </div>
                      </div>
                    )}
                    {loading && !streamingContent && (
                      <div className="message assistant">
                        <div className="message-content" style={{ opacity: 0.6, fontStyle: 'italic' }}>
                          <span className="message-role">AI</span>
                          <span> Thinking<span className="dot-pulse">...</span></span>
                        </div>
                      </div>
                    )}
                    <div ref={chatBottomRef} />
                  </div>

                  <form className="chat-input-form" onSubmit={sendMessage}>
                    <input
                      type="text"
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      onKeyDown={handleMessageInputKeyDown}
                      placeholder={loading ? 'Type to queue next message…' : 'Type your message…'}
                      maxLength={4000}
                    />
                    <span className="input-counter">{messageInput.length}/4000</span>
                    <select
                      className="select-inline"
                      value={selectableEndpointKeys.includes(currentEndpoint) ? currentEndpoint : (selectableEndpointKeys[0] || '')}
                      onChange={e => handleEndpointSelection(e.target.value)}
                      title="Choose model endpoint"
                      disabled={selectableEndpointKeys.length === 0 || demoMode.enabled}
                    >
                      {selectableEndpointKeys.length === 0 ? (
                        <option value="">No models online</option>
                      ) : (
                        selectableEndpointKeys.map((key) => (
                          <option key={key} value={key}>{allEndpointMeta[key]?.label || key}</option>
                        ))
                      )}
                    </select>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={useNemoClaw}
                        onChange={e => setUseNemoClaw(e.target.checked)}
                      />
                      NemoClaw
                    </label>
                    {loading && queueLengths[activeSession] > 0 && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        title="Stop current response and send next queued message immediately"
                        onClick={() => forceSend(activeSession)}
                      >⚡ Force ({queueLengths[activeSession]})</button>
                    )}
                    {loading && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        title="Stop responding"
                        onClick={() => stopSession(activeSession)}
                      >■ Stop</button>
                    )}
                    <button type="submit" className="btn-send">
                      {loading ? '+ Queue' : 'Send'}
                    </button>
                  </form>
                </>
              ) : (
                <div className="empty-state">
                  <h2>No session selected</h2>
                  <p>Choose an experience and create a session to get started.</p>

                  <div className="experience-options">
                    {Object.entries(EXPERIENCE_META)
                      .filter(([key]) => !demoMode.enabled || key === 'safechat')
                      .map(([key, exp]) => (
                      <div
                        key={key}
                        className={`experience-option ${selectedExperience === key ? 'selected' : ''}`}
                        onClick={() => setSelectedExperience(key)}
                      >
                        <span className="exp-icon">{exp.icon}</span>
                        <div>
                          <div className="exp-name">{exp.name}</div>
                          <div className="exp-desc">{exp.description}</div>
                        </div>
                        {selectedExperience === key && <span className="exp-check">✓</span>}
                      </div>
                    ))}
                  </div>

                  <button className="btn-primary" onClick={createSession} style={{ marginBottom: '1.5rem' }}>
                    + Start a {EXPERIENCE_META[selectedExperience]?.name} Session
                  </button>

                  <div className="endpoint-preview">
                    <h3>Available Endpoints:</h3>
                    <ul>
                      {Object.entries(allEndpointMeta)
                        .filter(([key]) => selectableEndpointKeys.includes(key))
                        .map(([key, { label, desc }]) => {
                        const ep = dockerStatus?.endpoints?.[key];
                        return (
                          <li key={key}>
                            <strong>{label}</strong> — {desc}
                            {ep && <span style={{ marginLeft: '0.4rem', color: ep.live ? 'var(--green)' : 'var(--text-faint)' }}>
                              {ep.live ? '● live' : '● offline'}
                            </span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right drawer: metrics panel */}
        {showMetricsPanel && (
          <aside className="drawer drawer-right drawer-metrics">
            <div className="drawer-header">
              <h2>Metrics</h2>
              <button className="icon-btn" onClick={fetchMetrics} title="Refresh">↻</button>
              <button className="icon-btn" onClick={() => setShowMetricsPanel(false)} title="Close">✕</button>
            </div>

            <div className="metrics-sidebar-cards">
              {[
                { label: 'Sessions', value: metricsSummary?.totalSessions ?? '…' },
                { label: 'Active', value: metricsSummary?.activeSessions ?? '…' },
                { label: 'Messages', value: metricsSummary?.totalMessages ?? '…' },
                { label: 'Blocked', value: metricsSafety?.totalBlocked ?? '…' },
                { label: '👍', value: metricsFeedback?.totalPositive ?? '…' },
                { label: '👎', value: metricsFeedback?.totalNegative ?? '…' },
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
        )}

        {/* Right drawer: system management */}
        {showSystemPanel && (
          <aside className="drawer drawer-right">
            <div className="drawer-header">
              <h2>System</h2>
              <button
                className="icon-btn"
                onClick={toggleTheme}
                title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >{darkMode ? '☀️' : '🌙'}</button>
              <button className="icon-btn" onClick={() => setShowSystemPanel(false)} title="Close">✕</button>
            </div>

            <div className="system-info">
              <div className="system-info-item">
                <h3>Stack Status</h3>
                <div className={`value ${dockerStatus?.dockerRunning ? '' : 'warning'}`}>
                  {dockerStatus?.dockerRunning ? 'Healthy' : 'Degraded'}
                </div>
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

            {(() => {
              const BACKEND_TYPE_LABEL = {
                'ollama-container': 'local', sandbox: 'sandbox', mcp: 'mcp',
                'docker-runner': 'runner', 'openllm-container': 'custom',
              };
              const SVC_ORDER = ['ollama', 'tool_content_gen', 'tool_website', 'docker-runner', 'nemoclaw', 'llm_openllm', 'bb_mcp'];

              const renderServiceRow = (serviceKey, info, endpointData = null) => {
                const canControl = !!(systemServices?.dockerControlEnabled && info.controllable);
                const eps = endpointData || [];
                const typeLabel = BACKEND_TYPE_LABEL[info.backendType] || '';
                const isDisabled = !!info.disabledReason;

                const epErrors = eps
                  .map(({ epKey, ep }) => serviceActionErrors[`pull:${epKey}:${ep.model}`])
                  .filter(Boolean);
                const allErrors = [...epErrors, serviceActionErrors[serviceKey]].filter(Boolean);

                if (!info.running && !expandedSvcs[serviceKey]) {
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
                          <span className={`docker-service-status ${info.running ? 'running' : isDisabled ? 'disabled' : 'stopped'}`}>
                            {info.running ? '● Live' : isDisabled ? '● disabled' : `● ${info.status || 'offline'}`}
                          </span>
                          {!info.running && expandedSvcs[serviceKey] && (
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
                              {ep.live && !installed && ep.model && <span style={{ color: 'var(--text-faint)', fontSize: '0.67rem' }}>· not pulled</span>}
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
                                  onClick={() => pullModel(epKey, ep.model)}
                                >{pulling ? '…' : isOnlineNotInstalled ? 'Re-pull' : 'Pull'}</button>
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
                                onClick={() => runServiceAction(serviceKey, 'restart')}
                              >{serviceActionsInFlight[`${serviceKey}:restart`] ? '…' : '↺'}</button>
                              <button
                                className="btn-service-icon stop-btn"
                                disabled={serviceActionsInFlight[`${serviceKey}:stop`]}
                                title="Stop"
                                onClick={() => runServiceAction(serviceKey, 'stop')}
                              >{serviceActionsInFlight[`${serviceKey}:stop`] ? '…' : '■'}</button>
                            </>
                          ) : (
                            <button
                              className="btn-service-icon start-btn"
                              disabled={serviceActionsInFlight[`${serviceKey}:start`]}
                              title="Start"
                              onClick={() => runServiceAction(serviceKey, 'start')}
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
              // Live first → stopped/unavailable → disabled; preserve preferred order within each tier
              allSvcs.sort((a, b) => {
                const r = info => info.running ? 0 : info.disabledReason ? 2 : 1;
                const dr = r(a.info) - r(b.info);
                if (dr) return dr;
                const pa = SVC_ORDER.indexOf(a.key), pb = SVC_ORDER.indexOf(b.key);
                return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
              });

              return (
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
              );
            })()}
          </aside>
        )}
      </div>
    </div>
  );
}

export default App;
