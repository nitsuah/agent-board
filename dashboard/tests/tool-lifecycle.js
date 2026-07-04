/**
 * Unit tests for JIT tool lifecycle (modules/tool-lifecycle.js)
 */
import assert from 'node:assert/strict';
import { ensureToolReady, experienceToolKey } from '../modules/tool-lifecycle.js';

const FAKE_TOOL_SERVERS = {
  content_gen: {
    key: 'content_gen',
    url: 'http://localhost:19999', // won't respond
    serviceKey: 'tool_content_gen',
    composeService: 'tool-content-gen',
    ports: '3200:3200',
  },
};

const FAKE_SERVICE_REGISTRY = {
  tool_content_gen: {
    key: 'tool_content_gen',
    composeService: 'tool-content-gen',
    composeProfile: 'tools',
  },
};

// 1. experienceToolKey maps known experiences
assert.strictEqual(experienceToolKey('content_gen', FAKE_TOOL_SERVERS), 'content_gen', 'content_gen maps to content_gen');
assert.strictEqual(experienceToolKey('website', {}), 'website', 'website maps to website');
assert.strictEqual(experienceToolKey('developer', FAKE_TOOL_SERVERS), null, 'developer has no tool');
assert.strictEqual(experienceToolKey('safechat', FAKE_TOOL_SERVERS), null, 'safechat has no tool');
console.log('  ✅ experienceToolKey');

// 2. unknown tool key returns error
const unknownResult = await ensureToolReady('nonexistent', FAKE_TOOL_SERVERS, FAKE_SERVICE_REGISTRY, false, null, null);
assert.strictEqual(unknownResult.ready, false, 'unknown tool: ready false');
assert.ok(unknownResult.error, 'unknown tool: has error message');
console.log('  ✅ unknown tool returns not-ready');

// 3. tool down + docker control disabled → not ready, no start
const noDockerResult = await ensureToolReady('content_gen', FAKE_TOOL_SERVERS, FAKE_SERVICE_REGISTRY, false, null, null);
assert.strictEqual(noDockerResult.ready, false, 'tool down, no docker: ready false');
assert.strictEqual(noDockerResult.started, false, 'tool down, no docker: not started');
assert.ok(noDockerResult.error?.includes('AGENT_BOARD_ENABLE_DOCKER_CONTROL'), 'error mentions docker control env var');
console.log('  ✅ tool offline + docker control disabled → 503-ready response');

// 4. tool down + docker control enabled but compose fails → not ready
let composeCalled = false;
const failingCompose = async () => { composeCalled = true; throw new Error('compose not available'); };
const failResult = await ensureToolReady('content_gen', FAKE_TOOL_SERVERS, FAKE_SERVICE_REGISTRY, true, failingCompose, null);
assert.strictEqual(failResult.ready, false, 'compose failure: ready false');
assert.ok(composeCalled, 'compose was called');
assert.ok(failResult.error?.includes('compose not available'), 'error propagates');
console.log('  ✅ compose failure → not ready with error');

// 5. no service registry entry → graceful error
const noSvcResult = await ensureToolReady('content_gen', FAKE_TOOL_SERVERS, {}, true, async () => {}, null);
assert.strictEqual(noSvcResult.ready, false);
assert.ok(noSvcResult.error, 'missing registry entry returns error');
console.log('  ✅ missing registry entry → graceful error');

console.log('Tool lifecycle tests passed.');
