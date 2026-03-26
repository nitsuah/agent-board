import assert from 'node:assert/strict';
import axios from 'axios';
import { WebSocket } from 'ws';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';

const { app, attachEventWebSocketServer } = await import('../server.js');

const server = app.listen(0);
attachEventWebSocketServer(server);

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
  return response.data;
}

async function waitForEvent(ws, predicate, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timed out waiting for websocket event'));
    }, timeoutMs);

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        if (payload.type === 'event' && predicate(payload.event)) {
          clearTimeout(timer);
          resolve(payload.event);
        }
      } catch {
        // Ignore malformed payload.
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function run() {
  try {
    console.log('WebSocket event streaming test');

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/events`);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const waitForSessionStart = waitForEvent(ws, (event) => event?.event_type === 'session_start');

    const created = await request('/api/sessions', {
      method: 'POST',
      data: {
        name: 'ws-test-session',
        endpoint: 'primary',
        experience: 'safechat',
        model: 'llama2:latest'
      }
    });

    assert.equal(created.success, true);

    const streamedEvent = await waitForSessionStart;
    assert.equal(streamedEvent.event_type, 'session_start');
    assert.equal(streamedEvent.session_id, created.session.id);

    ws.close();

    console.log('WebSocket event streaming test passed.');
  } finally {
    server.close();
  }
}

run().catch((error) => {
  console.error('WebSocket event streaming test failed:', error.message);
  process.exit(1);
});
