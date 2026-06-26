/**
 * Tests for POST /api/tools/:toolKey/ensure (JIT lifecycle endpoint)
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
const { app } = await import('../server.js');

const server = app.listen(0);
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}`;

// 1. Unknown tool key → 404
const r404 = await fetch(`${BASE}/api/tools/nonexistent/ensure`, { method: 'POST' });
assert.strictEqual(r404.status, 404, 'unknown tool → 404');
const d404 = await r404.json();
assert.strictEqual(d404.success, false);
console.log('  ✅ unknown tool → 404');

// 2. Known tool (content_gen) — docker control disabled in test env
//    Tool server likely not reachable in test environment → 503
const rDown = await fetch(`${BASE}/api/tools/content_gen/ensure`, { method: 'POST' });
// Either 200 (tool is up) or 503 (tool is down and we can't start it)
assert.ok([200, 503].includes(rDown.status), `expected 200 or 503, got ${rDown.status}`);
const dDown = await rDown.json();
if (rDown.status === 200) {
  assert.strictEqual(dDown.success, true);
  assert.strictEqual(typeof dDown.ready, 'boolean');
  console.log('  ✅ known tool (running) → 200 ready');
} else {
  assert.strictEqual(dDown.success, false);
  assert.ok(dDown.error, 'error message present');
  console.log('  ✅ known tool (offline, no docker control) → 503 with message');
}

// 3. website tool works the same way
const rWebsite = await fetch(`${BASE}/api/tools/website/ensure`, { method: 'POST' });
assert.ok([200, 503].includes(rWebsite.status), `expected 200 or 503 for website, got ${rWebsite.status}`);
console.log('  ✅ website tool ensure works');

server.close();
console.log('Tool ensure endpoint tests passed.');
