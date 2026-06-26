/**
 * Tests for file-based session snapshot persistence.
 * Verifies the snapshot module API shape and that session data
 * is preserved across the module's in-memory lifecycle.
 */
import assert from 'assert';
import { initSessionSnapshot, scheduleSnapshotWrite } from '../modules/session-snapshot.js';
import { existsSync } from 'fs';
import { join } from 'path';

// 1. initSessionSnapshot with an empty sessions Map does not throw
const map1 = new Map();
initSessionSnapshot(map1, null);

// 2. Schedule a write does not throw with null log
scheduleSnapshotWrite(null);

// 3. After init, the data directory exists
const dataDir = join(process.cwd(), 'data');
assert.ok(existsSync(dataDir), 'data directory was created by initSessionSnapshot');

// 4. A session added to the map before scheduleSnapshotWrite gets flushed
const map2 = new Map();
initSessionSnapshot(map2, null);
map2.set('test-snap-1', {
  id: 'test-snap-1', name: 'snap-test', endpoint: 'primary', model: 'llama3.2:3b',
  experience: 'developer', messages: [], createdAt: new Date(), updatedAt: new Date(),
  status: 'idle', errorCount: 0,
});
scheduleSnapshotWrite(null);

// Give the debounce time to flush (3s > 2s debounce)
await new Promise(r => setTimeout(r, 3000));

const snapshotPath = join(process.cwd(), 'data', 'sessions-snapshot.json');
assert.ok(existsSync(snapshotPath), 'sessions-snapshot.json was written');

// 5. Snapshot file is valid JSON with expected shape
const { readFileSync } = await import('fs');
const raw = readFileSync(snapshotPath, 'utf8');
const parsed = JSON.parse(raw);
assert.ok(typeof parsed.savedAt === 'string', 'savedAt timestamp present');
assert.ok(Array.isArray(parsed.sessions), 'sessions array present');
const snap = parsed.sessions.find(s => s.id === 'test-snap-1');
assert.ok(snap, 'test session found in snapshot');
assert.strictEqual(snap.name, 'snap-test', 'session name preserved');

// 6. A new Map hydrated from the same file via initSessionSnapshot restores the session
const map3 = new Map();
initSessionSnapshot(map3, null);
assert.ok(map3.has('test-snap-1'), 'session restored from snapshot on re-init');
assert.strictEqual(map3.get('test-snap-1').name, 'snap-test', 'name preserved after restore');

console.log('Session persistence tests passed.');
