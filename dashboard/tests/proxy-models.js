/**
 * Tests for proxy-models endpoint
 * GET /api/proxy-models?endpoint=<key>
 * Proxies /v1/models or /api/tags from a registered endpoint
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
  console.log('Proxy models tests');

  // Missing endpoint param returns 400
  const noParam = await req('/api/proxy-models');
  assert.equal(noParam.status, 400, 'missing endpoint param should 400');

  // Unknown endpoint returns 404
  const unknown = await req('/api/proxy-models?endpoint=nonexistent_ep_xyz');
  assert.equal(unknown.status, 404, 'unknown endpoint should 404');

  // Valid endpoint that is unreachable — should return error but not crash
  // Register a custom endpoint pointing at nothing
  const add = await req('/api/config/endpoints', {
    method: 'POST',
    data: { key: 'test_proxy_dead', name: 'Dead Proxy', url: 'http://127.0.0.1:59999', apiStyle: 'openai' },
  });
  assert.equal(add.status, 200);

  // Proxy to unreachable endpoint — should return error gracefully
  const dead = await req('/api/proxy-models?endpoint=test_proxy_dead');
  // Should be 502 or 500, not a crash
  assert.ok(dead.status >= 400, 'unreachable endpoint should return error status');

  // Clean up
  await req('/api/config/endpoints/test_proxy_dead', { method: 'DELETE' });

  console.log('✓ All proxy models tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
