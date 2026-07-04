/**
 * Tests for GET /api/connectors — bb-mcp connector registry
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
const { app } = await import('../server.js');

const server = app.listen(0);
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}`;

// 1. GET /api/connectors returns 200 with connectors array
const res = await fetch(`${BASE}/api/connectors`);
assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
const data = await res.json();
assert.strictEqual(data.success, true);
assert.ok(Array.isArray(data.connectors), 'connectors is an array');
console.log(`  ✅ GET /api/connectors → ${data.connectors.length} connectors`);

// 2. bb-mcp connector not in list when BB_MCP_ENABLED is falsy (default in tests)
const bbConnector = data.connectors.find(c => c.id === 'blackboard-learn');
if (!process.env.BB_MCP_ENABLED) {
  assert.strictEqual(bbConnector, undefined, 'bb-mcp not in list when BB_MCP_ENABLED unset');
  console.log('  ✅ blackboard-learn excluded when BB_MCP_ENABLED unset');
} else {
  console.log(`  ℹ️  BB_MCP_ENABLED set — blackboard-learn present: ${!!bbConnector}`);
}

// 3. GET /api/connectors/:id — 404 for unknown connector
const notFound = await fetch(`${BASE}/api/connectors/nonexistent`);
assert.strictEqual(notFound.status, 404, `expected 404, got ${notFound.status}`);
console.log('  ✅ unknown connector → 404');

// 4. Response shape — each connector has id and name
for (const c of data.connectors) {
  assert.ok(c.id, `connector has id: ${JSON.stringify(c)}`);
  assert.ok(c.name, 'connector has name');
}
if (data.connectors.length > 0) {
  console.log('  ✅ connector shape valid (id, name)');
} else {
  console.log('  ℹ️  no connectors in config (empty list is valid)');
}

server.close();
console.log('Connectors API tests passed.');
