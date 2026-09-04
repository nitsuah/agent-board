import axios from 'axios';
import { randomUUID } from 'crypto';
import { stat, readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { resolve as resolvePath } from 'path';
import { mcpRequest } from './mcp-helpers.js';

export const DEVELOPER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command inside WORKSPACE_ROOT. Returns stdout and stderr. Use for file ops, git, npm, node, etc.',
      parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to run.' } }, required: ['command'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file in the workspace and return its text content.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path inside workspace.' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file in the workspace. For documents, reports, summaries, research notes, and other output artifacts, use the artifacts/ subdirectory (e.g. artifacts/report.md). Source code and configuration go in their natural project locations.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path inside workspace. Use artifacts/ prefix for output documents and reports.' },
          content: { type: 'string', description: 'Content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories at a path inside the workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path (default: workspace root).', default: '' } } },
    },
  },
];

export const RESEARCH_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web via DuckDuckGo Instant Answers. Returns abstract, related topics, and direct answer if available.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query.' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_artifact',
      description: 'Save a research artifact (notes, outline, summary) to workspace/artifacts/.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Artifact filename (e.g. "report.md").' },
          content: { type: 'string', description: 'Artifact text content.' },
        },
        required: ['filename', 'content'],
      },
    },
  },
];

export const WEBSITE_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'discover_leads',
      description: 'Find local businesses in a location that may need a website.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City/area to search (e.g. "Austin TX").' },
          business_type: { type: 'string', description: 'Category of business (e.g. "restaurant").' },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_website_file',
      description: 'Save a generated HTML/CSS/JS file for a client site under their slug.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Client slug (e.g. "joes-pizza-90210").' },
          filename: { type: 'string', description: 'File to save (e.g. "index.html").' },
          content: { type: 'string', description: 'File content.' },
        },
        required: ['slug', 'filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_website_files',
      description: 'List saved files for a client site slug.',
      parameters: {
        type: 'object',
        properties: { slug: { type: 'string', description: 'Client slug.' } },
        required: ['slug'],
      },
    },
  },
];

const BASH_BLOCKLIST = ['rm -rf /', 'dd if=', ':(){ :|:& };:', '> /dev/sd', 'mkfs'];

// Plugin tools are exposed to the model as `<plugin>__<tool>` (double underscore —
// plugin/tool names are already restricted to [a-zA-Z0-9_-], so this separator can't
// collide with a real name) since OpenAI/Ollama function-call names reject the `.`
// used in the qualifiedName shown over the /api/plugins HTTP API.
const PLUGIN_TOOL_SEPARATOR = '__';
const PLUGIN_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

export function createAgentHelpers({ WORKSPACE_ROOT, execAsync, TOOL_SERVERS, TOOL_CALL_TIMEOUT_MS, pluginRegistry = null }) {
  function resolveWorkspacePath(reqPath) {
    if (!WORKSPACE_ROOT) return null;
    const safe = reqPath ? reqPath.replace(/\\/g, '/').replace(/^\/+/, '') : '';
    const abs = resolvePath(WORKSPACE_ROOT, safe);
    if (abs !== WORKSPACE_ROOT && !abs.startsWith(WORKSPACE_ROOT + '/')) return null;
    return abs;
  }

  /** Enabled plugin tools, shaped as OpenAI/Ollama function-call definitions. */
  function pluginToolDefinitions() {
    if (!pluginRegistry) return [];
    return pluginRegistry.listTools().map(t => ({
      type: 'function',
      function: {
        name: `${t.plugin}${PLUGIN_TOOL_SEPARATOR}${t.name}`,
        description: `[Plugin: ${t.plugin}] ${t.description || ''}`.slice(0, 1024),
        parameters: (t.parameters && typeof t.parameters === 'object' && Object.keys(t.parameters).length)
          ? t.parameters
          : { type: 'object', properties: {} },
      },
    }));
  }

  /** Resolve a `<plugin>__<tool>` function-call name back to its registry entry. */
  function resolvePluginTool(toolName) {
    if (!pluginRegistry || !toolName.includes(PLUGIN_TOOL_SEPARATOR)) return null;
    return pluginRegistry.listTools().find(t => `${t.plugin}${PLUGIN_TOOL_SEPARATOR}${t.name}` === toolName) || null;
  }

  async function callPluginTool(pluginName, toolName, args) {
    const plugin = pluginRegistry?.get(pluginName);
    if (!plugin || !plugin.enabled) return JSON.stringify({ error: `Plugin unavailable: ${pluginName}` });
    const tool = pluginRegistry.getTool(pluginName, toolName);
    if (!tool) return JSON.stringify({ error: `Unknown tool "${toolName}" on plugin "${pluginName}"` });
    try {
      const isBodyless = tool.method === 'GET' || tool.method === 'DELETE';
      const response = await axios({
        method: tool.method,
        url: tool.endpoint,
        timeout: tool.timeoutMs,
        maxRedirects: 0,
        maxContentLength: PLUGIN_RESPONSE_MAX_BYTES,
        maxBodyLength: PLUGIN_RESPONSE_MAX_BYTES,
        validateStatus: () => true,
        ...(isBodyless ? { params: args } : { data: args }),
      });
      const ok = response.status >= 200 && response.status < 300;
      return JSON.stringify({
        success: ok,
        status: response.status,
        result: response.data,
        error: ok ? undefined : `Plugin backend returned ${response.status}`,
      });
    } catch (err) {
      return JSON.stringify({ error: `Plugin backend unreachable: ${err.message}` });
    }
  }

  // Plugin tools layer onto every tool-using experience (developer/research/website).
  // 'default' (plain chat / Safe Chat) intentionally gets no tools at all, plugin or
  // otherwise, so enabling a plugin never changes chat/safety behavior there.
  function getExperienceTools(experience) {
    const TOOL_USING_EXPERIENCES = new Set(['developer', 'research', 'website']);
    const base = (() => {
      switch (experience) {
        case 'developer': return WORKSPACE_ROOT ? DEVELOPER_TOOLS : [];
        case 'research': return RESEARCH_TOOLS;
        case 'website': return WEBSITE_AGENT_TOOLS;
        default: return [];
      }
    })();
    if (!TOOL_USING_EXPERIENCES.has(experience)) return base;
    const plugins = pluginToolDefinitions();
    return plugins.length ? [...base, ...plugins] : base;
  }

  async function callAgentTool(toolName, toolArgs, session) {
    try {
      if (toolName === 'bash') {
        if (!WORKSPACE_ROOT) return JSON.stringify({ error: 'Workspace not mounted (WORKSPACE_ROOT not set)' });
        const { command } = toolArgs;
        if (BASH_BLOCKLIST.some(p => String(command).includes(p))) {
          return JSON.stringify({ error: 'Command blocked by safety policy' });
        }
        try {
          const { stdout, stderr } = await execAsync(String(command), { cwd: WORKSPACE_ROOT, timeout: 30000, shell: true });
          return JSON.stringify({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 });
        } catch (err) {
          return JSON.stringify({ stdout: (err.stdout || '').trim(), stderr: (err.stderr || err.message).trim(), exitCode: err.code || 1 });
        }
      }

      if (toolName === 'read_file') {
        if (!WORKSPACE_ROOT) return JSON.stringify({ error: 'Workspace not mounted' });
        const abs = resolveWorkspacePath(toolArgs.path);
        if (!abs) return JSON.stringify({ error: 'Invalid path (path traversal detected)' });
        try {
          const s = await stat(abs);
          if (s.size > 512 * 1024) return JSON.stringify({ error: 'File too large (> 512 KB)' });
          const content = await readFile(abs, 'utf8');
          return JSON.stringify({ content, path: toolArgs.path });
        } catch (err) {
          return JSON.stringify({ error: err.message });
        }
      }

      if (toolName === 'write_file') {
        if (!WORKSPACE_ROOT) return JSON.stringify({ error: 'Workspace not mounted' });
        const abs = resolveWorkspacePath(toolArgs.path);
        if (!abs) return JSON.stringify({ error: 'Invalid path' });
        try {
          await mkdir(resolvePath(abs, '..'), { recursive: true });
          await writeFile(abs, String(toolArgs.content), 'utf8');
          return JSON.stringify({ success: true, path: toolArgs.path, bytes: Buffer.byteLength(String(toolArgs.content), 'utf8') });
        } catch (err) {
          return JSON.stringify({ error: err.message });
        }
      }

      if (toolName === 'list_files') {
        if (!WORKSPACE_ROOT) return JSON.stringify({ error: 'Workspace not mounted' });
        const abs = resolveWorkspacePath(toolArgs.path || '');
        if (!abs) return JSON.stringify({ error: 'Invalid path' });
        try {
          const entries = await readdir(abs, { withFileTypes: true });
          return JSON.stringify({ entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' })) });
        } catch (err) {
          return JSON.stringify({ error: err.message });
        }
      }

      if (toolName === 'web_search') {
        const query = String(toolArgs.query || '').slice(0, 200);
        const resp = await axios.get(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
          { timeout: 8000 }
        );
        const d = resp.data;
        return JSON.stringify({
          answer: d.Answer || '',
          abstract: d.AbstractText || '',
          abstractSource: d.AbstractSource || '',
          abstractUrl: d.AbstractURL || '',
          relatedTopics: (d.RelatedTopics || []).slice(0, 6).map(t => ({ text: t.Text, url: t.FirstURL })).filter(t => t.text),
        });
      }

      if (toolName === 'write_artifact') {
        if (!WORKSPACE_ROOT) return JSON.stringify({ error: 'Workspace not mounted' });
        const filename = String(toolArgs.filename || 'artifact.md').replace(/[/\\]/g, '-');
        const abs = resolvePath(WORKSPACE_ROOT, 'artifacts', filename);
        if (!abs.startsWith(WORKSPACE_ROOT)) return JSON.stringify({ error: 'Invalid filename' });
        try {
          await mkdir(resolvePath(abs, '..'), { recursive: true });
          await writeFile(abs, String(toolArgs.content), 'utf8');
          return JSON.stringify({ success: true, path: `artifacts/${filename}` });
        } catch (err) {
          return JSON.stringify({ error: err.message });
        }
      }

      if (toolName === 'save_website_file') {
        const result = await mcpRequest(TOOL_SERVERS.website.url, 'tools/call', {
          name: 'save_file',
          arguments: { slug: toolArgs.slug, filename: toolArgs.filename, content: toolArgs.content },
        }, TOOL_CALL_TIMEOUT_MS);
        const text = (result?.content || []).filter(i => i?.type === 'text').map(i => i.text).join('\n');
        return JSON.stringify({ success: true, content: text || 'File saved.' });
      }

      if (toolName === 'list_website_files') {
        const result = await mcpRequest(TOOL_SERVERS.website.url, 'tools/call', {
          name: 'list_client_files',
          arguments: { slug: toolArgs.slug },
        }, TOOL_CALL_TIMEOUT_MS);
        const text = (result?.content || []).filter(i => i?.type === 'text').map(i => i.text).join('\n');
        return JSON.stringify({ files: text });
      }

      if (toolName === 'discover_leads') {
        const result = await mcpRequest(TOOL_SERVERS.website.url, 'tools/call', {
          name: 'discover_leads',
          arguments: { location: toolArgs.location, business_type: toolArgs.business_type },
        }, TOOL_CALL_TIMEOUT_MS);
        const text = (result?.content || []).filter(i => i?.type === 'text').map(i => i.text).join('\n');
        return JSON.stringify({ leads: text });
      }

      const pluginTool = resolvePluginTool(toolName);
      if (pluginTool) {
        return await callPluginTool(pluginTool.plugin, pluginTool.name, toolArgs);
      }

      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    } catch (err) {
      return JSON.stringify({ error: err.message });
    }
  }

  const TOOL_RESULT_MAX_CHARS = 8000;
  const MAX_CONSECUTIVE_TOOL_ERRORS = 3;

  function capToolResult(result) {
    if (result.length <= TOOL_RESULT_MAX_CHARS) return result;
    const truncated = result.slice(0, TOOL_RESULT_MAX_CHARS);
    try {
      const parsed = JSON.parse(result);
      const capped = { ...parsed, _truncated: true, _originalLength: result.length };
      if (parsed.stdout) capped.stdout = parsed.stdout.slice(0, TOOL_RESULT_MAX_CHARS - 200) + '\n[truncated]';
      if (parsed.content) capped.content = parsed.content.slice(0, TOOL_RESULT_MAX_CHARS - 200) + '\n[truncated]';
      const out = JSON.stringify(capped);
      return out.length <= TOOL_RESULT_MAX_CHARS ? out : out.slice(0, TOOL_RESULT_MAX_CHARS) + '\n[truncated]';
    } catch {
      return truncated + '\n[truncated]';
    }
  }

  async function runAgentLoop(msgs, apiStyle, llmUrl, llmHeaders, tools, session) {
    const MAX_ITERATIONS = 5;
    const toolLog = [];
    const localMsgs = [...msgs];
    let consecutiveErrors = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const reqBody = { model: session.model, messages: localMsgs, stream: false };
      if (tools.length > 0) reqBody.tools = tools;

      const response = await (apiStyle === 'openai'
        ? axios.post(`${llmUrl}/chat/completions`, reqBody, { headers: llmHeaders, timeout: 120000 })
        : axios.post(`${llmUrl}/api/chat`, reqBody, { headers: llmHeaders, timeout: 120000 }));

      const msg = response.data.message || response.data.choices?.[0]?.message;
      const toolCalls = msg?.tool_calls || [];

      if (toolCalls.length === 0) {
        return { content: msg?.content || 'No response received', toolLog };
      }

      localMsgs.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });

      for (const tc of toolCalls) {
        const name = tc.function?.name || tc.name;
        const rawArgs = tc.function?.arguments || tc.arguments || '{}';
        const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
        const callId = tc.id || randomUUID();

        const rawResult = await callAgentTool(name, args, session);
        const result = capToolResult(rawResult);

        let parsed;
        try { parsed = JSON.parse(result); } catch { parsed = { raw: result }; }

        if (parsed?.error) {
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) {
            toolLog.push({ name, args, result: parsed, callId, aborted: true });
            return { content: `Tool loop aborted after ${consecutiveErrors} consecutive errors. Last error: ${parsed.error}`, toolLog };
          }
        } else {
          consecutiveErrors = 0;
        }

        toolLog.push({ name, args, result: parsed, callId });

        if (apiStyle === 'openai') {
          localMsgs.push({ role: 'tool', tool_call_id: callId, content: result });
        } else {
          localMsgs.push({ role: 'tool', content: result });
        }
      }
    }

    const reqBody = { model: session.model, messages: localMsgs, stream: false };
    const response = await (apiStyle === 'openai'
      ? axios.post(`${llmUrl}/chat/completions`, reqBody, { headers: llmHeaders, timeout: 120000 })
      : axios.post(`${llmUrl}/api/chat`, reqBody, { headers: llmHeaders, timeout: 120000 }));
    const msg = response.data.message || response.data.choices?.[0]?.message;
    return { content: msg?.content || 'No response received', toolLog };
  }

  return { getExperienceTools, runAgentLoop };
}
