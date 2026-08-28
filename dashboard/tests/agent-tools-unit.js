/**
 * Tests for modules/agent-tools.js
 *
 * runAgentLoop() is driven by a scripted stub LLM served over real HTTP, so the
 * loop, the tool executor, and the safety checks all run for real — only the
 * model's replies are canned. Both the Ollama (`/api/chat`) and OpenAI
 * (`/chat/completions`) response shapes are exercised.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import {
  createAgentHelpers, DEVELOPER_TOOLS, RESEARCH_TOOLS, WEBSITE_AGENT_TOOLS,
} from '../modules/agent-tools.js';

const execAsync = promisify(exec);
const WORKSPACE = realpathSync(mkdtempSync(join(tmpdir(), 'ab-agent-')));
writeFileSync(join(WORKSPACE, 'hello.txt'), 'file contents\n');

// ── Scripted stub LLM ────────────────────────────────────────────────────────
// `script` is a queue of message objects to hand back, one per request.
let script = [];
const requests = [];
const llmApp = express();
llmApp.use(express.json({ limit: '5mb' }));
llmApp.post('/api/chat', (req, res) => {
  requests.push(req.body);
  res.json({ message: script.shift() ?? { content: 'fallback' } });
});
llmApp.post('/chat/completions', (req, res) => {
  requests.push(req.body);
  res.json({ choices: [{ message: script.shift() ?? { content: 'fallback' } }] });
});
const llm = llmApp.listen(0);
const LLM_URL = `http://127.0.0.1:${llm.address().port}`;

const toolCall = (name, args) => ({
  content: '',
  tool_calls: [{ id: `call_${name}`, function: { name, arguments: JSON.stringify(args) } }],
});

const session = { model: 'test-model', id: 'sess_1' };
const helpers = createAgentHelpers({
  WORKSPACE_ROOT: WORKSPACE, execAsync, TOOL_SERVERS: {}, TOOL_CALL_TIMEOUT_MS: 5000,
});
const noWorkspace = createAgentHelpers({
  WORKSPACE_ROOT: null, execAsync, TOOL_SERVERS: {}, TOOL_CALL_TIMEOUT_MS: 5000,
});

const run = (h, tools = DEVELOPER_TOOLS, style = 'ollama') =>
  h.runAgentLoop([{ role: 'user', content: 'go' }], style, LLM_URL, {}, tools, session);

try {
  // ── getExperienceTools ─────────────────────────────────────────────────────
  assert.strictEqual(helpers.getExperienceTools('developer'), DEVELOPER_TOOLS, 'developer tools with a workspace');
  assert.deepStrictEqual(noWorkspace.getExperienceTools('developer'), [], 'no developer tools without a workspace');
  assert.strictEqual(helpers.getExperienceTools('research'), RESEARCH_TOOLS, 'research tools');
  assert.strictEqual(helpers.getExperienceTools('website'), WEBSITE_AGENT_TOOLS, 'website tools');
  assert.deepStrictEqual(helpers.getExperienceTools('safechat'), [], 'unknown experience gets no tools');
  assert.deepStrictEqual(helpers.getExperienceTools(undefined), [], 'undefined experience gets no tools');
  console.log('  ✅ getExperienceTools maps experiences, and gates developer tools on WORKSPACE_ROOT');

  // ── plain answer, no tools ─────────────────────────────────────────────────
  script = [{ content: 'just an answer' }];
  let out = await run(helpers);
  assert.strictEqual(out.content, 'just an answer', 'returns the model content');
  assert.deepStrictEqual(out.toolLog, [], 'no tools logged when none were called');

  script = [{ content: null }];
  out = await run(helpers);
  assert.strictEqual(out.content, 'No response received', 'null content falls back to a placeholder');
  console.log('  ✅ a reply with no tool calls is returned directly');

  // ── read_file executes for real ────────────────────────────────────────────
  script = [toolCall('read_file', { path: 'hello.txt' }), { content: 'done reading' }];
  out = await run(helpers);
  assert.strictEqual(out.content, 'done reading', 'final answer returned after the tool round-trip');
  assert.strictEqual(out.toolLog.length, 1, 'one tool call logged');
  assert.strictEqual(out.toolLog[0].name, 'read_file');
  assert.strictEqual(out.toolLog[0].result.content, 'file contents\n', 'tool actually read the file');
  console.log('  ✅ runAgentLoop executes read_file and feeds the result back');

  // ── write_file / list_files ────────────────────────────────────────────────
  script = [toolCall('write_file', { path: 'out.txt', content: 'written by agent' }), { content: 'wrote it' }];
  out = await run(helpers);
  assert.ok(existsSync(join(WORKSPACE, 'out.txt')), 'write_file created the file');
  assert.strictEqual(readFileSync(join(WORKSPACE, 'out.txt'), 'utf8'), 'written by agent');

  script = [toolCall('list_files', { path: '.' }), { content: 'listed' }];
  out = await run(helpers);
  assert.ok(!out.toolLog[0].result.error, `list_files should succeed: ${out.toolLog[0].result.error}`);
  console.log('  ✅ write_file and list_files operate on the real workspace');

  // ── safety: bash blocklist ─────────────────────────────────────────────────
  script = [toolCall('bash', { command: 'rm -rf / --no-preserve-root' }), { content: 'blocked' }];
  out = await run(helpers);
  assert.match(out.toolLog[0].result.error, /blocked by safety policy/i, 'dangerous bash is refused');

  // A benign command still runs.
  script = [toolCall('bash', { command: 'echo hi' }), { content: 'ran' }];
  out = await run(helpers);
  assert.strictEqual(out.toolLog[0].result.stdout, 'hi', 'benign bash runs and returns stdout');
  assert.strictEqual(out.toolLog[0].result.exitCode, 0);

  // A failing command reports a non-zero exit rather than throwing.
  script = [toolCall('bash', { command: 'exit 3' }), { content: 'failed' }];
  out = await run(helpers);
  assert.notStrictEqual(out.toolLog[0].result.exitCode, 0, 'failing bash reports a non-zero exit code');
  console.log('  ✅ bash blocklist refuses destructive commands; normal and failing commands behave');

  // ── safety: path traversal ─────────────────────────────────────────────────
  for (const bad of ['../../etc/passwd', '/etc/passwd']) {
    script = [toolCall('read_file', { path: bad }), { content: 'nope' }];
    out = await run(helpers);
    const r = out.toolLog[0].result;
    assert.ok(r.error, `read_file must refuse "${bad}"`);
    assert.ok(!String(r.content || '').includes('root:'), `read_file must not leak "${bad}"`);
  }
  script = [toolCall('write_file', { path: '../escaped.txt', content: 'x' }), { content: 'nope' }];
  out = await run(helpers);
  assert.ok(out.toolLog[0].result.error, 'write_file refuses traversal');
  assert.ok(!existsSync(join(WORKSPACE, '..', 'escaped.txt')), 'nothing written outside the workspace');
  console.log('  ✅ read_file/write_file refuse path traversal and leak nothing');

  // ── tools without a workspace ──────────────────────────────────────────────
  script = [toolCall('read_file', { path: 'hello.txt' }), { content: 'no ws' }];
  out = await run(noWorkspace);
  assert.match(out.toolLog[0].result.error, /not mounted/i, 'tools report the missing workspace');
  script = [toolCall('bash', { command: 'echo hi' }), { content: 'no ws' }];
  out = await run(noWorkspace);
  assert.match(out.toolLog[0].result.error, /not mounted|WORKSPACE_ROOT/i, 'bash reports the missing workspace');
  console.log('  ✅ tools fail cleanly when WORKSPACE_ROOT is not set');

  // ── unknown tool ───────────────────────────────────────────────────────────
  script = [toolCall('no_such_tool', {}), { content: 'unknown' }];
  out = await run(helpers);
  assert.ok(out.toolLog[0].result.error, 'an unknown tool yields an error result rather than throwing');
  console.log('  ✅ an unknown tool name produces an error result');

  // ── consecutive-error abort ────────────────────────────────────────────────
  // Three failing tool calls in a row must abort the loop.
  script = [
    toolCall('read_file', { path: '../a' }),
    toolCall('read_file', { path: '../b' }),
    toolCall('read_file', { path: '../c' }),
    { content: 'should not be reached' },
  ];
  out = await run(helpers);
  assert.match(out.content, /aborted after 3 consecutive errors/i, 'loop aborts after repeated tool errors');
  assert.ok(out.toolLog.at(-1).aborted, 'the aborting entry is marked in the tool log');
  console.log('  ✅ three consecutive tool errors abort the loop');

  // ── iteration cap ──────────────────────────────────────────────────────────
  // Always return a *successful* tool call so the error-abort never triggers;
  // the loop must still stop and make one final call for a summary.
  script = Array.from({ length: 12 }, () => toolCall('read_file', { path: 'hello.txt' }));
  script.push({ content: 'final summary' });
  requests.length = 0;
  out = await run(helpers);
  assert.strictEqual(out.toolLog.length, 5, 'stops after MAX_ITERATIONS tool rounds');
  assert.strictEqual(requests.length, 6, 'five loop calls plus one final summarizing call');
  console.log('  ✅ the loop caps at 5 iterations then makes a final summarizing call');

  // ── openai message shape ───────────────────────────────────────────────────
  script = [toolCall('read_file', { path: 'hello.txt' }), { content: 'openai done' }];
  requests.length = 0;
  out = await run(helpers, DEVELOPER_TOOLS, 'openai');
  assert.strictEqual(out.content, 'openai done', 'openai response shape is unwrapped from choices[]');
  const toolMsg = requests[1].messages.find(m => m.role === 'tool');
  assert.strictEqual(toolMsg.tool_call_id, 'call_read_file', 'openai style attaches tool_call_id');

  script = [toolCall('read_file', { path: 'hello.txt' }), { content: 'ollama done' }];
  requests.length = 0;
  await run(helpers, DEVELOPER_TOOLS, 'ollama');
  const ollamaToolMsg = requests[1].messages.find(m => m.role === 'tool');
  assert.strictEqual(ollamaToolMsg.tool_call_id, undefined, 'ollama style omits tool_call_id');
  console.log('  ✅ openai and ollama tool-result message shapes differ correctly');

  // ── object-form arguments ──────────────────────────────────────────────────
  // Some models return `arguments` already parsed rather than as a JSON string.
  script = [
    { content: '', tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: { path: 'hello.txt' } } }] },
    { content: 'object args ok' },
  ];
  out = await run(helpers);
  assert.strictEqual(out.toolLog[0].result.content, 'file contents\n', 'object-form arguments are accepted');
  console.log('  ✅ tool arguments are accepted as both JSON strings and objects');

  console.log('Agent tools tests passed.');
} finally {
  llm.close();
  rmSync(WORKSPACE, { recursive: true, force: true });
}
