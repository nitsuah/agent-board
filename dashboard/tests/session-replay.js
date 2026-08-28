/**
 * Tests for GET /api/sessions/:id/replay
 */
import assert from 'assert';

import { BASE, closeTestServer } from './helpers/test-server.js';

// 1. 404 for missing session
const r404 = await fetch(`${BASE}/api/sessions/nonexistent/replay`);
assert.strictEqual(r404.status, 404, 'replay 404 for missing session');

// 2. Create a session
const createRes = await fetch(`${BASE}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'replay-test', endpoint: 'primary', experience: 'developer' }),
});
const { session } = await createRes.json();
const sid = session.id;

// 3. Replay on empty session returns 0 steps
const replayEmpty = await fetch(`${BASE}/api/sessions/${sid}/replay`);
assert.strictEqual(replayEmpty.status, 200, 'replay 200 for empty session');
const emptyData = await replayEmpty.json();
assert.ok(emptyData.success, 'success flag');
assert.strictEqual(emptyData.replay.totalSteps, 0, 'empty session has 0 steps');
assert.ok(Array.isArray(emptyData.replay.steps), 'steps is array');
assert.strictEqual(emptyData.replay.sessionId, sid, 'sessionId matches');
assert.ok(typeof emptyData.replay.name === 'string', 'name present');
assert.ok(typeof emptyData.replay.experience === 'string', 'experience present');
assert.ok(typeof emptyData.replay.model === 'string', 'model present');

// 4. After injecting messages via clear-messages sanity check the shape
// (We can't call real LLM in unit tests; verify empty messages case shape only)
assert.deepStrictEqual(emptyData.replay.steps, [], 'empty session steps array is empty');

// Cleanup
await fetch(`${BASE}/api/sessions/${sid}`, { method: 'DELETE' });


closeTestServer();
console.log('Session replay tests passed.');
