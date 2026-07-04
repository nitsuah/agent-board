/**
 * Tests for encrypted endpoint persistence (endpoint-store.js)
 * Verifies save/load cycle with AES-256-GCM encryption per API key
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Set up isolated temp directory BEFORE importing the module
const testDir = mkdtempSync(join(tmpdir(), 'ep-store-test-'));
const storePath = join(testDir, 'endpoints.json');

process.env.ENDPOINT_STORE_PATH = storePath;
process.env.ENDPOINT_STORE_SECRET = 'test-secret-key-for-e2e';

const { loadEndpoints, saveEndpoints } = await import('../modules/endpoint-store.js');

try {
  console.log('Endpoint persistence tests');

  // Initially empty (no file exists)
  const initial = loadEndpoints();
  assert.ok(Array.isArray(initial), 'loadEndpoints returns array');
  assert.equal(initial.length, 0, 'initially empty');

  // Save endpoints — one with API key, one without
  const endpoints = [
    { key: 'test_ollama', name: 'Ollama', url: 'http://localhost:11434', apiStyle: 'ollama' },
    { key: 'test_claude', name: 'Claude', url: 'https://api.anthropic.com', apiStyle: 'anthropic', apiKey: 'sk-test-123' },
  ];
  saveEndpoints(endpoints);
  assert.ok(existsSync(storePath), 'store file created');

  // Load back — should decrypt and match
  const loaded = loadEndpoints();
  assert.equal(loaded.length, 2, 'loaded same count');
  assert.equal(loaded[0].key, 'test_ollama');
  assert.equal(loaded[0].apiKey, undefined, 'no-key endpoint has no apiKey');
  assert.equal(loaded[1].key, 'test_claude');
  assert.equal(loaded[1].apiKey, 'sk-test-123', 'API key preserved through encrypt/decrypt');

  // Verify the file has encrypted keys, not plaintext
  const raw = readFileSync(storePath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(!raw.includes('sk-test-123'), 'API key not stored in plaintext');
  const claudeEntry = parsed.find(e => e.key === 'test_claude');
  assert.ok(claudeEntry._encryptedApiKey, 'has _encryptedApiKey field');
  assert.ok(claudeEntry._encryptedApiKey.startsWith('v1:'), 'encrypted key uses v1: envelope');
  assert.equal(claudeEntry.apiKey, undefined, 'raw apiKey stripped from stored JSON');

  // No-key endpoint stored without encryption
  const ollamaEntry = parsed.find(e => e.key === 'test_ollama');
  assert.equal(ollamaEntry._encryptedApiKey, undefined, 'no-key endpoint has no _encryptedApiKey');

  // Overwrite with new data
  saveEndpoints([{ key: 'only_one', name: 'One', url: 'http://one.local' }]);
  const reloaded = loadEndpoints();
  assert.equal(reloaded.length, 1, 'overwrite works');
  assert.equal(reloaded[0].key, 'only_one');

  // Save empty clears
  saveEndpoints([]);
  const empty = loadEndpoints();
  assert.equal(empty.length, 0, 'saving empty array clears store');

  console.log('✓ All endpoint persistence tests passed');
} catch (e) {
  console.error('✗ FAIL:', e.message);
  process.exit(1);
} finally {
  rmSync(testDir, { recursive: true, force: true });
}
