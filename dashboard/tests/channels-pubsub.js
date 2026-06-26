/**
 * Tests for named pub/sub event channels
 * GET  /api/channels
 * GET  /api/channels/:name/history
 * POST /api/channels/:name/publish
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
const { app } = await import('../server.js');

const server = app.listen(0);
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}`;

// 1. GET /api/channels — empty initially
const listRes = await fetch(`${BASE}/api/channels`);
assert.strictEqual(listRes.status, 200);
const listData = await listRes.json();
assert.strictEqual(listData.success, true);
assert.ok(Array.isArray(listData.channels));
console.log('  ✅ GET /api/channels returns list');

// 2. POST /api/channels/:name/publish — missing event_type → 400
const bad = await fetch(`${BASE}/api/channels/test-channel/publish`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
});
assert.strictEqual(bad.status, 400);
console.log('  ✅ publish without event_type → 400');

// 3. Publish an event to a named channel
const pubRes = await fetch(`${BASE}/api/channels/build-passed/publish`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event_type: 'build.success', metadata: { branch: 'main', sha: 'abc123' } }),
});
assert.strictEqual(pubRes.status, 200);
const pubData = await pubRes.json();
assert.strictEqual(pubData.success, true);
assert.strictEqual(pubData.channel, 'build-passed');
assert.ok(pubData.event?.event_id, 'published event has an id');
assert.strictEqual(pubData.event.event_type, 'build.success');
assert.strictEqual(pubData.event.channel, 'build-passed');
console.log('  ✅ publish to named channel returns event with channel field');

// 4. Channel appears in list after publish
const listRes2 = await fetch(`${BASE}/api/channels`);
const listData2 = await listRes2.json();
const found = listData2.channels.find(c => c.name === 'build-passed');
assert.ok(found, 'build-passed channel in list');
assert.strictEqual(found.recentEvents, 1);
console.log('  ✅ channel appears in list after publish');

// 5. GET channel history
const histRes = await fetch(`${BASE}/api/channels/build-passed/history`);
assert.strictEqual(histRes.status, 200);
const histData = await histRes.json();
assert.strictEqual(histData.success, true);
assert.strictEqual(histData.count, 1);
assert.strictEqual(histData.events[0].channel, 'build-passed');
assert.deepEqual(histData.events[0].metadata, { branch: 'main', sha: 'abc123' });
console.log('  ✅ GET channel history returns published events');

// 6. Invalid channel name → 400
const invalidRes = await fetch(`${BASE}/api/channels/bad channel name!/publish`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event_type: 'test' }),
});
assert.strictEqual(invalidRes.status, 400);
console.log('  ✅ invalid channel name → 400');

// 7. Limit param on history
await fetch(`${BASE}/api/channels/build-passed/publish`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event_type: 'build.success', metadata: { run: 2 } }),
});
const histLimited = await fetch(`${BASE}/api/channels/build-passed/history?limit=1`);
const histLimitedData = await histLimited.json();
assert.strictEqual(histLimitedData.count, 1, 'limit=1 returns 1 event');
console.log('  ✅ history limit param works');

// 8. Publish to multiple channels
await fetch(`${BASE}/api/channels/file-saved/publish`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event_type: 'file.saved', metadata: { path: '/src/main.js' } }),
});
const listRes3 = await fetch(`${BASE}/api/channels`);
const listData3 = await listRes3.json();
assert.ok(listData3.channels.some(c => c.name === 'file-saved'), 'file-saved in channel list');
assert.ok(listData3.channels.some(c => c.name === 'build-passed'), 'build-passed still in list');
console.log('  ✅ multiple channels listed independently');

server.close();
console.log('Named pub/sub channel tests passed.');
