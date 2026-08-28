/**
 * Tests for GET /api/sessions/:id/health
 */
import assert from 'assert';

import { BASE, closeTestServer } from './helpers/test-server.js';

// 1. Create a session
const createRes = await fetch(`${BASE}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'health-test', endpoint: 'primary', model: 'llama3.2:3b', experience: 'developer' }),
});
assert.strictEqual(createRes.status, 200, 'session creation ok');
const { session } = await createRes.json();
const sid = session.id;

// 2. Health endpoint returns 200 with expected shape
const healthRes = await fetch(`${BASE}/api/sessions/${sid}/health`);
assert.strictEqual(healthRes.status, 200, 'health endpoint returns 200');
const { health } = await healthRes.json();
assert.strictEqual(health.sessionId, sid, 'sessionId matches');
assert.ok(['idle', 'running', 'error'].includes(health.status), `status is valid: ${health.status}`);
assert.strictEqual(typeof health.messageCount, 'number', 'messageCount is number');
assert.strictEqual(typeof health.errorCount, 'number', 'errorCount is number');
assert.strictEqual(typeof health.endpointReachable, 'boolean', 'endpointReachable is boolean');
assert.ok(typeof health.uptime === 'number' && health.uptime >= 0, 'uptime >= 0');

// 3. Newly created session should be idle with 0 errors
assert.strictEqual(health.status, 'idle', 'new session is idle');
assert.strictEqual(health.errorCount, 0, 'new session has 0 errors');
assert.strictEqual(health.messageCount, 0, 'new session has 0 messages');

// 4. Health on non-existent session returns 404
const notFoundRes = await fetch(`${BASE}/api/sessions/nonexistent-id/health`);
assert.strictEqual(notFoundRes.status, 404, '404 for missing session');

// 5. Session list includes status field
const listRes = await fetch(`${BASE}/api/sessions`);
const listData = await listRes.json();
const found = listData.sessions.find(s => s.id === sid);
assert.ok(found, 'session appears in list');
assert.ok(['idle', 'running', 'error'].includes(found.status), 'list entry has status field');

// Cleanup
await fetch(`${BASE}/api/sessions/${sid}`, { method: 'DELETE' });


closeTestServer();
console.log('Session health tests passed.');
