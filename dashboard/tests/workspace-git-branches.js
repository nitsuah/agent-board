/**
 * Tests for GET /api/workspace/git/branches
 * Verifies 503 when no workspace configured and shape of response structure.
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
delete process.env.WORKSPACE_ROOT;

const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

try {
  // Without workspace → 503
  const res = await fetch(`${base}/api/workspace/git/branches`);
  const data = await res.json();
  assert.equal(res.status, 503, 'no workspace → 503');
  assert.ok(data.error, 'should have error message');

  // Other workspace git endpoints also return 503 without config
  const status = await fetch(`${base}/api/workspace/git/status`);
  assert.equal(status.status, 503, 'git status without workspace → 503');

  const log = await fetch(`${base}/api/workspace/git/log`);
  assert.equal(log.status, 503, 'git log without workspace → 503');

  console.log('Workspace git branches tests passed.');
} catch (err) {
  console.error('Workspace git branches tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
