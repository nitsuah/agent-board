/**
 * Tests for the plugin API + plugin loader
 *
 * GET  /api/plugins
 * GET  /api/plugins/tools
 * GET  /api/plugins/:name
 * POST /api/plugins/reload
 * POST /api/plugins/:name/tools/:tool/invoke
 * POST /api/plugins/:name/events
 */
import assert from 'node:assert/strict';
import { validateManifest, expandEnv, loadPluginsFromDir, createPluginRegistry } from '../modules/plugin-loader.js';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
const { app } = await import('../server.js');

const server = app.listen(0);
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}`;

// ── Unit: manifest validation ────────────────────────────────────────────────

const good = validateManifest({
  manifestVersion: 1,
  name: 'unit-plugin',
  version: '2.1.0',
  baseUrl: 'http://example.test:9999',
  tools: [{ name: 'ping', method: 'get', path: '/ping' }],
  events: { channel: 'plugins', emits: ['unit-plugin.done'] },
});
assert.strictEqual(good.valid, true, `valid manifest rejected: ${JSON.stringify(good.errors)}`);
assert.strictEqual(good.plugin.enabled, true, 'enabled defaults to true');
assert.strictEqual(good.plugin.tools[0].method, 'GET', 'method is upper-cased');
assert.strictEqual(good.plugin.tools[0].endpoint, 'http://example.test:9999/ping', 'endpoint = baseUrl + path');
assert.strictEqual(good.plugin.tools[0].timeoutMs, 15000, 'timeout defaults to 15s');
console.log('  ✅ valid manifest normalizes name/method/endpoint/defaults');

assert.strictEqual(validateManifest({ name: 'Bad Name', version: '1.0.0' }).valid, false, 'rejects invalid name');
assert.strictEqual(validateManifest({ name: 'ok', version: 'not-semver' }).valid, false, 'rejects bad version');
assert.strictEqual(validateManifest({ name: 'ok', version: '1.0.0', manifestVersion: 99 }).valid, false, 'rejects future manifestVersion');
assert.strictEqual(validateManifest('a string').valid, false, 'rejects non-object manifest');
console.log('  ✅ invalid manifests rejected (name, version, manifestVersion, type)');

// A tool with no host anywhere is rejected rather than silently unresolvable.
const noHost = validateManifest({ name: 'ok', version: '1.0.0', tools: [{ name: 't', path: '/x' }] });
assert.strictEqual(noHost.valid, false, 'tool without url or baseUrl is rejected');
assert.ok(noHost.errors.some(e => /baseUrl/.test(e)), 'error explains the missing host');

// Non-http transports and schemes are refused.
assert.strictEqual(
  validateManifest({ name: 'ok', version: '1.0.0', baseUrl: 'http://h:1', tools: [{ name: 't', transport: 'stdio' }] }).valid,
  false, 'rejects unsupported transport');
assert.strictEqual(
  validateManifest({ name: 'ok', version: '1.0.0', baseUrl: 'file:///etc/passwd' }).valid,
  false, 'rejects non-http baseUrl');
console.log('  ✅ rejects tools with no host, unsupported transports, non-http URLs');

// Duplicate tool names inside one manifest are an error, not a silent overwrite.
const dupTools = validateManifest({
  name: 'ok', version: '1.0.0', baseUrl: 'http://h:1',
  tools: [{ name: 'same' }, { name: 'same' }],
});
assert.strictEqual(dupTools.valid, false, 'duplicate tool names rejected');
console.log('  ✅ duplicate tool names within a manifest rejected');

// ── Unit: env expansion ──────────────────────────────────────────────────────
assert.strictEqual(expandEnv('${FOO:-fallback}', {}), 'fallback', 'uses fallback when unset');
assert.strictEqual(expandEnv('${FOO:-fallback}', { FOO: 'set' }), 'set', 'uses env value when set');
assert.strictEqual(expandEnv('${MISSING}', {}), '', 'missing var with no fallback → empty');
console.log('  ✅ ${VAR:-default} expansion');

// ── Unit: loader tolerates a missing directory ───────────────────────────────
const missing = loadPluginsFromDir('/definitely/not/a/real/dir');
assert.deepStrictEqual(missing.plugins, [], 'missing dir yields no plugins');
assert.deepStrictEqual(missing.errors, [], 'missing dir is not an error');
console.log('  ✅ missing plugins dir degrades quietly');

// ── Unit: registry gates events to those the manifest declares ───────────────
const emitted = [];
const fakeBus = { publish: (channel, type, data) => { const e = { channel, type, data }; emitted.push(e); return e; } };
const registry = createPluginRegistry({ eventBus: fakeBus });
registry.reload();

const declaredPlugin = registry.get('example-echo');
assert.ok(declaredPlugin, 'example-echo manifest loads from config/plugins');

const undeclared = registry.emit('example-echo', 'some.other.event', {});
assert.strictEqual(undeclared.ok, false, 'undeclared event type refused');
assert.match(undeclared.error, /does not declare/, 'error explains why');
assert.strictEqual(emitted.length, 0, 'nothing published for a refused event');

const declared = registry.emit('example-echo', 'example-echo.invoked', { foo: 'bar' });
assert.strictEqual(declared.ok, true, `declared event should publish: ${declared.error}`);
assert.strictEqual(emitted.length, 1, 'declared event published exactly once');
assert.strictEqual(emitted[0].channel, 'plugins', 'published on the manifest channel');
assert.strictEqual(emitted[0].data.metadata.plugin, 'example-echo', 'plugin name stamped into metadata');

assert.strictEqual(registry.emit('nope', 'x').ok, false, 'unknown plugin refused');
console.log('  ✅ registry only emits event types declared in events.emits');

// ── API: GET /api/plugins ────────────────────────────────────────────────────
const listRes = await fetch(`${BASE}/api/plugins`);
assert.strictEqual(listRes.status, 200, `GET /api/plugins → ${listRes.status}`);
const listData = await listRes.json();
assert.strictEqual(listData.success, true);
assert.ok(Array.isArray(listData.plugins), 'plugins is an array');
assert.ok(listData.plugins.some(p => p.name === 'example-echo'), 'example plugin is listed');
assert.ok(Array.isArray(listData.errors), 'errors is an array');
assert.strictEqual(listData.errors.length, 0, `shipped manifests must all be valid: ${JSON.stringify(listData.errors)}`);
for (const p of listData.plugins) {
  assert.ok(p.name && p.version, 'plugin has name + version');
  assert.strictEqual(typeof p.enabled, 'boolean', 'plugin has enabled boolean');
  assert.ok(Array.isArray(p.tools), 'plugin has tools array');
}
console.log(`  ✅ GET /api/plugins → ${listData.plugins.length} plugin(s), 0 manifest errors`);

// ── API: GET /api/plugins/tools is not shadowed by /:name ────────────────────
const toolsRes = await fetch(`${BASE}/api/plugins/tools`);
assert.strictEqual(toolsRes.status, 200, 'tools route resolves before :name');
const toolsData = await toolsRes.json();
assert.strictEqual(toolsData.success, true);
assert.ok(Array.isArray(toolsData.tools), 'tools is an array');
assert.ok(toolsData.tools.some(t => t.qualifiedName === 'example-echo.echo'), 'tools are namespaced plugin.tool');
console.log(`  ✅ GET /api/plugins/tools → ${toolsData.tools.length} namespaced tool(s)`);

// ── API: GET /api/plugins/:name ──────────────────────────────────────────────
const oneRes = await fetch(`${BASE}/api/plugins/example-echo`);
assert.strictEqual(oneRes.status, 200);
const oneData = await oneRes.json();
assert.strictEqual(oneData.plugin.name, 'example-echo');
assert.ok(oneData.plugin.tools.length >= 2, 'example plugin declares its tools');

const missingRes = await fetch(`${BASE}/api/plugins/does-not-exist`);
assert.strictEqual(missingRes.status, 404, 'unknown plugin → 404');
console.log('  ✅ GET /api/plugins/:name → 200 known, 404 unknown');

// ── API: POST /api/plugins/reload ────────────────────────────────────────────
const reloadRes = await fetch(`${BASE}/api/plugins/reload`, { method: 'POST' });
assert.strictEqual(reloadRes.status, 200);
const reloadData = await reloadRes.json();
assert.strictEqual(reloadData.success, true);
assert.ok(reloadData.loaded >= 1, 'reload finds at least the example plugin');
assert.strictEqual(reloadData.failed, 0, 'reload reports no failures');
console.log(`  ✅ POST /api/plugins/reload → loaded=${reloadData.loaded} failed=${reloadData.failed}`);

// ── API: invoke ──────────────────────────────────────────────────────────────
const invoke404 = await fetch(`${BASE}/api/plugins/example-echo/tools/nope/invoke`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});
assert.strictEqual(invoke404.status, 404, 'unknown tool → 404');
const invoke404Data = await invoke404.json();
assert.match(invoke404Data.error, /Unknown tool/, 'error names the problem');

const invokePlugin404 = await fetch(`${BASE}/api/plugins/nope/tools/echo/invoke`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});
assert.strictEqual(invokePlugin404.status, 404, 'unknown plugin → 404');

// The example backend is normally offline in CI: expect a clean 503, never a crash.
const invokeRes = await fetch(`${BASE}/api/plugins/example-echo/tools/health/invoke`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});
assert.ok([200, 502, 503].includes(invokeRes.status), `invoke: expected 200/502/503, got ${invokeRes.status}`);
const invokeData = await invokeRes.json();
if (invokeRes.status === 200) {
  assert.strictEqual(invokeData.success, true);
  console.log('  ✅ invoke health (backend up) → 200');
} else {
  assert.strictEqual(invokeData.success, false);
  assert.ok(invokeData.error, 'offline backend returns an error message, not a crash');
  assert.strictEqual(typeof invokeData.durationMs, 'number', 'timing reported even on failure');
  console.log(`  ✅ invoke health (backend offline) → ${invokeRes.status} with message`);
}

// ── API: events ──────────────────────────────────────────────────────────────
const noType = await fetch(`${BASE}/api/plugins/example-echo/events`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
});
assert.strictEqual(noType.status, 400, 'missing event_type → 400');

const undeclaredRes = await fetch(`${BASE}/api/plugins/example-echo/events`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event_type: 'not.declared' }),
});
assert.strictEqual(undeclaredRes.status, 400, 'undeclared event_type → 400');

const emitRes = await fetch(`${BASE}/api/plugins/example-echo/events`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event_type: 'example-echo.invoked', metadata: { via: 'test' } }),
});
assert.strictEqual(emitRes.status, 200, 'declared event_type → 200');
const emitData = await emitRes.json();
assert.strictEqual(emitData.success, true);
assert.strictEqual(emitData.channel, 'plugins', 'emitted on the manifest channel');
assert.strictEqual(emitData.event.event_type, 'example-echo.invoked');

// The event really landed on the shared bus and is readable via the channels API.
const historyRes = await fetch(`${BASE}/api/channels/plugins/history`);
const historyData = await historyRes.json();
assert.ok(
  historyData.events.some(e => e.event_type === 'example-echo.invoked' && e.metadata?.via === 'test'),
  'emitted plugin event appears in the plugins channel history'
);
console.log('  ✅ plugin events reach the shared event bus channel');

// ── Regression: existing routes still work alongside the new ones ────────────
const healthRes = await fetch(`${BASE}/api/health`);
assert.ok([200, 503].includes(healthRes.status), 'health endpoint still responds');
const mcpRes = await fetch(`${BASE}/api/mcp-registry`);
assert.strictEqual(mcpRes.status, 200, 'mcp-registry still responds');
console.log('  ✅ existing /api/health and /api/mcp-registry unaffected');

server.close();
console.log('Plugin API tests passed.');
