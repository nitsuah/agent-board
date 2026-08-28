/**
 * Tests for session command interface: restart and stop
 */
import assert from 'assert';

import { BASE, closeTestServer } from './helpers/test-server.js';

async function makeSession(name) {
  const res = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, endpoint: 'primary', experience: 'developer' }),
  });
  const data = await res.json();
  return data.session.id;
}

// 1. Restart: 404 for missing session
const r404 = await fetch(`${BASE}/api/sessions/no-such-session/restart`, { method: 'POST' });
assert.strictEqual(r404.status, 404, 'restart 404 for missing session');

// 2. Stop: 404 for missing session
const s404 = await fetch(`${BASE}/api/sessions/no-such-session/stop`, { method: 'POST' });
assert.strictEqual(s404.status, 404, 'stop 404 for missing session');

// 3. Restart a real session resets status and errorCount
const sid = await makeSession('cmd-test');
const restartRes = await fetch(`${BASE}/api/sessions/${sid}/restart`, { method: 'POST' });
assert.strictEqual(restartRes.status, 200, 'restart returns 200');
const restartData = await restartRes.json();
assert.ok(restartData.success, 'restart success');
assert.strictEqual(restartData.status, 'idle', 'restarted session is idle');
assert.strictEqual(restartData.cleared, 0, 'no messages to clear on fresh session');

// 4. Health check reflects idle status after restart
const healthRes = await fetch(`${BASE}/api/sessions/${sid}/health`);
const { health } = await healthRes.json();
assert.strictEqual(health.status, 'idle', 'health shows idle after restart');
assert.strictEqual(health.errorCount, 0, 'errorCount reset to 0');

// 5. Stop a session
const stopRes = await fetch(`${BASE}/api/sessions/${sid}/stop`, { method: 'POST' });
assert.strictEqual(stopRes.status, 200, 'stop returns 200');
const stopData = await stopRes.json();
assert.ok(stopData.success, 'stop success');
assert.strictEqual(stopData.status, 'stopped', 'status is stopped');

// 6. Stop is idempotent
const stop2Res = await fetch(`${BASE}/api/sessions/${sid}/stop`, { method: 'POST' });
const stop2Data = await stop2Res.json();
assert.ok(stop2Data.already === true, 'second stop returns already:true');

// 7. Health check reflects stopped status
const healthAfterStop = await fetch(`${BASE}/api/sessions/${sid}/health`);
const { health: h2 } = await healthAfterStop.json();
assert.strictEqual(h2.status, 'stopped', 'health shows stopped');

// Cleanup
await fetch(`${BASE}/api/sessions/${sid}`, { method: 'DELETE' });


closeTestServer();
console.log('Session command tests passed.');
