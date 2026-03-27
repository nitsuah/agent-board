import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
delete process.env.DATABASE_URL;

const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const res = await fetch(`${base}/api/persistence/status`);
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.success, true);
  assert.equal(typeof data.persistence, 'object');
  assert.equal(data.persistence.enabled, false);
  assert.equal(data.persistence.configured, false);

  console.log('Persistence status test passed.');
} catch (error) {
  console.error('Persistence status test failed:', error.message);
  process.exit(1);
} finally {
  server.close();
}
