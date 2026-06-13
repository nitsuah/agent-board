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
    timeout: 15000,
    validateStatus: () => true,
  });
  return { status: response.status, data: response.data };
}

async function run() {
  try {
    console.log('Model pull API tests');

    const unknown = await request('/api/models/pull', { method: 'POST', data: { endpoint: 'does-not-exist' } });
    assert.equal(unknown.status, 400, 'unknown endpoint should return 400');
    assert.equal(unknown.data.success, false, 'unknown endpoint response should be unsuccessful');

    const openllm = await request('/api/models/pull', { method: 'POST', data: { endpoint: 'openllm', model: 'some/model' } });
    assert.equal(openllm.status, 400, 'openllm pull should return 400 (not supported)');
    assert.equal(openllm.data.success, false, 'openllm pull response should be unsuccessful');

    const dockerRunner = await request('/api/models/pull', { method: 'POST', data: { endpoint: 'docker_runner' } });
    assert.equal(dockerRunner.status, 501, 'docker_runner pull without AGENT_BOARD_ENABLE_DOCKER_CONTROL should return 501');
    assert.equal(dockerRunner.data.success, false, 'docker_runner pull response should be unsuccessful');
    assert.match(dockerRunner.data.error, /docker model pull/, 'error should point to the manual docker model pull command');

    const primary = await request('/api/models/pull', { method: 'POST', data: { endpoint: 'primary', model: 'llama3.2:3b' } });
    assert.equal(primary.status, 202, 'primary (ollama) pull should return 202 (started)');
    assert.equal(primary.data.success, true, 'primary pull response should be successful');
    assert.equal(primary.data.status, 'pulling', 'primary pull should start in pulling status');

    // A second request for the same endpoint/model while still pulling should be deduped.
    const duplicate = await request('/api/models/pull', { method: 'POST', data: { endpoint: 'primary', model: 'llama3.2:3b' } });
    assert.equal(duplicate.status, 200, 'duplicate in-flight pull request should return 200');
    assert.equal(duplicate.data.success, true, 'duplicate pull response should be successful');
    assert.equal(duplicate.data.status, 'pulling', 'duplicate pull response should report pulling status');

    // The background pull settles quickly either way: it fails if ollama is unreachable
    // (isolated test env), or completes immediately if the model is already cached
    // (live stack with a reachable ollama).
    let pullEntry = null;
    for (let i = 0; i < 40; i++) {
      const statusRes = await request('/api/models/pull-status');
      assert.equal(statusRes.status, 200, 'pull-status endpoint should return 200');
      assert.equal(statusRes.data.success, true, 'pull-status response should be successful');
      pullEntry = statusRes.data.pulls['primary:llama3.2:3b'];
      if (pullEntry && pullEntry.status !== 'pulling') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(pullEntry, 'pull-status should contain an entry for primary:llama3.2:3b');
    assert.ok(
      pullEntry.status === 'failed' || pullEntry.status === 'completed',
      `pull should resolve to failed or completed, got ${pullEntry.status}`
    );
    if (pullEntry.status === 'failed') {
      assert.equal(typeof pullEntry.error, 'string', 'failed pull should record an error message');
    }

    console.log('Model pull API tests passed.');
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error('Model pull API tests failed:', error.message);
  process.exit(1);
});
