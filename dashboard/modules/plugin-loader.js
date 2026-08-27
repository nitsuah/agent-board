/**
 * Plugin loader — declarative extension points for the agent-board dashboard.
 *
 * Plugins are JSON manifests dropped into `dashboard/config/plugins/*.plugin.json`
 * (override the directory with AGENT_BOARD_PLUGINS_DIR). Each manifest declares
 * the tools the plugin provides and the events it emits. Nothing is executed at
 * load time — a manifest is pure data, so a malformed or hostile file can only
 * ever be rejected, never run.
 *
 * This mirrors the config/mcp-registry.json pattern: operators extend the
 * dashboard by adding a file, not by editing core server code.
 *
 * Manifest shape (v1):
 * {
 *   "manifestVersion": 1,
 *   "name": "example-echo",           // ^[a-z0-9][a-z0-9_-]{0,63}$ — unique
 *   "version": "1.0.0",               // semver
 *   "description": "…",
 *   "enabled": true,                  // default true
 *   "baseUrl": "http://host:3300",    // default host for tools (env-expandable)
 *   "tools": [
 *     {
 *       "name": "echo",               // ^[a-zA-Z0-9_-]{1,64}$ — unique per plugin
 *       "description": "…",
 *       "transport": "http",          // only "http" is supported today
 *       "method": "POST",             // GET|POST|PUT|PATCH|DELETE
 *       "path": "/echo",              // appended to url ?? baseUrl
 *       "url": "http://other:1234",   // optional per-tool host override
 *       "timeoutMs": 15000,           // optional, clamped to 1s..120s
 *       "parameters": { … }           // free-form JSON schema, passed to agents
 *     }
 *   ],
 *   "events": {
 *     "channel": "plugins",           // event-bus channel for emitted events
 *     "emits": ["example.echo.done"]  // allow-list of event types
 *   }
 * }
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PLUGIN_MANIFEST_VERSION = 1;
export const DEFAULT_PLUGINS_DIR =
  process.env.AGENT_BOARD_PLUGINS_DIR || join(__dirname, '..', 'config', 'plugins');

const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const EVENT_TYPE_RE = /^[a-zA-Z0-9_\-.]{1,128}$/;
const CHANNEL_RE = /^[a-zA-Z0-9_\-.]{1,128}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/;
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SUPPORTED_TRANSPORTS = new Set(['http']);

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CHANNEL = 'plugins';

/** Expand ${VAR} / ${VAR:-default} — same single-pass form used by mcp-registry.js */
export function expandEnv(raw, env = process.env) {
  return raw.replace(/\$\{(\w+)(?::-(.*?))?\}/g, (_, name, fallback = '') => env[name] || fallback);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clampTimeout(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(Math.floor(n), MAX_TIMEOUT_MS));
}

/**
 * Validate + normalize a parsed manifest.
 * Returns { valid: true, plugin } or { valid: false, errors: string[] }.
 * Pure: no I/O, no side effects — directly unit-testable.
 */
export function validateManifest(manifest, { source = 'unknown' } = {}) {
  const errors = [];
  if (!isPlainObject(manifest)) {
    return { valid: false, errors: ['manifest must be a JSON object'] };
  }

  const manifestVersion = manifest.manifestVersion ?? PLUGIN_MANIFEST_VERSION;
  if (manifestVersion !== PLUGIN_MANIFEST_VERSION) {
    errors.push(`unsupported manifestVersion ${manifestVersion} (expected ${PLUGIN_MANIFEST_VERSION})`);
  }

  const name = typeof manifest.name === 'string' ? manifest.name.trim() : '';
  if (!PLUGIN_NAME_RE.test(name)) {
    errors.push(`invalid plugin name "${manifest.name}" (expected ${PLUGIN_NAME_RE})`);
  }

  const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
  if (!SEMVER_RE.test(version)) {
    errors.push(`invalid version "${manifest.version}" (expected semver, e.g. 1.0.0)`);
  }

  const baseUrl = typeof manifest.baseUrl === 'string' ? manifest.baseUrl.trim().replace(/\/+$/, '') : '';
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    errors.push(`baseUrl must be http(s): "${baseUrl}"`);
  }

  const rawTools = manifest.tools;
  const tools = [];
  if (rawTools !== undefined && !Array.isArray(rawTools)) {
    errors.push('tools must be an array');
  } else {
    const seenToolNames = new Set();
    for (const [i, rawTool] of (rawTools || []).entries()) {
      if (!isPlainObject(rawTool)) { errors.push(`tools[${i}] must be an object`); continue; }

      const toolName = typeof rawTool.name === 'string' ? rawTool.name.trim() : '';
      if (!TOOL_NAME_RE.test(toolName)) { errors.push(`tools[${i}].name invalid: "${rawTool.name}"`); continue; }
      if (seenToolNames.has(toolName)) { errors.push(`tools[${i}] duplicate tool name "${toolName}"`); continue; }
      seenToolNames.add(toolName);

      const transport = String(rawTool.transport || 'http').toLowerCase();
      if (!SUPPORTED_TRANSPORTS.has(transport)) {
        errors.push(`tools[${i}] "${toolName}" unsupported transport "${transport}"`);
        continue;
      }

      const method = String(rawTool.method || 'POST').toUpperCase();
      if (!HTTP_METHODS.has(method)) {
        errors.push(`tools[${i}] "${toolName}" unsupported method "${method}"`);
        continue;
      }

      const toolUrl = typeof rawTool.url === 'string' ? rawTool.url.trim().replace(/\/+$/, '') : '';
      if (toolUrl && !/^https?:\/\//i.test(toolUrl)) {
        errors.push(`tools[${i}] "${toolName}" url must be http(s)`);
        continue;
      }
      const host = toolUrl || baseUrl;
      if (!host) {
        errors.push(`tools[${i}] "${toolName}" needs a url or a plugin-level baseUrl`);
        continue;
      }

      const path = typeof rawTool.path === 'string' ? rawTool.path.trim() : '';
      if (path && !path.startsWith('/')) {
        errors.push(`tools[${i}] "${toolName}" path must start with "/"`);
        continue;
      }

      tools.push({
        name: toolName,
        description: String(rawTool.description || '').slice(0, 512),
        transport,
        method,
        path,
        url: host,
        endpoint: `${host}${path}`,
        timeoutMs: clampTimeout(rawTool.timeoutMs),
        parameters: isPlainObject(rawTool.parameters) ? rawTool.parameters : {},
      });
    }
  }

  const rawEvents = manifest.events;
  let events = { channel: DEFAULT_CHANNEL, emits: [] };
  if (rawEvents !== undefined) {
    if (!isPlainObject(rawEvents)) {
      errors.push('events must be an object');
    } else {
      const channel = String(rawEvents.channel || DEFAULT_CHANNEL);
      if (!CHANNEL_RE.test(channel)) errors.push(`events.channel invalid: "${channel}"`);
      const emits = Array.isArray(rawEvents.emits) ? rawEvents.emits : [];
      if (rawEvents.emits !== undefined && !Array.isArray(rawEvents.emits)) {
        errors.push('events.emits must be an array');
      }
      const validEmits = [];
      for (const e of emits) {
        if (typeof e === 'string' && EVENT_TYPE_RE.test(e)) validEmits.push(e);
        else errors.push(`events.emits entry invalid: ${JSON.stringify(e)}`);
      }
      events = { channel, emits: validEmits };
    }
  }

  if (errors.length) return { valid: false, errors };

  return {
    valid: true,
    plugin: {
      manifestVersion,
      name,
      version,
      description: String(manifest.description || '').slice(0, 512),
      enabled: manifest.enabled !== false,
      baseUrl: baseUrl || null,
      tools,
      events,
      source,
    },
  };
}

/**
 * Read + validate every *.plugin.json in `dir`.
 * Never throws: unreadable/invalid manifests land in `errors`.
 */
export function loadPluginsFromDir(dir = DEFAULT_PLUGINS_DIR, { env = process.env } = {}) {
  const plugins = [];
  const errors = [];

  if (!existsSync(dir)) return { plugins, errors, dir };

  let files;
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.plugin.json')).sort();
  } catch (err) {
    return { plugins, errors: [{ source: dir, errors: [`cannot read plugins dir: ${err.message}`] }], dir };
  }

  const seen = new Map();
  for (const file of files) {
    const fullPath = join(dir, file);
    let parsed;
    try {
      parsed = JSON.parse(expandEnv(readFileSync(fullPath, 'utf8'), env));
    } catch (err) {
      errors.push({ source: file, errors: [`invalid JSON: ${err.message}`] });
      continue;
    }
    const result = validateManifest(parsed, { source: file });
    if (!result.valid) {
      errors.push({ source: file, errors: result.errors });
      continue;
    }
    if (seen.has(result.plugin.name)) {
      errors.push({ source: file, errors: [`duplicate plugin name "${result.plugin.name}" (already declared by ${seen.get(result.plugin.name)})`] });
      continue;
    }
    seen.set(result.plugin.name, file);
    plugins.push(result.plugin);
  }

  return { plugins, errors, dir };
}

/**
 * Build the runtime plugin registry.
 *
 * The API surface handed to the rest of the dashboard is deliberately small:
 *   list() / get() / getTool()   — discovery
 *   emit()                       — publish a declared event onto the event bus
 *   reload()                     — re-scan the plugins directory
 */
export function createPluginRegistry({ pluginsDir = DEFAULT_PLUGINS_DIR, eventBus = null, logStructured = () => {} } = {}) {
  let state = { plugins: [], errors: [], dir: pluginsDir, loadedAt: null };

  function reload() {
    const { plugins, errors, dir } = loadPluginsFromDir(pluginsDir);
    state = { plugins, errors, dir, loadedAt: new Date().toISOString() };
    logStructured('info', 'plugins_loaded', {
      dir,
      loaded: plugins.length,
      enabled: plugins.filter(p => p.enabled).length,
      failed: errors.length,
      names: plugins.map(p => p.name),
    });
    for (const failure of errors) {
      logStructured('warn', 'plugin_manifest_rejected', { source: failure.source, errors: failure.errors });
    }
    return state;
  }

  return {
    reload,
    get dir() { return state.dir; },
    get loadedAt() { return state.loadedAt; },
    /** All manifests, including disabled ones (callers filter as needed). */
    list({ includeDisabled = true } = {}) {
      return includeDisabled ? [...state.plugins] : state.plugins.filter(p => p.enabled);
    },
    errors() { return [...state.errors]; },
    get(name) { return state.plugins.find(p => p.name === name) || null; },
    getTool(pluginName, toolName) {
      const plugin = state.plugins.find(p => p.name === pluginName);
      if (!plugin) return null;
      return plugin.tools.find(t => t.name === toolName) || null;
    },
    /** Every enabled plugin's tools, namespaced `plugin.tool` for agent exposure. */
    listTools() {
      return state.plugins
        .filter(p => p.enabled)
        .flatMap(p => p.tools.map(t => ({ ...t, plugin: p.name, qualifiedName: `${p.name}.${t.name}` })));
    },
    /**
     * Emit a plugin event onto the shared event bus.
     * Refuses event types the manifest did not declare in events.emits —
     * a plugin cannot spoof arbitrary dashboard events.
     */
    emit(pluginName, eventType, metadata = {}) {
      const plugin = state.plugins.find(p => p.name === pluginName);
      if (!plugin) return { ok: false, error: `Unknown plugin: ${pluginName}` };
      if (!plugin.enabled) return { ok: false, error: `Plugin is disabled: ${pluginName}` };
      if (!EVENT_TYPE_RE.test(String(eventType || ''))) {
        return { ok: false, error: 'Invalid event type' };
      }
      if (!plugin.events.emits.includes(eventType)) {
        return { ok: false, error: `Plugin "${pluginName}" does not declare event "${eventType}" in events.emits` };
      }
      if (!eventBus) return { ok: false, error: 'Event bus unavailable' };
      const event = eventBus.publish(plugin.events.channel, eventType, {
        metadata: { ...(isPlainObject(metadata) ? metadata : {}), plugin: plugin.name },
      });
      return { ok: true, event, channel: plugin.events.channel };
    },
  };
}
