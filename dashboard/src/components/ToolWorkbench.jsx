import React, { useState, useEffect, useCallback } from 'react';
import ToolField from './ToolField.jsx';

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

export default ToolWorkbench;
