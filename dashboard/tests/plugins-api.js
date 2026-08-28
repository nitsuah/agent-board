/**
 * Tests for the plugin API + plugin loader
 *
 * GET  /api/plugins
 * GET  /api/plugins/tools
 * GET  /api/plugins/:name
 * POST /api/plugins/reload
 * POST /api/plugins/:name/tools/:tool/invoke
 * POST /api/plugins/:name/events
 *
 * The plugin backend is a local stub, and the dashboard is pointed at a
 * temporary fixture plugins directory, so every assertion is an exact contract
 * rather than "whatever the environment happens to be running".
 */
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateManifest, expandEnv, expandDeep, loadPluginsFromDir,
  createPluginRegistry, DEFAULT_PLUGINS_DIR,
} from '../modules/plugin-loader.js';

// ── Stub plugin backend ──────────────────────────────────────────────────────
const backendHits = [];
const backendApp = express();
backendApp.use(express.json());
backendApp.get('/health', (req, res) => {
  backendHits.push({ path: '/health', method: 'GET', query: req.query });
  res.json({ status: 'ok', service: 'stub-backend' });
});
backendApp.post('/echo', (req, res) => {
  backendHits.push({ path: '/echo', method: 'POST', body: req.body });
  res.json({ echoed: req.body?.message ?? null });
});
backendApp.post('/boom', (req, res) => {
  backendHits.push({ path: '/boom', method: 'POST' });
  res.status(500).json({ error: 'backend exploded' });
});
const backend = backendApp.listen(0);
const backendUrl = `http://127.0.0.1:${backend.address().port}`;

// ── Fixture plugins directory ────────────────────────────────────────────────
const fixtureDir = mkdtempSync(join(tmpdir(), 'ab-plugins-'));
const write = (file, obj) => writeFileSync(join(fixtureDir, file), JSON.stringify(obj, null, 2));

write('stub.plugin.json', {
  manifestVersion: 1,
  name: 'stub',
  version: '1.0.0',
  description: 'Stub plugin backed by a local test server',
  enabled: true,
  baseUrl: backendUrl,
  tools: [
    { name: 'health', method: 'GET', path: '/health', timeoutMs: 5000 },
    { name: 'echo', method: 'POST', path: '/echo', timeoutMs: 5000 },
    { name: 'boom', method: 'POST', path: '/boom', timeoutMs: 5000 },
    { name: 'unreachable', method: 'GET', url: 'http://127.0.0.1:1', path: '/nope', timeoutMs: 2000 },
  ],
  events: { channel: 'plugins', emits: ['stub.invoked'] },
});
write('off.plugin.json', {
  manifestVersion: 1, name: 'off', version: '0.1.0', enabled: false,
  baseUrl: backendUrl, tools: [{ name: 'health', method: 'GET', path: '/health' }],
  events: { channel: 'plugins', emits: ['off.thing'] },
});
// A manifest that must be rejected, to prove bad files are reported not fatal.
writeFileSync(join(fixtureDir, 'broken.plugin.json'), '{ not valid json');

process.env.AGENT_BOARD_PLUGINS_DIR = fixtureDir;
process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
const { app } = await import('../server.js');

const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

function cleanup() {
  server.close();
  backend.close();
  rmSync(fixtureDir, { recursive: true, force: true });
}

try {
  // ── Unit: manifest validation ──────────────────────────────────────────────
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
  assert.strictEqual(validateManifest({ name: 'ok', version: '1.0.0', tools: 'nope' }).valid, false, 'rejects non-array tools');
  assert.strictEqual(validateManifest({ name: 'ok', version: '1.0.0', events: 'nope' }).valid, false, 'rejects non-object events');
  console.log('  ✅ invalid manifests rejected (name, version, manifestVersion, type, tools, events)');

  const noHost = validateManifest({ name: 'ok', version: '1.0.0', tools: [{ name: 't', path: '/x' }] });
  assert.strictEqual(noHost.valid, false, 'tool without url or baseUrl is rejected');
  assert.ok(noHost.errors.some(e => /baseUrl/.test(e)), 'error explains the missing host');

  assert.strictEqual(
    validateManifest({ name: 'ok', version: '1.0.0', baseUrl: 'http://h:1', tools: [{ name: 't', transport: 'stdio' }] }).valid,
    false, 'rejects unsupported transport');
  assert.strictEqual(
    validateManifest({ name: 'ok', version: '1.0.0', baseUrl: 'file:///etc/passwd' }).valid,
    false, 'rejects non-http baseUrl');
  assert.strictEqual(
    validateManifest({ name: 'ok', version: '1.0.0', baseUrl: 'http://h:1', tools: [{ name: 't', method: 'TRACE' }] }).valid,
    false, 'rejects unsupported method');
  assert.strictEqual(
    validateManifest({ name: 'ok', version: '1.0.0', baseUrl: 'http://h:1', tools: [{ name: 't', path: 'no-slash' }] }).valid,
    false, 'rejects path without leading slash');
  console.log('  ✅ rejects bad hosts, transports, methods, and paths');

  const dupTools = validateManifest({
    name: 'ok', version: '1.0.0', baseUrl: 'http://h:1',
    tools: [{ name: 'same' }, { name: 'same' }],
  });
  assert.strictEqual(dupTools.valid, false, 'duplicate tool names rejected');

  // Timeouts are clamped, not trusted.
  const clamped = validateManifest({
    name: 'ok', version: '1.0.0', baseUrl: 'http://h:1',
    tools: [{ name: 'slow', timeoutMs: 999_999 }, { name: 'fast', timeoutMs: 1 }],
  });
  assert.strictEqual(clamped.plugin.tools[0].timeoutMs, 120_000, 'timeout clamped to 120s max');
  assert.strictEqual(clamped.plugin.tools[1].timeoutMs, 1_000, 'timeout clamped to 1s min');
  console.log('  ✅ duplicate tool names rejected; timeouts clamped to 1s–120s');

  // ── Unit: env expansion happens after parse ────────────────────────────────
  assert.strictEqual(expandEnv('${FOO:-fallback}', {}), 'fallback', 'uses fallback when unset');
  assert.strictEqual(expandEnv('${FOO:-fallback}', { FOO: 'set' }), 'set', 'uses env value when set');
  assert.strictEqual(expandEnv('${MISSING}', {}), '', 'missing var with no fallback → empty');
  assert.strictEqual(expandEnv('${EMPTY:-fallback}', { EMPTY: '' }), '', 'defined-but-empty stays empty');
  console.log('  ✅ ${VAR:-default} expansion, including defined-but-empty');

  // The injection this ordering exists to prevent: a value carrying a quote
  // must stay a string value, not become new manifest structure.
  const hostile = expandDeep(
    { name: 'ok', baseUrl: '${EVIL}', enabled: true },
    { EVIL: 'http://x", "enabled": false, "_x":"' }
  );
  assert.strictEqual(hostile.enabled, true, 'a hostile env value cannot flip another field');
  assert.strictEqual(hostile.baseUrl, 'http://x", "enabled": false, "_x":"', 'hostile value stays an inert string');
  assert.deepStrictEqual(
    expandDeep({ a: ['${X}', { b: '${X}' }], n: 5, t: true }, { X: 'v' }),
    { a: ['v', { b: 'v' }], n: 5, t: true },
    'expands string leaves through arrays/objects, leaves non-strings alone'
  );
  console.log('  ✅ env expansion runs post-parse and cannot inject manifest fields');

  // ── Unit: loader ───────────────────────────────────────────────────────────
  const missing = loadPluginsFromDir('/definitely/not/a/real/dir');
  assert.deepStrictEqual(missing.plugins, [], 'missing dir yields no plugins');
  assert.deepStrictEqual(missing.errors, [], 'missing dir is not an error');

  const loaded = loadPluginsFromDir(fixtureDir);
  assert.strictEqual(loaded.plugins.length, 2, 'loads the two valid fixture manifests');
  assert.strictEqual(loaded.errors.length, 1, 'the broken manifest is reported, not fatal');
  assert.strictEqual(loaded.errors[0].source, 'broken.plugin.json');
  console.log('  ✅ loader: missing dir is quiet; a broken manifest is reported not fatal');

  // The manifest that actually ships must be valid, and disabled by default.
  const shipped = loadPluginsFromDir(DEFAULT_PLUGINS_DIR);
  assert.strictEqual(shipped.errors.length, 0, `shipped manifests must all be valid: ${JSON.stringify(shipped.errors)}`);
  const example = shipped.plugins.find(p => p.name === 'example-echo');
  assert.ok(example, 'example-echo ships');
  assert.strictEqual(example.enabled, false, 'example manifest ships disabled so operators opt in');
  console.log('  ✅ shipped example manifest is valid and disabled by default');

  // ── Unit: event gating ─────────────────────────────────────────────────────
  const emitted = [];
  const fakeBus = { publish: (channel, type, data) => { const e = { channel, type, data }; emitted.push(e); return e; } };
  const registry = createPluginRegistry({ pluginsDir: fixtureDir, eventBus: fakeBus });
  registry.reload();

  assert.strictEqual(registry.emit('stub', 'some.other.event').code, 'event_not_declared', 'undeclared event refused');
  assert.strictEqual(registry.emit('nope', 'x').code, 'unknown_plugin', 'unknown plugin refused');
  assert.strictEqual(registry.emit('off', 'off.thing').code, 'plugin_disabled', 'disabled plugin refused');
  assert.strictEqual(registry.emit('stub', 'bad type!').code, 'invalid_event_type', 'malformed event type refused');
  assert.strictEqual(emitted.length, 0, 'nothing published for any refused event');

  const declared = registry.emit('stub', 'stub.invoked', { foo: 'bar' });
  assert.strictEqual(declared.ok, true, `declared event should publish: ${declared.error}`);
  assert.strictEqual(emitted.length, 1, 'declared event published exactly once');
  assert.strictEqual(emitted[0].channel, 'plugins', 'published on the manifest channel');
  assert.strictEqual(emitted[0].data.metadata.plugin, 'stub', 'plugin name stamped into metadata');

  const noBus = createPluginRegistry({ pluginsDir: fixtureDir, eventBus: null });
  noBus.reload();
  assert.strictEqual(noBus.emit('stub', 'stub.invoked').code, 'event_bus_unavailable', 'missing bus is a distinct code');

  // listTools only surfaces enabled plugins.
  assert.ok(registry.listTools().every(t => t.plugin !== 'off'), 'disabled plugin contributes no tools');
  assert.ok(registry.getTool('stub', 'echo'), 'getTool finds a declared tool');
  assert.strictEqual(registry.getTool('stub', 'nope'), null, 'getTool returns null for unknown tool');
  assert.strictEqual(registry.getTool('nope', 'echo'), null, 'getTool returns null for unknown plugin');
  assert.strictEqual(registry.list({ includeDisabled: false }).length, 1, 'list can exclude disabled');
  console.log('  ✅ registry gates events by code and hides disabled plugins from tools');

  // ── API: list ──────────────────────────────────────────────────────────────
  const listRes = await fetch(`${BASE}/api/plugins`);
  assert.strictEqual(listRes.status, 200, `GET /api/plugins → ${listRes.status}`);
  const listData = await listRes.json();
  assert.strictEqual(listData.success, true);
  assert.strictEqual(listData.count, 2, 'both valid fixture plugins listed');
  assert.strictEqual(listData.enabledCount, 1, 'only the stub plugin is enabled');
  assert.strictEqual(listData.errors.length, 1, 'the broken manifest surfaces in errors');
  console.log('  ✅ GET /api/plugins → 2 plugins, 1 enabled, 1 reported manifest error');

  // ── API: tools route is not shadowed by /:name ─────────────────────────────
  const toolsData = await (await fetch(`${BASE}/api/plugins/tools`)).json();
  assert.ok(toolsData.tools.some(t => t.qualifiedName === 'stub.echo'), 'tools are namespaced plugin.tool');
  assert.ok(!toolsData.tools.some(t => t.plugin === 'off'), 'disabled plugin tools are not exposed');
  console.log('  ✅ GET /api/plugins/tools resolves before /:name and hides disabled plugins');

  // ── API: single ────────────────────────────────────────────────────────────
  const oneData = await (await fetch(`${BASE}/api/plugins/stub`)).json();
  assert.strictEqual(oneData.plugin.name, 'stub');
  assert.strictEqual((await fetch(`${BASE}/api/plugins/does-not-exist`)).status, 404, 'unknown plugin → 404');

  // ── API: reload ────────────────────────────────────────────────────────────
  const reloadData = await (await fetch(`${BASE}/api/plugins/reload`, { method: 'POST' })).json();
  assert.strictEqual(reloadData.loaded, 2, 'reload finds both valid plugins');
  assert.strictEqual(reloadData.failed, 1, 'reload reports the broken manifest');
  console.log('  ✅ GET /api/plugins/:name and POST /api/plugins/reload');

  // ── API: invoke — exact contracts against the stub ─────────────────────────
  const post = (path, body) => fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
  });

  assert.strictEqual((await post('/api/plugins/stub/tools/nope/invoke')).status, 404, 'unknown tool → 404');
  assert.strictEqual((await post('/api/plugins/nope/tools/echo/invoke')).status, 404, 'unknown plugin → 404');
  assert.strictEqual((await post('/api/plugins/off/tools/health/invoke')).status, 409, 'disabled plugin → 409');

  backendHits.length = 0;
  const healthRes = await post('/api/plugins/stub/tools/health/invoke');
  assert.strictEqual(healthRes.status, 200, 'GET tool against a live backend → 200');
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.success, true);
  assert.strictEqual(healthData.status, 200, 'upstream status reported');
  assert.deepStrictEqual(healthData.result, { status: 'ok', service: 'stub-backend' }, 'backend payload passed through');
  assert.strictEqual(typeof healthData.durationMs, 'number', 'timing reported');
  assert.strictEqual(backendHits.length, 1, 'backend called exactly once');
  assert.strictEqual(backendHits[0].method, 'GET');

  backendHits.length = 0;
  const echoData = await (await post('/api/plugins/stub/tools/echo/invoke', { arguments: { message: 'hi' } })).json();
  assert.strictEqual(echoData.success, true);
  assert.deepStrictEqual(echoData.result, { echoed: 'hi' }, 'POST body reaches the backend');
  assert.deepStrictEqual(backendHits[0].body, { message: 'hi' }, 'arguments forwarded verbatim');

  // A bare body (no `arguments` wrapper) is also accepted.
  backendHits.length = 0;
  const bareData = await (await post('/api/plugins/stub/tools/echo/invoke', { message: 'bare' })).json();
  assert.deepStrictEqual(bareData.result, { echoed: 'bare' }, 'bare body treated as arguments');
  console.log('  ✅ invoke: GET/POST tools reach the stub backend with exact payloads');

  // Upstream 5xx is surfaced as 502, unreachable host as 503 — distinct cases.
  const boomRes = await post('/api/plugins/stub/tools/boom/invoke');
  assert.strictEqual(boomRes.status, 502, 'upstream 500 → 502');
  const boomData = await boomRes.json();
  assert.strictEqual(boomData.success, false);
  assert.strictEqual(boomData.status, 500, 'upstream status preserved');
  assert.match(boomData.error, /502|returned 500/, 'error names the upstream failure');

  const unreachRes = await post('/api/plugins/stub/tools/unreachable/invoke');
  assert.strictEqual(unreachRes.status, 503, 'unreachable backend → 503');
  const unreachData = await unreachRes.json();
  assert.strictEqual(unreachData.success, false);
  assert.match(unreachData.error, /unreachable/i, 'error explains the connection failure');
  console.log('  ✅ invoke: upstream 5xx → 502, unreachable backend → 503');

  // Oversized arguments are refused before any network call. In practice
  // express.json()'s own 100 KB limit rejects first; the route's 256 KB check is
  // a backstop if that limit is ever raised. Either way the contract that
  // matters holds: 413, and nothing is forwarded upstream.
  backendHits.length = 0;
  const bigRes = await post('/api/plugins/stub/tools/echo/invoke', { arguments: { message: 'x'.repeat(300 * 1024) } });
  assert.strictEqual(bigRes.status, 413, 'oversized arguments → 413');
  assert.strictEqual(backendHits.length, 0, 'oversized payload never reaches the backend');
  console.log('  ✅ invoke: oversized arguments → 413 without calling the backend');

  // ── API: events ────────────────────────────────────────────────────────────
  assert.strictEqual((await post('/api/plugins/stub/events')).status, 400, 'missing event_type → 400');
  assert.strictEqual((await post('/api/plugins/stub/events', { event_type: 'not.declared' })).status, 400, 'undeclared → 400');
  assert.strictEqual((await post('/api/plugins/nope/events', { event_type: 'x' })).status, 404, 'unknown plugin → 404');
  // Disabled maps to 409 here just as it does on the invoke route.
  const offEmit = await post('/api/plugins/off/events', { event_type: 'off.thing' });
  assert.strictEqual(offEmit.status, 409, 'disabled plugin → 409, consistent with invoke');
  assert.strictEqual((await offEmit.json()).code, 'plugin_disabled', 'failure code returned to the client');

  const emitData = await (await post('/api/plugins/stub/events', { event_type: 'stub.invoked', metadata: { via: 'test' } })).json();
  assert.strictEqual(emitData.success, true);
  assert.strictEqual(emitData.channel, 'plugins');
  assert.strictEqual(emitData.event.event_type, 'stub.invoked');

  const historyData = await (await fetch(`${BASE}/api/channels/plugins/history`)).json();
  assert.ok(
    historyData.events.some(e => e.event_type === 'stub.invoked' && e.metadata?.via === 'test'),
    'emitted plugin event appears in the plugins channel history'
  );
  console.log('  ✅ events: status codes by failure kind, and events reach the shared bus');

  // ── Regression ─────────────────────────────────────────────────────────────
  assert.ok([200, 503].includes((await fetch(`${BASE}/api/health`)).status), 'health endpoint still responds');
  assert.strictEqual((await fetch(`${BASE}/api/mcp-registry`)).status, 200, 'mcp-registry still responds');
  console.log('  ✅ existing /api/health and /api/mcp-registry unaffected');

  console.log('Plugin API tests passed.');
} finally {
  cleanup();
}
