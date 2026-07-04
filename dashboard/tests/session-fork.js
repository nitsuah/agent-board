/**
 * Tests for POST /api/sessions/:id/fork
 */
import assert from 'assert';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// 1. 404 for missing parent
const r404 = await fetch(`${BASE}/api/sessions/nosuchsession/fork`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
});
assert.strictEqual(r404.status, 404, 'fork 404 for missing session');

// 2. Create parent session
const createRes = await fetch(`${BASE}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'fork-parent', endpoint: 'primary', experience: 'developer' }),
});
const { session: parent } = await createRes.json();
const pid = parent.id;

// 3. Fork from empty session (no atMessageIndex)
const forkRes = await fetch(`${BASE}/api/sessions/${pid}/fork`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
});
assert.strictEqual(forkRes.status, 200, 'fork returns 200');
const forkData = await forkRes.json();
assert.ok(forkData.success, 'fork success');
assert.ok(forkData.session.id !== pid, 'fork has different id from parent');
assert.ok(forkData.session.name.includes('fork'), 'fork name contains "fork"');
assert.strictEqual(forkData.session.messageCount, 0, 'empty parent fork has 0 messages');
assert.strictEqual(forkData.session.experience, parent.experience, 'fork inherits experience');

// 4. Fork appears in session list
const listRes = await fetch(`${BASE}/api/sessions`);
const listData = await listRes.json();
const forkInList = listData.sessions.find(s => s.id === forkData.session.id);
assert.ok(forkInList, 'fork appears in session list');

// 5. Fork with atMessageIndex=0 on empty session → 0 messages
const forkRes2 = await fetch(`${BASE}/api/sessions/${pid}/fork`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ atMessageIndex: 0 }),
});
const fork2 = await forkRes2.json();
assert.ok(fork2.success, 'fork with index 0 on empty session succeeds');
assert.strictEqual(fork2.session.messageCount, 0, '0 messages');

// 6. Fork has idle status
const forkHealthRes = await fetch(`${BASE}/api/sessions/${forkData.session.id}/health`);
const { health } = await forkHealthRes.json();
assert.strictEqual(health.status, 'idle', 'forked session starts idle');
assert.strictEqual(health.errorCount, 0, 'forked session has 0 errors');

// Cleanup
await fetch(`${BASE}/api/sessions/${pid}`, { method: 'DELETE' });
await fetch(`${BASE}/api/sessions/${forkData.session.id}`, { method: 'DELETE' });
await fetch(`${BASE}/api/sessions/${fork2.session.id}`, { method: 'DELETE' });

console.log('Session fork tests passed.');
