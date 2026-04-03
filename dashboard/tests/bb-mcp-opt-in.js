import assert from 'node:assert/strict';
import axios from 'axios';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
process.env.BB_MCP_ENABLED = 'false';

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
    console.log('bb-mcp opt-in tests');

    const connectors = await request('/api/connectors');
    assert.equal(connectors.status, 200, 'connectors endpoint should return 200');
    assert.equal(connectors.data.success, true, 'connectors endpoint should succeed');
    const blackboard = (connectors.data.connectors || []).find((c) => c.id === 'blackboard-learn');
    assert.equal(blackboard, undefined, 'blackboard connector should be hidden when BB_MCP_ENABLED=false');

    const proxy = await request('/api/mcp/blackboard-learn/health');
    assert.equal(proxy.status, 404, 'blackboard proxy should not be routable when BB_MCP_ENABLED=false');
    assert.equal(proxy.data.success, false, 'proxy response should indicate failure for disabled connector');

    console.log('bb-mcp opt-in tests passed.');
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error('bb-mcp opt-in tests failed:', error.message);
  process.exit(1);
});
