/**
 * Tests for /api/models with BYOK endpoint integration.
 * Verifies that endpoints added at runtime appear in model listing.
 */
import assert from 'assert';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// 1. /api/models returns base shape
const res = await fetch(`${BASE}/api/models`);
assert.strictEqual(res.status, 200, '/api/models returns 200');
const data = await res.json();
assert.ok(data.success === true, 'success flag is true');
assert.ok(Array.isArray(data.models), 'models is array');
assert.ok(Array.isArray(data.endpoints), 'endpoints list present');
const baseEndpointCount = data.endpoints.length;

// 2. Add a BYOK endpoint (pointing to something that won't respond — that's fine for listing)
const addRes = await fetch(`${BASE}/api/config/endpoints`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    key: 'test_byok_model',
    name: 'Test BYOK',
    url: 'http://127.0.0.1:19999',
    apiStyle: 'openai',
    defaultModel: 'test-model',
  }),
});
assert.strictEqual(addRes.status, 200, 'BYOK endpoint added');

// 3. The new endpoint key should appear in /api/models endpoints list
const res2 = await fetch(`${BASE}/api/models`);
const data2 = await res2.json();
assert.ok(data2.endpoints.includes('test_byok_model'), 'new endpoint key in models endpoint list');
assert.ok(data2.endpoints.length > baseEndpointCount, 'endpoint count increased');

// 4. Cleanup
await fetch(`${BASE}/api/config/endpoints/test_byok_model`, { method: 'DELETE' });
const res3 = await fetch(`${BASE}/api/models`);
const data3 = await res3.json();
assert.ok(!data3.endpoints.includes('test_byok_model'), 'removed endpoint no longer in list');

console.log('Models BYOK integration tests passed.');
