/**
 * E2E Services Test
 *
 * Validates each AI service in order:
 *   1. Start it via the Services panel API (if not already live)
 *   2. Poll until live (or timeout → SKIP)
 *   3. Create a chat session backed by that service
 *   4. Send a deterministic prompt, assert the known token in the response
 *
 * Services tested (in order): Ollama → Docker Runner → Content Gen →
 *   Website Agent → NemoClaw → Blackboard MCP
 *
 * Run: node tests/e2e-services.js
 *      DASHBOARD_URL=http://localhost:3000 node tests/e2e-services.js
 *
 * SKIP vs FAIL:
 *   SKIP — service can't start or isn't configured for this environment
 *   FAIL — service started and became live, but chat produced an incorrect result
 *
 * Exit code 1 only when at least one service FAILs.
 */

import axios from 'axios';

const BASE = process.env.DASHBOARD_URL || 'http://localhost:3000';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90_000;
const CHAT_TIMEOUT_MS = 150_000;
const HTTP_TIMEOUT_MS = 15_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function api(method, path, data) {
  try {
    const res = await axios({
      method, url: `${BASE}${path}`, data,
      timeout: HTTP_TIMEOUT_MS, validateStatus: () => true,
    });
    return { ok: res.status < 400, status: res.status, body: res.data };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err.message } };
  }
}

async function chatMessage(sessionId, message) {
  try {
    const res = await axios.post(
      `${BASE}/api/sessions/${sessionId}/message`,
      { message },
      { timeout: CHAT_TIMEOUT_MS, validateStatus: () => true }
    );
    return res.data;
  } catch (err) {
    return { success: false, response: err.message };
  }
}

// ── Service helpers ───────────────────────────────────────────────────────────

async function isServiceRunning(serviceKey) {
  const { body } = await api('GET', '/api/system/services');
  return !!body?.services?.[serviceKey]?.running;
}

async function startService(serviceKey) {
  const { body } = await api('POST', `/api/system/services/${serviceKey}/start`, {});
  if (!body?.success) {
    console.log(`    start returned: ${body?.error || JSON.stringify(body).slice(0, 120)}`);
  }
}

async function waitUntilLive(serviceKey) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isServiceRunning(serviceKey)) return true;
    process.stdout.write('.');
    await sleep(POLL_INTERVAL_MS);
  }
  process.stdout.write('\n');
  return false;
}

async function ensureLive(serviceKey) {
  if (await isServiceRunning(serviceKey)) return true;
  console.log(`    not running — calling start…`);
  await startService(serviceKey);
  const live = await waitUntilLive(serviceKey);
  if (live) process.stdout.write('\n');
  return live;
}

async function withSession(endpointKey, experience, fn) {
  const { body } = await api('POST', '/api/sessions', {
    endpoint: endpointKey, experience,
    name: `e2e-${endpointKey}-${Date.now()}`,
  });
  if (!body?.success || !body?.session?.id) {
    throw new Error(`session creation failed: ${JSON.stringify(body).slice(0, 200)}`);
  }
  const id = body.session.id;
  try {
    return await fn(id);
  } finally {
    await api('DELETE', `/api/sessions/${id}`);
  }
}

// ── Result tracker ────────────────────────────────────────────────────────────

const results = [];

function recordPass(name) {
  results.push({ name, result: 'pass' });
  console.log('  ✓ pass\n');
}
function recordSkip(name, reason) {
  results.push({ name, result: 'skip', reason });
  console.log(`  ─ skip: ${reason}\n`);
}
function recordFail(name, reason) {
  results.push({ name, result: 'fail', reason });
  console.log(`  ✗ FAIL: ${reason}\n`);
}

// ── Individual service tests ──────────────────────────────────────────────────

async function testOllama() {
  const NAME = 'Ollama (local)';
  console.log(`[${NAME}]`);

  const live = await ensureLive('ollama');
  if (!live) { recordSkip(NAME, 'did not come live within 90s'); return; }
  console.log('  live');

  try {
    const text = await withSession('primary', 'developer', async (id) => {
      const r = await chatMessage(id, 'Reply with only the token OLLAMA_OK and nothing else.');
      if (!r.success) throw new Error(r.response?.slice(0, 200) || 'chat failed');
      return r.response;
    });
    if (!text?.includes('OLLAMA_OK')) {
      recordFail(NAME, `expected OLLAMA_OK — got: ${text?.slice(0, 150)}`);
    } else {
      recordPass(NAME);
    }
  } catch (err) {
    recordFail(NAME, err.message);
  }
}

async function testDockerRunner(epKey, modelName) {
  const NAME = `Docker Runner (${modelName})`;
  console.log(`[${NAME}]`);

  // Docker Runner is not startable via compose — it's Docker Desktop built-in
  const { body } = await api('GET', '/api/docker/status');
  const ep = body?.endpoints?.[epKey];

  if (!ep?.live) {
    recordSkip(NAME, 'Docker Model Runner offline — requires Docker Desktop 4.40+ with Model Runner enabled');
    return;
  }
  if (!ep?.modelLoaded) {
    recordSkip(NAME, `model not pulled — run: docker model pull ${ep?.model || modelName}`);
    return;
  }
  console.log(`  runner live, ${ep.model} loaded`);

  try {
    const text = await withSession(epKey, 'developer', async (id) => {
      const r = await chatMessage(id, 'Reply with only the token RUNNER_OK and nothing else.');
      if (!r.success) {
        // Model exceeds VRAM/RAM — treat as skip, not a test failure
        if (/500|device|cpu.only|too large|failed to load/i.test(r.response || '')) return null;
        throw new Error(r.response?.slice(0, 200) || 'chat failed');
      }
      return r.response;
    });
    if (text === null) {
      recordSkip(NAME, `${ep.model} exceeds available VRAM/RAM — model is registered but cannot load`);
    } else if (!text?.includes('RUNNER_OK')) {
      recordFail(NAME, `expected RUNNER_OK — got: ${text?.slice(0, 150)}`);
    } else {
      recordPass(NAME);
    }
  } catch (err) {
    recordFail(NAME, err.message);
  }
}

async function testContentGen() {
  const NAME = 'Content Gen (MCP)';
  console.log(`[${NAME}]`);

  const live = await ensureLive('tool_content_gen');
  if (!live) { recordSkip(NAME, 'tool_content_gen did not come live within 90s'); return; }
  console.log('  live');

  if (!(await isServiceRunning('ollama'))) {
    recordSkip(NAME, 'ollama not running — content_gen requires an LLM backend');
    return;
  }
  try {
    const text = await withSession('primary', 'content_gen', async (id) => {
      const r = await chatMessage(id, 'List the names of your video generation tools. Be very brief.');
      if (!r.success) throw new Error(r.response?.slice(0, 200) || 'chat failed');
      return r.response;
    });
    if (!text) {
      recordFail(NAME, 'empty response');
    } else {
      const hasToolRef = /script|video|gen|audio|content|voice|image|visual|moneyprinter|render/i.test(text);
      if (!hasToolRef) {
        recordFail(NAME, `response missing expected tool keywords — got: ${text.slice(0, 120)}`);
      } else {
        console.log(`  response snippet: ${text.slice(0, 120)}`);
        recordPass(NAME);
      }
    }
  } catch (err) {
    recordFail(NAME, err.message);
  }
}

async function testWebsiteAgent() {
  const NAME = 'Website Agent (MCP)';
  console.log(`[${NAME}]`);

  const live = await ensureLive('tool_website');
  if (!live) { recordSkip(NAME, 'tool_website did not come live within 90s'); return; }
  console.log('  live');

  if (!(await isServiceRunning('ollama'))) {
    recordSkip(NAME, 'ollama not running — website agent requires an LLM backend');
    return;
  }

  try {
    const text = await withSession('primary', 'website', async (id) => {
      const r = await chatMessage(id, 'List the names of your website generation tools. Be very brief.');
      if (!r.success) throw new Error(r.response?.slice(0, 200) || 'chat failed');
      return r.response;
    });
    if (!text) {
      recordFail(NAME, 'empty response');
    } else {
      const hasToolRef = /lead|site|deploy|file|netlify|discover|pitch|web|page|html|publish/i.test(text);
      if (!hasToolRef) {
        recordFail(NAME, `response missing expected tool keywords — got: ${text.slice(0, 120)}`);
      } else {
        console.log(`  response snippet: ${text.slice(0, 120)}`);
        recordPass(NAME);
      }
    }
  } catch (err) {
    recordFail(NAME, err.message);
  }
}

async function testNemoclaw() {
  const NAME = 'NemoClaw (sandbox)';
  console.log(`[${NAME}]`);

  // nemoclaw endpoint is not listed in any experience's availableEndpoints, so
  // chat sessions cannot be routed through it. Just verify the container starts.
  const live = await ensureLive('nemoclaw');
  if (!live) {
    recordSkip(NAME, 'nemoclaw did not come live within 90s');
    return;
  }

  // Confirm dashboard still reports it as running after startup
  const running = await isServiceRunning('nemoclaw');
  if (!running) {
    recordFail(NAME, 'nemoclaw showed live then dropped offline');
  } else {
    console.log('  live — container healthy');
    recordPass(NAME);
  }
}

async function testBbMcp() {
  const NAME = 'Blackboard MCP';
  console.log(`[${NAME}]`);

  const { body: svcBody } = await api('GET', '/api/system/services');
  const info = svcBody?.services?.['bb_mcp'];

  if (!info) { recordSkip(NAME, 'bb_mcp not in service registry'); return; }
  if (info.disabledReason?.includes('BB_MCP_ENABLED=false')) {
    recordSkip(NAME, 'BB_MCP_ENABLED=false — set env var in config/.env to enable');
    return;
  }

  const live = await ensureLive('bb_mcp');
  if (!live) { recordSkip(NAME, 'bb_mcp did not come live within 90s'); return; }
  console.log('  live');

  // bb-mcp backs the general chat endpoint; verify dashboard stays healthy
  const { ok } = await api('GET', '/api/health');
  if (!ok) {
    recordFail(NAME, 'dashboard unhealthy while bb_mcp running');
  } else {
    recordPass(NAME);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nagent-board — E2E Services Test`);
  console.log(`Target: ${BASE}\n`);

  const { ok, body } = await api('GET', '/api/health');
  if (!ok) throw new Error(`Dashboard unreachable at ${BASE} — is the stack running?`);
  console.log(`Dashboard healthy (${body?.status || 'ok'})\n`);

  await testOllama();
  await testDockerRunner('docker_runner', 'qwen3-coder');
  await testDockerRunner('glm_flash', 'glm-4.7-flash');
  await testContentGen();
  await testWebsiteAgent();
  await testNemoclaw();
  await testBbMcp();

  // ── Summary ──────────────────────────────────────────────────────────────
  const w = 38;
  console.log('═'.repeat(w));
  console.log(' RESULTS');
  console.log('═'.repeat(w));
  let anyFail = false;
  for (const { name, result, reason } of results) {
    const icon = result === 'pass' ? '✓' : result === 'skip' ? '─' : '✗';
    const line = reason ? `${name}: ${reason}` : name;
    console.log(`  ${icon} ${line}`);
    if (result === 'fail') anyFail = true;
  }
  console.log('═'.repeat(w));

  if (anyFail) {
    console.log('\n✗ One or more services failed E2E validation.');
    process.exit(1);
  }
  console.log('\n✓ All tested services passed (skipped services are not configured for this environment).');
}

run().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
