import assert from 'node:assert/strict';
import axios from 'axios';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';

const { app } = await import('../server.js');

const server = app.listen(0);
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

async function request(path, { method = 'GET', data } = {}) {
  const res = await axios({ method, url: `${BASE}${path}`, data, timeout: 10000, validateStatus: () => true });
  return res;
}

async function run() {
  try {
    console.log('Session edge-case tests');

    // --- Session CRUD ---
    const create = await request('/api/sessions', {
      method: 'POST',
      data: { userId: 'edge-test', endpoint: 'primary', model: 'llama3.2:3b', experience: 'developer' },
    });
    assert.equal(create.status, 200, 'session creation should succeed');
    const sid = create.data.session.id;

    // --- Message validation ---
    const emptyMsg = await request(`/api/sessions/${sid}/message`, {
      method: 'POST',
      data: { message: '' },
    });
    assert.equal(emptyMsg.status, 400, 'empty message should be rejected');

    const missingMsg = await request(`/api/sessions/${sid}/message`, {
      method: 'POST',
      data: {},
    });
    assert.equal(missingMsg.status, 400, 'missing message should be rejected');

    // --- Model switching ---
    const switchGood = await request(`/api/sessions/${sid}/model`, {
      method: 'PUT',
      data: { endpoint: 'primary', model: 'llama3.2:3b' },
    });
    assert.equal(switchGood.status, 200, 'valid model switch should succeed');
    assert.equal(switchGood.data.success, true, 'model switch should return success');

    const switchBadEndpoint = await request(`/api/sessions/${sid}/model`, {
      method: 'PUT',
      data: { endpoint: 'nonexistent_endpoint_xyz', model: 'anything' },
    });
    assert.equal(switchBadEndpoint.status, 400, 'invalid endpoint should be rejected');

    const switchMissingEndpoint = await request(`/api/sessions/${sid}/model`, {
      method: 'PUT',
      data: { model: 'llama3.2:3b' },
    });
    assert.equal(switchMissingEndpoint.status, 400, 'missing endpoint should be rejected');

    // --- 404 paths ---
    const missingSession = await request('/api/sessions/no-such-session-id-xyz/message', {
      method: 'POST',
      data: { message: 'hello' },
    });
    assert.equal(missingSession.status, 404, 'message to missing session should 404');

    const missingModel = await request('/api/sessions/no-such-session-id-xyz/model', {
      method: 'PUT',
      data: { endpoint: 'primary', model: 'x' },
    });
    assert.equal(missingModel.status, 404, 'model switch on missing session should 404');

    // --- Session delete ---
    const del = await request(`/api/sessions/${sid}`, { method: 'DELETE' });
    assert.equal(del.status, 200, 'delete should succeed');
    assert.equal(del.data.deleted, true, 'deleted flag should be true');

    const delAgain = await request(`/api/sessions/${sid}`, { method: 'DELETE' });
    assert.equal(delAgain.status, 200, 'deleting already-deleted session should succeed');
    assert.equal(delAgain.data.deleted, false, 'deleted flag should be false for already-deleted');

    // --- Session listing ---
    const list = await request('/api/sessions');
    assert.equal(list.status, 200, 'session listing should succeed');
    assert.ok(Array.isArray(list.data.sessions), 'sessions should be an array');

    console.log('Session edge-case tests passed.');
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('Session edge-case tests failed:', err.message);
  process.exit(1);
});
