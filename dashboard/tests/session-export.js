import assert from 'node:assert/strict';
import axios from 'axios';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';

const { app } = await import('../server.js');

const server = app.listen(0);
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

async function request(path, { method = 'GET', data, responseType } = {}) {
  const res = await axios({ method, url: `${BASE}${path}`, data, responseType, timeout: 10000, validateStatus: () => true });
  return res;
}

async function run() {
  try {
    console.log('Session export tests');

    // Create a session
    const create = await request('/api/sessions', {
      method: 'POST',
      data: { userId: 'export-test', endpoint: 'primary', model: 'llama3.2:3b', experience: 'developer' },
    });
    assert.equal(create.status, 200, 'session creation should succeed');
    const sid = create.data.session.id;

    // 404 for missing session
    const missing = await request('/api/sessions/no-such-id/export');
    assert.equal(missing.status, 404, 'export of missing session should 404');

    // Markdown export (default)
    const md = await request(`/api/sessions/${sid}/export`, { responseType: 'text' });
    assert.equal(md.status, 200, 'markdown export should succeed');
    assert.ok(md.headers['content-type']?.includes('text/markdown'), 'content-type should be markdown');
    assert.ok(md.headers['content-disposition']?.includes('.md'), 'disposition should have .md extension');
    assert.ok(typeof md.data === 'string' && md.data.includes('# '), 'markdown body should start with heading');

    // JSON export
    const json = await request(`/api/sessions/${sid}/export?format=json`);
    assert.equal(json.status, 200, 'json export should succeed');
    assert.equal(json.headers['content-type']?.split(';')[0], 'application/json', 'content-type should be json');
    assert.ok(json.data.id, 'json export should include session id');
    assert.ok(Array.isArray(json.data.messages), 'json export should include messages array');
    assert.equal(json.data.experience, 'developer', 'json export should include experience');

    // Cleanup
    await request(`/api/sessions/${sid}`, { method: 'DELETE' });

    console.log('Session export tests passed.');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('Session export tests failed:', err.message);
  process.exit(1);
});
