/**
 * Tests for routes/session-stream.js (POST /api/sessions/:id/stream).
 *
 * A stub LLM serves /api/tags and a streaming /api/chat over real HTTP, so the
 * SSE plumbing, token accumulation, transcript persistence, and error paths all
 * execute for real. Only the model's output is canned.
 */
import assert from 'node:assert/strict';
import express from 'express';

// ── Stub LLM ─────────────────────────────────────────────────────────────────
let mode = 'ok';
const llmApp = express();
llmApp.use(express.json({ limit: '5mb' }));
llmApp.get('/api/tags', (req, res) => res.json({ models: [{ name: 'test-model' }] }));
llmApp.post('/api/chat', (req, res) => {
  if (mode === 'http500') return res.status(500).json({ error: 'model exploded' });
  if (mode === 'midStreamError') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.write(JSON.stringify({ message: { content: 'partial' } }) + '\n');
    // Kill the socket mid-stream so the 'error'/'end' handlers run.
    return setTimeout(() => res.destroy(), 30);
  }
  if (mode === 'empty') { res.writeHead(200); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  res.write(JSON.stringify({ message: { content: 'Hello' } }) + '\n');
  res.write('not json at all\n');                 // must be skipped, not fatal
  res.write(JSON.stringify({ message: { content: ' world' } }) + '\n');
  res.write(JSON.stringify({ message: { content: '' } }) + '\n'); // empty token ignored
  setTimeout(() => res.end(), 20);
});
const llm = llmApp.listen(0);
const LLM_URL = `http://127.0.0.1:${llm.address().port}`;

process.env.PRIMARY_LLM_URL_CANDIDATES = LLM_URL;
process.env.PRIMARY_LLM_URL = LLM_URL;
process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
const { app } = await import('../server.js');

const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const post = (p, body) => fetch(`${BASE}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

/** Collect an SSE response body into its parsed `data:` frames. */
async function streamFrames(sessionId, body) {
  const res = await post(`/api/sessions/${sessionId}/stream`, body);
  const text = await res.text();
  const frames = text.split('\n\n')
    .map(b => b.replace(/^data: /, '').trim())
    .filter(Boolean)
    .map(chunk => { try { return JSON.parse(chunk); } catch { return null; } })
    .filter(Boolean);
  return { status: res.status, frames };
}

async function newSession() {
  const res = await post('/api/sessions', { name: 'stream test', experience: 'safechat' });
  const data = await res.json();
  return data.session?.id ?? data.id;
}

try {
  // ── guards ────────────────────────────────────────────────────────────────
  const notFound = await post('/api/sessions/nope/stream', { message: 'hi' });
  assert.strictEqual(notFound.status, 404, 'unknown session → 404');

  const sid = await newSession();
  assert.ok(sid, 'session created');

  const noMessage = await post(`/api/sessions/${sid}/stream`, {});
  assert.strictEqual(noMessage.status, 400, 'missing message → 400');
  console.log('  ✅ unknown session → 404, missing message → 400');

  // ── happy path ────────────────────────────────────────────────────────────
  mode = 'ok';
  const { frames } = await streamFrames(sid, { message: 'say hello' });
  const tokens = frames.filter(f => f.type === 'token').map(f => f.content);
  assert.deepStrictEqual(tokens, ['Hello', ' world'], 'tokens stream through in order, junk lines skipped');
  const done = frames.find(f => f.type === 'done');
  assert.ok(done, 'a done frame is emitted');
  assert.ok(done.messageCount >= 2, 'done reports the message count');

  // The assembled reply is persisted to the transcript.
  const detail = await (await fetch(`${BASE}/api/sessions/${sid}`)).json();
  const msgs = detail.session?.messages ?? detail.messages;
  const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
  assert.strictEqual(lastAssistant.content, 'Hello world', 'the full reply is persisted, not just the last token');
  const lastUser = [...msgs].reverse().find(m => m.role === 'user');
  assert.strictEqual(lastUser.content, 'say hello', 'the user message is persisted');
  console.log('  ✅ tokens stream in order and the assembled reply is persisted');

  // ── empty upstream stream ─────────────────────────────────────────────────
  mode = 'empty';
  const sid2 = await newSession();
  const empty = await streamFrames(sid2, { message: 'anything' });
  assert.ok(empty.frames.find(f => f.type === 'done'), 'an empty stream still completes');
  const detail2 = await (await fetch(`${BASE}/api/sessions/${sid2}`)).json();
  const msgs2 = detail2.session?.messages ?? detail2.messages;
  assert.strictEqual(
    [...msgs2].reverse().find(m => m.role === 'assistant').content, 'No response received',
    'an empty stream persists the placeholder reply'
  );
  console.log('  ✅ an empty upstream stream completes with the placeholder reply');

  // ── upstream returns HTTP 500 ─────────────────────────────────────────────
  mode = 'http500';
  const sid3 = await newSession();
  const failed = await streamFrames(sid3, { message: 'boom' });
  const errFrame = failed.frames.find(f => f.type === 'error');
  assert.ok(errFrame, 'an upstream 500 produces an error frame rather than hanging');
  assert.match(errFrame.message, /\[Error\]/, 'error frame carries a readable message');
  const detail3 = await (await fetch(`${BASE}/api/sessions/${sid3}`)).json();
  const msgs3 = detail3.session?.messages ?? detail3.messages;
  assert.match(
    [...msgs3].reverse().find(m => m.role === 'assistant').content, /\[Error\]/,
    'the error is recorded in the transcript so the user sees what happened'
  );
  console.log('  ✅ an upstream 500 emits an error frame and records it in the transcript');

  // ── connection dies mid-stream: partial content is kept ───────────────────
  mode = 'midStreamError';
  const sid4 = await newSession();
  const partial = await streamFrames(sid4, { message: 'partial please' });
  assert.ok(
    partial.frames.some(f => f.type === 'token' && f.content === 'partial'),
    'tokens received before the failure are still delivered'
  );
  assert.ok(
    partial.frames.some(f => f.type === 'done' || f.type === 'error'),
    'the stream terminates with either done or error, never silently'
  );
  const detail4 = await (await fetch(`${BASE}/api/sessions/${sid4}`)).json();
  const msgs4 = detail4.session?.messages ?? detail4.messages;
  const saved = [...msgs4].reverse().find(m => m.role === 'assistant');
  assert.ok(saved, 'something is persisted rather than losing the turn entirely');
  assert.ok(
    saved.content.includes('partial') || saved.content.includes('[Error]'),
    'either the partial content or an error is kept'
  );
  console.log('  ✅ a mid-stream failure keeps partial content and still terminates the stream');

  console.log('Session stream tests passed.');
} finally {
  server.close();
  llm.close();
}
