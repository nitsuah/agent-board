/**
 * Tests for experiences API
 * GET /api/experiences — lists available experiences and their configs
 */
import assert from 'node:assert/strict';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';

const { app } = await import('../server.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

try {
  console.log('Experiences API tests');

  const res = await fetch(`${base}/api/experiences`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true, 'returns success');
  assert.ok(data.experiences, 'has experiences object');

  const EXPECTED = ['developer', 'research', 'safechat', 'content_gen', 'website'];
  for (const exp of EXPECTED) {
    assert.ok(data.experiences[exp], `experience '${exp}' is present`);
  }

  // Each experience should have name, safetyMode, icon
  for (const [key, cfg] of Object.entries(data.experiences)) {
    assert.ok(cfg.name, `${key} has name`);
    assert.ok(cfg.safetyMode, `${key} has safetyMode`);
    assert.ok(cfg.icon, `${key} has icon`);
  }

  // safechat should be strict mode
  assert.equal(data.experiences.safechat.safetyMode, 'strict', 'safechat is strict');

  console.log('✓ All experiences API tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  server.close();
}
