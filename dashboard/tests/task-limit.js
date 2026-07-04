/**
 * Tests for GET /api/tasks?limit= parameter
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
  const body = await res.json().catch(() => ({}));
  return { status: res.status, data: body };
}

try {
  console.log('Task limit tests');

  // Create 5 tasks
  for (let i = 1; i <= 5; i++) {
    const r = await req('/api/tasks', { method: 'POST', data: { title: `Limit test task ${i}` } });
    assert.equal(r.status, 200);
  }

  // Default fetch returns all
  const all = await req('/api/tasks');
  assert.equal(all.status, 200);
  assert.ok(all.data.tasks.length >= 5, 'should return at least 5 tasks');

  // limit=2 returns at most 2
  const limited = await req('/api/tasks?limit=2');
  assert.equal(limited.status, 200);
  assert.ok(limited.data.tasks.length <= 2, 'limit=2 should return at most 2 tasks');
  assert.ok(typeof limited.data.total === 'number', 'response should include total count');
  assert.ok(limited.data.total >= 5, 'total should reflect unfiltered count');

  // non-numeric limit falls back to default (100)
  const minLimit = await req('/api/tasks?limit=abc');
  assert.equal(minLimit.status, 200);
  assert.ok(Array.isArray(minLimit.data.tasks), 'non-numeric limit should return tasks array');

  // limit clamped to maximum 500
  const maxLimit = await req('/api/tasks?limit=9999');
  assert.equal(maxLimit.status, 200);
  assert.ok(maxLimit.data.tasks.length <= 500, 'limit=9999 should be clamped to 500');

  console.log('Task limit tests passed.');
} catch (err) {
  console.error('Task limit tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
