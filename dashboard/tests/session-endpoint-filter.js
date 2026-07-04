/**
 * Tests for GET /api/sessions?endpoint= filter
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
  console.log('Session endpoint filter tests');

  // Create two sessions — both resolve to primary in test env
  const s1 = await req('/api/sessions', { method: 'POST', data: { userId: 'ef-user', endpoint: 'primary', model: 'llama2' } });
  const s2 = await req('/api/sessions', { method: 'POST', data: { userId: 'ef-user', endpoint: 'primary', model: 'llama2', experience: 'safechat' } });

  assert.equal(s1.status, 200);
  assert.equal(s2.status, 200);

  const id1 = s1.data.session.id;
  const id2 = s2.data.session.id;
  const resolvedEndpoint = s1.data.session.endpoint;

  // Filter by the resolved endpoint — both sessions should appear
  const filtered = await req(`/api/sessions?endpoint=${resolvedEndpoint}`);
  assert.equal(filtered.status, 200);
  const filteredIds = filtered.data.sessions.map(s => s.id);
  assert.ok(filteredIds.includes(id1), 's1 should appear in endpoint filter');
  assert.ok(filteredIds.includes(id2), 's2 should appear in endpoint filter');

  // Unknown endpoint returns empty (not error)
  const unknown = await req('/api/sessions?endpoint=doesnotexist');
  assert.equal(unknown.status, 200, 'unknown endpoint filter should not error');
  const unknownIds = unknown.data.sessions.map(s => s.id);
  assert.ok(!unknownIds.includes(id1), 's1 should not appear in unknown endpoint filter');
  assert.ok(!unknownIds.includes(id2), 's2 should not appear in unknown endpoint filter');

  // Combined endpoint + experience filter narrows results
  const combined = await req(`/api/sessions?endpoint=${resolvedEndpoint}&experience=safechat`);
  assert.equal(combined.status, 200);
  const combinedIds = combined.data.sessions.map(s => s.id);
  assert.ok(combinedIds.includes(id2), 's2 (safechat) should appear in combined filter');
  assert.ok(!combinedIds.includes(id1), 's1 (developer) should not appear in safechat filter');

  console.log('Session endpoint filter tests passed.');
} catch (err) {
  console.error('Session endpoint filter tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
