import assert from 'node:assert/strict';
import axios from 'axios';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';

const { app } = await import('../server.js');

const server = app.listen(0);
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

async function request(path, { method = 'GET', data } = {}) {
  const response = await axios({
    method,
    url: `${BASE}${path}`,
    data,
    timeout: 10000,
    validateStatus: () => true,
  });
  return { status: response.status, data: response.data };
}

async function run() {
  try {
    console.log('System services API tests');

    const services = await request('/api/system/services');
    assert.equal(services.status, 200, 'system services endpoint should return 200');
    assert.equal(services.data.success, true, 'system services payload should be successful');
    assert.equal(typeof services.data.dockerControlEnabled, 'boolean', 'dockerControlEnabled should be boolean');
    assert.equal(Array.isArray(services.data.primaryLlm.candidates), true, 'primaryLlm candidates should be an array');
    assert.equal(typeof services.data.primaryLlm.resolvedUrl, 'string', 'primaryLlm resolvedUrl should be string');

    const info = await request('/api/system/info');
    assert.equal(info.status, 200, 'system info endpoint should return 200');
    assert.equal(info.data.success, true, 'system info payload should be successful');
    assert.equal(
      typeof info.data.system.environment.primaryLlmResolvedUrl,
      'string',
      'system info should expose resolved primary LLM URL'
    );

    console.log('System services API tests passed.');
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error('System services API tests failed:', error.message);
  process.exit(1);
});
