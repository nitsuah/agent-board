import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const SECRET = 'test-webhook-secret-abc123';
process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
process.env.WEBHOOK_SECRET = SECRET;

const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

function sign(secret, body) {
  const mac = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${mac}`;
}

async function post(path, body, headers = {}) {
  const bodyStr = JSON.stringify(body);
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: bodyStr,
  });
  return { status: res.status, data: await res.json() };
}

try {
  const payload = { event: 'ci_pass', source: 'test' };
  const bodyStr = JSON.stringify(payload);

  // Valid signature
  const good = await post('/api/webhooks/trigger', payload, {
    'x-hub-signature-256': sign(SECRET, bodyStr),
  });
  assert.equal(good.status, 200, 'valid HMAC should return 200');
  assert.equal(good.data.success, true, 'valid HMAC should succeed');

  // Wrong signature
  const bad = await post('/api/webhooks/trigger', payload, {
    'x-hub-signature-256': 'sha256=deadbeef',
  });
  assert.equal(bad.status, 401, 'invalid HMAC should return 401');
  assert.equal(bad.data.success, false, 'invalid HMAC should fail');

  // Missing signature
  const missing = await post('/api/webhooks/trigger', payload);
  assert.equal(missing.status, 401, 'missing HMAC should return 401');

  // Correct sig but wrong secret
  const wrongSecret = await post('/api/webhooks/trigger', payload, {
    'x-hub-signature-256': sign('wrong-secret', bodyStr),
  });
  assert.equal(wrongSecret.status, 401, 'signature from wrong secret should return 401');

  console.log('Webhook HMAC tests passed.');
} catch (err) {
  console.error('Webhook HMAC tests failed:', err.message);
  process.exit(1);
} finally {
  server.close();
  // clean up env so it doesn't bleed
  delete process.env.WEBHOOK_SECRET;
}
