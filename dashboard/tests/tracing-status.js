#!/usr/bin/env node
/**
 * Test: OpenTelemetry tracing status
 *
 * Verifies the /api/tracing/status endpoint correctly reports
 * tracing state based on OTEL_ENABLED env var.
 */

import assert from 'assert';
import http from 'http';

const PORT = process.env.PORT || 3000;

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: PORT, path }, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('Tracing status test');

  // Test: GET /api/tracing/status returns expected shape
  const result = await get('/api/tracing/status');
  assert.strictEqual(result.status, 200, `Expected 200, got ${result.status}`);
  assert.strictEqual(result.body.success, true, 'Response should indicate success');
  assert(result.body.tracing, 'Response should include tracing field');
  assert('initialized' in result.body.tracing, 'tracing.initialized should be present');
  assert('enabled' in result.body.tracing, 'tracing.enabled should be present');

  // Endpoint field: present when enabled, null (or omitted) when disabled
  if (result.body.tracing.enabled) {
    assert(result.body.tracing.endpoint, 'endpoint should be set when tracing is enabled');
  } else {
    // When disabled the endpoint is null (not sending anywhere)
    assert(
      result.body.tracing.endpoint === null || result.body.tracing.endpoint === undefined,
      'endpoint should be null when tracing is disabled'
    );
  }

  console.log(
    `  ✅ /api/tracing/status shape valid (enabled=${result.body.tracing.enabled}, initialized=${result.body.tracing.initialized})`
  );
  console.log('Tracing status test passed.');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Tracing status test failed:', err.message);
  process.exit(1);
});
