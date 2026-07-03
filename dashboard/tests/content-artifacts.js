/**
 * Tests for content/artifacts API
 * GET /api/content/clients, GET /api/artifacts, GET /api/artifacts/:name/download
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';

const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function req(path, { method = 'GET' } = {}) {
  const res = await fetch(`${base}${path}`, { method });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, data: body };
}

try {
  console.log('Content & artifacts API tests');

  // GET /api/content/clients — should return array (empty if no output dir)
  const clients = await req('/api/content/clients');
  assert.equal(clients.status, 200);
  assert.ok(clients.data.success === true, 'clients endpoint returns success');
  assert.ok(Array.isArray(clients.data.clients), 'clients is an array');

  // GET /api/content/clients/:slug/files — invalid slug rejected
  const badSlug = await req('/api/content/clients/../../etc/files');
  assert.ok(badSlug.status >= 400, 'path traversal slug rejected');

  // GET /api/artifacts — should return array
  const artifacts = await req('/api/artifacts');
  assert.equal(artifacts.status, 200);
  assert.ok(Array.isArray(artifacts.data), 'artifacts returns array');

  // GET /api/artifacts/:name/download — nonexistent returns 404
  const dlMissing = await req('/api/artifacts/nonexistent_file_xyz/download');
  assert.ok(dlMissing.status >= 400, 'missing artifact download fails');

  // GET /api/content/download/:slug/* — path traversal blocked
  const traverse = await req('/api/content/download/testslug/../../etc/passwd');
  assert.ok(traverse.status >= 400, 'path traversal in download blocked');

  console.log('✓ All content & artifacts tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
