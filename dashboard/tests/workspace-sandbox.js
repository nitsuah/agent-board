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
import { ensureWorkspaceSandbox, isSandboxSeeded, isSecretEnvFile, SANDBOX_MARKER } from '../modules/workspace-sandbox.js';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'safe.directory=*', ...args], { cwd, encoding: 'utf8' }).trim();
const tmp = await mkdtemp(join(tmpdir(), 'sandbox-test-'));

try {
  // ── helpers ────────────────────────────────────────────────────────────────
  assert.deepEqual(await ensureWorkspaceSandbox({ root: null, source: '/x' }), { seeded: false, reason: 'not_configured' });
  for (const n of ['.env', '.env.local', '.env.production']) assert.ok(isSecretEnvFile(n), `${n} is a secret`);
  for (const n of ['.env.example', '.env.sample', 'env.js', '.envrc.md']) assert.ok(!isSecretEnvFile(n), `${n} is not`);
  console.log('  ✅ no root/source → nothing happens; .env* secrets vs templates classified');

  // ── git source with uncommitted work → clone + working-tree snapshot ───────
  const repo = join(tmp, 'repo');
  await mkdir(join(repo, 'node_modules'), { recursive: true });
  await mkdir(join(repo, 'config'), { recursive: true });
  await writeFile(join(repo, 'README.md'), 'original\n');
  await writeFile(join(repo, 'gone.txt'), 'will be deleted\n');
  await writeFile(join(repo, '.gitignore'), 'node_modules\n.env\n');
  await writeFile(join(repo, '.env.example'), 'SECRET=\n');
  git(repo, 'init', '-q', '-b', 'master');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  // uncommitted: an edit, a deletion, a new file, plus secrets (one ignored, one NOT ignored)
  await writeFile(join(repo, 'README.md'), 'edited but not committed\n');
  await rm(join(repo, 'gone.txt'));
  await writeFile(join(repo, 'new.txt'), 'untracked work\n');
  await writeFile(join(repo, '.env'), 'SECRET=1\n');
  await writeFile(join(repo, 'config', '.env.local'), 'TOKEN=abc\n');
  await writeFile(join(repo, 'node_modules', 'dep.js'), '');

  const sb1 = join(tmp, 'sandbox-clone');
  const r1 = await ensureWorkspaceSandbox({ root: sb1, source: repo });
  assert.equal(r1.seeded, true);
  assert.equal(r1.method, 'clone');
  assert.equal(git(sb1, 'rev-parse', '--abbrev-ref', 'HEAD'), 'agent/sandbox');
  assert.equal(await readFile(join(sb1, 'README.md'), 'utf8'), 'edited but not committed\n', 'uncommitted edit included');
  assert.ok(!existsSync(join(sb1, 'gone.txt')), 'uncommitted deletion included');
  assert.equal(await readFile(join(sb1, 'new.txt'), 'utf8'), 'untracked work\n', 'untracked file included');
  assert.ok(existsSync(join(sb1, '.env.example')), 'env templates are kept');
  assert.ok(!existsSync(join(sb1, '.env')), 'ignored .env not copied');
  assert.ok(!existsSync(join(sb1, 'config', '.env.local')), 'un-ignored nested .env.local not copied');
  assert.ok(!existsSync(join(sb1, 'node_modules')), 'dependencies not copied');
  assert.ok(await isSandboxSeeded(sb1), 'completion marker written');
  assert.equal(git(sb1, 'status', '--porcelain'), '', 'snapshot committed; marker excluded from git status');
  assert.ok(!existsSync(join(sb1, '.motor-pool-seeding')), 'staging dir cleaned up');
  console.log('  ✅ a dirty git source is cloned + snapshotted (edits, deletions, new files) without secrets or deps');

  // Agents writing in the sandbox never touch the source.
  const srcStatus = git(repo, 'status', '--porcelain');
  await writeFile(join(sb1, 'README.md'), 'clobbered by an agent\n');
  await rm(join(sb1, '.gitignore'));
  assert.equal(await readFile(join(repo, 'README.md'), 'utf8'), 'edited but not committed\n', 'host file unchanged');
  assert.ok(existsSync(join(repo, '.gitignore')), 'host file not deleted');
  assert.equal(git(repo, 'status', '--porcelain'), srcStatus, 'host repo state unchanged');
  console.log('  ✅ edits and deletes in the sandbox leave the host repo untouched');

  // ── already seeded → left alone (agent work survives restarts) ─────────────
  assert.deepEqual(await ensureWorkspaceSandbox({ root: sb1, source: repo }), { seeded: false, reason: 'already_seeded' });
  assert.equal(await readFile(join(sb1, 'README.md'), 'utf8'), 'clobbered by an agent\n', 'existing sandbox not reset');
  console.log('  ✅ a completed sandbox is never re-seeded');

  // ── non-git source (e.g. a worktree whose .git points at a host path) ──────
  const plain = join(tmp, 'plain');
  await mkdir(join(plain, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(plain, 'config'), { recursive: true });
  await mkdir(join(plain, 'src'), { recursive: true });
  await writeFile(join(plain, '.git'), 'gitdir: C:/somewhere/on/the/host\n');
  await writeFile(join(plain, 'src', 'app.js'), 'export {};\n');
  await writeFile(join(plain, 'config', '.env'), 'TOKEN=abc\n');
  await writeFile(join(plain, 'config', '.env.local'), 'TOKEN=abc\n');
  await writeFile(join(plain, '.env'), 'SECRET=1\n');
  await writeFile(join(plain, '.env.example'), 'SECRET=\n');
  await writeFile(join(plain, 'node_modules', 'pkg', 'i.js'), '');

  const sb2 = join(tmp, 'sandbox-copy');
  const r3 = await ensureWorkspaceSandbox({ root: sb2, source: plain });
  assert.equal(r3.method, 'copy');
  assert.equal(await readFile(join(sb2, 'src', 'app.js'), 'utf8'), 'export {};\n');
  for (const f of ['.env', 'config/.env', 'config/.env.local']) assert.ok(!existsSync(join(sb2, f)), `${f} never copied`);
  assert.ok(existsSync(join(sb2, '.env.example')), 'template kept');
  assert.ok(!existsSync(join(sb2, 'node_modules')), 'node_modules not copied');
  assert.equal(git(sb2, 'rev-parse', '--abbrev-ref', 'HEAD'), 'agent/sandbox');
  assert.equal(git(sb2, 'status', '--porcelain'), '', 'seed is committed');
  assert.match(git(sb2, 'log', '--oneline'), /Seed agent sandbox/);
  console.log('  ✅ a non-repo source is copied (no .env*/deps) into a fresh repo on agent/sandbox');

  // ── a pre-marker sandbox is adopted, anything else non-empty is refused ────
  await rm(join(sb2, SANDBOX_MARKER));
  assert.deepEqual(await ensureWorkspaceSandbox({ root: sb2, source: plain }), { seeded: false, reason: 'adopted' });
  assert.ok(await isSandboxSeeded(sb2));
  const foreign = join(tmp, 'foreign');
  await mkdir(foreign);
  await writeFile(join(foreign, 'precious.txt'), 'do not delete\n');
  await assert.rejects(ensureWorkspaceSandbox({ root: foreign, source: plain }), /refusing to seed/);
  assert.equal(await readFile(join(foreign, 'precious.txt'), 'utf8'), 'do not delete\n', 'unknown data is never wiped');
  console.log('  ✅ an unmarked agent/sandbox checkout is adopted; any other non-empty dir is refused, not wiped');

  // ── a failed seed leaves nothing half-done and is not marked seeded ────────
  const sb3 = join(tmp, 'sandbox-fail');
  await assert.rejects(ensureWorkspaceSandbox({ root: sb3, source: join(tmp, 'does-not-exist') }));
  assert.deepEqual(await readdir(sb3), [], 'root left empty after a failed seed');
  assert.ok(!(await isSandboxSeeded(sb3)), 'failed seed is not marked seeded');
  console.log('  ✅ a failed seed cleans up and is not treated as seeded');

  console.log('Workspace sandbox tests passed.');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
