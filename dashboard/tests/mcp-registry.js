/**
 * Tests for multi-MCP orchestration registry
 * GET  /api/mcp-registry
 * GET  /api/mcp-registry/:key
 * POST /api/mcp-registry/:key/ensure
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
const { app } = await import('../server.js');

const server = app.listen(0);
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}`;

// 1. GET /api/mcp-registry — lists providers from registry file
const listRes = await fetch(`${BASE}/api/mcp-registry`);
assert.strictEqual(listRes.status, 200, `mcp-registry should return 200, got ${listRes.status}`);
const listData = await listRes.json();
assert.strictEqual(listData.success, true);
assert.ok(Array.isArray(listData.providers), 'providers is an array');
assert.ok(listData.providers.length >= 2, 'at least content_gen and website are registered');
console.log('  ✅ GET /api/mcp-registry returns providers');

// 2. Each provider has required fields
for (const p of listData.providers) {
  assert.ok(p.key, `provider has key: ${JSON.stringify(p)}`);
  assert.ok(p.name, 'provider has name');
  assert.ok(p.url, 'provider has url');
  assert.strictEqual(typeof p.running, 'boolean', 'provider has running boolean');
  assert.ok(['healthy', 'unavailable'].includes(p.status), `status is valid: ${p.status}`);
}
console.log('  ✅ each provider has key, name, url, running, status');

// 3. GET /api/mcp-registry/:key — single provider
const contentRes = await fetch(`${BASE}/api/mcp-registry/content_gen`);
assert.strictEqual(contentRes.status, 200);
const contentData = await contentRes.json();
assert.strictEqual(contentData.success, true);
assert.strictEqual(contentData.provider.key, 'content_gen');
assert.strictEqual(typeof contentData.provider.running, 'boolean');
console.log(`  ✅ GET /api/mcp-registry/content_gen → running=${contentData.provider.running}`);

// 4. 404 for unknown provider
const notFound = await fetch(`${BASE}/api/mcp-registry/nonexistent`);
assert.strictEqual(notFound.status, 404);
console.log('  ✅ unknown provider → 404');

// 5. POST ensure — docker control disabled → 200 (already running) or 503 (offline)
const ensureRes = await fetch(`${BASE}/api/mcp-registry/content_gen/ensure`, { method: 'POST' });
assert.ok([200, 503].includes(ensureRes.status), `ensure: expected 200 or 503, got ${ensureRes.status}`);
const ensureData = await ensureRes.json();
if (ensureRes.status === 200) {
  assert.strictEqual(ensureData.ready, true);
  console.log('  ✅ ensure content_gen (running) → 200 ready');
} else {
  assert.ok(ensureData.error, 'error message present');
  console.log('  ✅ ensure content_gen (offline, no docker ctrl) → 503 with message');
}

// 6. POST ensure unknown → 404
const ensure404 = await fetch(`${BASE}/api/mcp-registry/nope/ensure`, { method: 'POST' });
assert.strictEqual(ensure404.status, 404);
console.log('  ✅ ensure unknown provider → 404');

// 7. POST stop — docker control disabled → 503, unknown → 404
const stopUnknown = await fetch(`${BASE}/api/mcp-registry/nope/stop`, { method: 'POST' });
assert.strictEqual(stopUnknown.status, 404);
console.log('  ✅ stop unknown provider → 404');

const stopDisabled = await fetch(`${BASE}/api/mcp-registry/content_gen/stop`, { method: 'POST' });
assert.ok([200, 503].includes(stopDisabled.status), `stop: expected 200 or 503, got ${stopDisabled.status}`);
if (stopDisabled.status === 503) {
  const d = await stopDisabled.json();
  assert.ok(d.error, 'error message present on disabled stop');
  console.log('  ✅ stop content_gen (no docker ctrl) → 503 with message');
} else {
  console.log('  ✅ stop content_gen (docker ctrl on) → 200');
}

server.close();
console.log('MCP registry tests passed.');
