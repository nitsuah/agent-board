/**
 * Tests for GET /api/workspace/git/log
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
delete process.env.WORKSPACE_ROOT; // no workspace in test env

const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

try {
  // Without workspace configured → 503
  const res = await fetch(`${base}/api/workspace/git/log`);
  const data = await res.json();
  assert.equal(res.status, 503, 'no workspace → 503');
  assert.ok(data.error, 'should have error message');

  // limit capped at 100
  const res2 = await fetch(`${base}/api/workspace/git/log?limit=999`);
  assert.equal(res2.status, 503, 'still 503 without workspace');

  console.log('Workspace git log tests passed.');
} catch (err) {
  console.error('Workspace git log tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
}
