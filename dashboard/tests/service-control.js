/**
 * Unit tests for POST /api/system/services/:serviceKey/:action
 * and GET /api/system/services shape.
 *
 * Uses the embedded-server pattern — no running Docker container required.
 * Run standalone:
 *   node --experimental-vm-modules tests/service-control.js
 * Or via the test:unit npm script.
 */
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
    console.log('Service control API tests');

    // 1. Invalid action → 400
    {
      const res = await request('/api/system/services/ollama/explode', { method: 'POST' });
      assert.equal(res.status, 400, `invalid action should return 400, got ${res.status}`);
      assert.equal(res.data.success, false, 'invalid action response.success should be false');
      console.log('  ✅ Invalid action (explode) → 400');
    }

    // 2. Unknown service → 404
    {
      const res = await request('/api/system/services/does_not_exist/start', { method: 'POST' });
      assert.equal(res.status, 404, `unknown service should return 404, got ${res.status}`);
      assert.equal(res.data.success, false, 'unknown service response.success should be false');
      console.log('  ✅ Unknown service (does_not_exist) → 404');
    }

    // 3. bb_mcp start — controllable=false when BB_MCP_ENABLED=false (default) → 400
    {
      const res = await request('/api/system/services/bb_mcp/start', { method: 'POST' });
      assert.equal(res.status, 400, `bb_mcp start should return 400 (controllable=false), got ${res.status}`);
      assert.equal(res.data.success, false, 'bb_mcp start response.success should be false');
      console.log('  ✅ bb_mcp start (controllable=false) → 400');
    }

    // 4. llm_openllm start — controllable=false when OPENLLM_ENABLED=false (default) → 400
    {
      const res = await request('/api/system/services/llm_openllm/start', { method: 'POST' });
      assert.equal(res.status, 400, `llm_openllm start should return 400 (controllable=false), got ${res.status}`);
      assert.equal(res.data.success, false, 'llm_openllm start response.success should be false');
      console.log('  ✅ llm_openllm start (controllable=false) → 400');
    }

    // 5. ollama start — controllable=true but DOCKER_CONTROL_ENABLED=false (default) → 501
    {
      const res = await request('/api/system/services/ollama/start', { method: 'POST' });
      assert.equal(res.status, 501, `ollama start should return 501 (docker control disabled), got ${res.status}`);
      assert.equal(res.data.success, false, 'ollama start response.success should be false');
      assert.ok(
        /AGENT_BOARD_ENABLE_DOCKER_CONTROL/.test(res.data.error || ''),
        `ollama start error message should mention AGENT_BOARD_ENABLE_DOCKER_CONTROL, got: "${res.data.error}"`
      );
      console.log('  ✅ ollama start (docker control disabled) → 501 with correct message');
    }

    // 6. tool_content_gen start — controllable=true but DOCKER_CONTROL_ENABLED=false (default) → 501
    {
      const res = await request('/api/system/services/tool_content_gen/start', { method: 'POST' });
      assert.equal(res.status, 501, `tool_content_gen start should return 501, got ${res.status}`);
      assert.equal(res.data.success, false, 'tool_content_gen start response.success should be false');
      assert.ok(
        /AGENT_BOARD_ENABLE_DOCKER_CONTROL/.test(res.data.error || ''),
        `tool_content_gen start error should mention AGENT_BOARD_ENABLE_DOCKER_CONTROL, got: "${res.data.error}"`
      );
      console.log('  ✅ tool_content_gen start (docker control disabled) → 501 with correct message');
    }

    // 7. GET /api/system/services shape
    {
      const res = await request('/api/system/services');
      assert.equal(res.status, 200, `GET /api/system/services should return 200, got ${res.status}`);
      assert.equal(res.data.success, true, 'GET services response.success should be true');

      const services = res.data.services;
      assert.ok(typeof services === 'object' && services !== null, 'services should be an object');

      const expectedKeys = ['ollama', 'nemoclaw', 'tool_content_gen', 'tool_website', 'bb_mcp', 'llm_openllm'];
      for (const key of expectedKeys) {
        assert.ok(key in services, `services.${key} should be present`);
        const svc = services[key];
        assert.equal(typeof svc.controllable, 'boolean',
          `services.${key}.controllable should be boolean, got ${typeof svc.controllable}`);
        assert.equal(typeof svc.running, 'boolean',
          `services.${key}.running should be boolean, got ${typeof svc.running}`);
      }
      console.log(`  ✅ GET /api/system/services shape valid (keys: ${expectedKeys.join(', ')})`);
    }

    console.log('Service control API tests passed.');
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error('Service control API tests failed:', error.message);
  process.exit(1);
});
