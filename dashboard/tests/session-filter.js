/**
 * Tests for GET /api/sessions with ?experience= and ?userId= filters
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';

const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function req(path, { method = 'GET', data } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

try {
  console.log('Session filter tests');

  // Create two sessions with different experiences
  const s1 = await req('/api/sessions', { method: 'POST', data: { userId: 'user-a', endpoint: 'primary', model: 'llama3.2', experience: 'developer' } });
  const s2 = await req('/api/sessions', { method: 'POST', data: { userId: 'user-b', endpoint: 'primary', model: 'llama3.2', experience: 'research' } });
  const s3 = await req('/api/sessions', { method: 'POST', data: { userId: 'user-a', endpoint: 'primary', model: 'llama3.2', experience: 'research' } });

  assert.equal(s1.status, 200, 'session 1 create should succeed');
  assert.equal(s2.status, 200, 'session 2 create should succeed');
  assert.equal(s3.status, 200, 'session 3 create should succeed');

  // No filter: all 3 sessions present
  const all = await req('/api/sessions');
  assert.ok(all.data.sessions.length >= 3, 'unfiltered should return all sessions');

  // Filter by experience=developer
  const devOnly = await req('/api/sessions?experience=developer');
  assert.equal(devOnly.status, 200, 'experience filter should succeed');
  assert.ok(devOnly.data.sessions.every(s => s.experience === 'developer'), 'all returned sessions should be developer');
  const devIds = devOnly.data.sessions.map(s => s.id);
  assert.ok(devIds.includes(s1.data.session.id), 's1 (developer) should appear');
  assert.ok(!devIds.includes(s2.data.session.id), 's2 (research) should not appear');

  // Filter by userId=user-a
  const userA = await req('/api/sessions?userId=user-a');
  assert.equal(userA.status, 200, 'userId filter should succeed');
  assert.ok(userA.data.sessions.every(s => s.userId === 'user-a'), 'all returned sessions should be user-a');
  const userAIds = userA.data.sessions.map(s => s.id);
  assert.ok(userAIds.includes(s1.data.session.id), 's1 should be in user-a results');
  assert.ok(userAIds.includes(s3.data.session.id), 's3 should be in user-a results');
  assert.ok(!userAIds.includes(s2.data.session.id), 's2 (user-b) should not be in user-a results');

  // Combined filter: experience=research&userId=user-a
  const combo = await req('/api/sessions?experience=research&userId=user-a');
  assert.equal(combo.status, 200, 'combined filter should succeed');
  const comboIds = combo.data.sessions.map(s => s.id);
  assert.ok(comboIds.includes(s3.data.session.id), 's3 (research + user-a) should match');
  assert.ok(!comboIds.includes(s1.data.session.id), 's1 (developer) should not match');
  assert.ok(!comboIds.includes(s2.data.session.id), 's2 (user-b) should not match');

  console.log('Session filter tests passed.');
} catch (err) {
  console.error('Session filter tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
