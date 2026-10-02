/**
 * modules/workspace-sandbox.js — agents get their own checkout, never the host repo.
 * Runs real git against temp directories.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureWorkspaceSandbox } from '../modules/workspace-sandbox.js';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'safe.directory=*', ...args], { cwd, encoding: 'utf8' }).trim();
const tmp = await mkdtemp(join(tmpdir(), 'sandbox-test-'));

try {
  // ── not configured ─────────────────────────────────────────────────────────
  assert.deepEqual(await ensureWorkspaceSandbox({ root: null, source: '/x' }), { seeded: false, reason: 'not_configured' });
  console.log('  ✅ no root/source → nothing happens');

  // ── git source → clone on agent/sandbox ────────────────────────────────────
  const repo = join(tmp, 'repo');
  await mkdir(join(repo, 'node_modules'), { recursive: true });
  await writeFile(join(repo, 'README.md'), 'original\n');
  await writeFile(join(repo, '.gitignore'), 'node_modules\n.env\n');
  await writeFile(join(repo, '.env'), 'SECRET=1\n');
  await writeFile(join(repo, 'node_modules', 'dep.js'), '');
  git(repo, 'init', '-q', '-b', 'master');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');

  const sb1 = join(tmp, 'sandbox-clone');
  const r1 = await ensureWorkspaceSandbox({ root: sb1, source: repo });
  assert.equal(r1.seeded, true);
  assert.equal(r1.method, 'clone');
  assert.equal(git(sb1, 'rev-parse', '--abbrev-ref', 'HEAD'), 'agent/sandbox', 'sandbox is on agent/sandbox');
  assert.equal(await readFile(join(sb1, 'README.md'), 'utf8'), 'original\n');
  assert.ok(!existsSync(join(sb1, '.env')), 'untracked secrets are not cloned');
  assert.ok(!existsSync(join(sb1, 'node_modules')), 'dependencies are not cloned');
  console.log('  ✅ a git source is cloned onto agent/sandbox without .env or node_modules');

  // Agents writing in the sandbox never touch the source.
  await writeFile(join(sb1, 'README.md'), 'clobbered by an agent\n');
  await rm(join(sb1, '.gitignore'));
  assert.equal(await readFile(join(repo, 'README.md'), 'utf8'), 'original\n', 'host file unchanged');
  assert.ok(existsSync(join(repo, '.gitignore')), 'host file not deleted');
  assert.equal(git(repo, 'status', '--porcelain'), '', 'host repo stays clean');
  console.log('  ✅ edits and deletes in the sandbox leave the host repo untouched');

  // ── already seeded → left alone (agent work survives restarts) ─────────────
  const r2 = await ensureWorkspaceSandbox({ root: sb1, source: repo });
  assert.deepEqual(r2, { seeded: false, reason: 'already_seeded' });
  assert.equal(await readFile(join(sb1, 'README.md'), 'utf8'), 'clobbered by an agent\n', 'existing sandbox not reset');
  console.log('  ✅ an existing sandbox is never re-seeded');

  // ── non-git source (e.g. a worktree whose .git points at a host path) ──────
  const plain = join(tmp, 'plain');
  await mkdir(join(plain, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(plain, 'config'), { recursive: true });
  await mkdir(join(plain, 'src'), { recursive: true });
  await writeFile(join(plain, '.git'), 'gitdir: C:/somewhere/on/the/host\n');
  await writeFile(join(plain, 'src', 'app.js'), 'export {};\n');
  await writeFile(join(plain, 'config', '.env'), 'TOKEN=abc\n');
  await writeFile(join(plain, '.env'), 'SECRET=1\n');
  await writeFile(join(plain, 'node_modules', 'pkg', 'i.js'), '');

  const sb2 = join(tmp, 'sandbox-copy');
  const r3 = await ensureWorkspaceSandbox({ root: sb2, source: plain });
  assert.equal(r3.method, 'copy');
  assert.equal(await readFile(join(sb2, 'src', 'app.js'), 'utf8'), 'export {};\n');
  assert.ok(!existsSync(join(sb2, '.env')) && !existsSync(join(sb2, 'config', '.env')), '.env files are never copied');
  assert.ok(!existsSync(join(sb2, 'node_modules')), 'node_modules is not copied');
  assert.equal(git(sb2, 'rev-parse', '--abbrev-ref', 'HEAD'), 'agent/sandbox');
  assert.equal(git(sb2, 'status', '--porcelain'), '', 'seed is committed');
  assert.match(git(sb2, 'log', '--oneline'), /Seed agent sandbox/);
  console.log('  ✅ a non-repo source is copied (no secrets, no deps) into a fresh repo on agent/sandbox');

  // ── a failed clone leaves no half-written checkout behind ──────────────────
  const entries = await readdir(sb2);
  assert.ok(entries.includes('.git') && entries.includes('src'));
  console.log('Workspace sandbox tests passed.');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
