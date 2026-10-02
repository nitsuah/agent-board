/**
 * Agent workspace sandbox.
 *
 * By default the stack gives agents their own checkout instead of the real
 * repo: WORKSPACE_ROOT is a dedicated Docker volume, seeded by a one-shot
 * `workspace-seed` container (scripts/seed-workspace.mjs) from a read-only
 * mount of the repo that the agent container itself never sees. Agents can
 * read, edit, run and commit freely there — on an `agent/sandbox` branch —
 * without touching host files. Pointing agents at a real project is an
 * explicit opt-in (config/docker-compose.workspace.yml, WORKSPACE_SANDBOX=false).
 *
 * Seeding (into a staging dir inside root, then moved into place; a marker file
 * is written last, so only a complete seed ever counts as seeded):
 *  - git source: `git clone`, then the source's current working tree
 *    (tracked + untracked-but-not-ignored files, uncommitted edits and
 *    deletions included) is laid on top and committed, so agents see what is
 *    on disk, not just the last commit;
 *  - non-git source (e.g. a git worktree whose .git pointer only resolves on
 *    the host): a filtered copy plus `git init`.
 * Secrets (`.env`, `.env.*` except example/sample templates), dependencies and
 * build output are never copied.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readdir, mkdir, cp, rm, rename, writeFile, readFile, access } from 'fs/promises';
import { basename, dirname, join } from 'path';

const execFileAsync = promisify(execFile);

export const SANDBOX_MARKER = '.motor-pool-sandbox.json';
const STAGE_DIR = '.motor-pool-seeding';
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.v8-coverage', 'brag-output']);

/** `.env`, `.env.local`, `.env.production`… are secrets; `.env.example` / `.env.sample` are templates. */
export function isSecretEnvFile(name) {
  return /^\.env(\..+)?$/.test(name) && !/^\.env\.(example|sample|template)$/.test(name);
}
const skipName = (name) => SKIP_DIRS.has(name) || isSecretEnvFile(name);
const skipPath = (relPath) => relPath.split('/').some(skipName);

const exists = (p) => access(p).then(() => true, () => false);

// Written last: its presence means the seed completed. Kept out of the sandbox's own git status.
async function markSeeded(root, info) {
  const exclude = join(root, '.git', 'info', 'exclude');
  await mkdir(dirname(exclude), { recursive: true });
  const current = await readFile(exclude, 'utf8').catch(() => '');
  if (!current.split('\n').includes(SANDBOX_MARKER)) {
    const sep = current && !current.endsWith('\n') ? '\n' : '';
    await writeFile(exclude, `${current}${sep}${SANDBOX_MARKER}\n`);
  }
  await writeFile(join(root, SANDBOX_MARKER), JSON.stringify({ ...info, at: new Date().toISOString() }, null, 2));
}

export async function isSandboxSeeded(root) {
  return !!root && exists(join(root, SANDBOX_MARKER));
}

export async function ensureWorkspaceSandbox({
  root, source, branch = 'agent/sandbox', logStructured = () => {}, run = execFileAsync,
}) {
  if (!root || !source) return { seeded: false, reason: 'not_configured' };
  await mkdir(root, { recursive: true });
  if (await isSandboxSeeded(root)) return { seeded: false, reason: 'already_seeded' };

  // safe.directory: the source is a bind mount owned by the host user, not the container user.
  const git = (args, cwd) => run('git', ['-c', 'safe.directory=*', ...args], { cwd, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const identity = ['-c', 'user.name=motor-pool', '-c', 'user.email=agent@motor-pool.local'];
  const stage = join(root, STAGE_DIR);
  await rm(stage, { recursive: true, force: true }); // leftovers from an interrupted seed

  const existing = (await readdir(root)).filter((e) => e !== STAGE_DIR);
  if (existing.length) {
    // A sandbox seeded before markers existed: adopt it rather than wipe agent work.
    const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], root).then((r) => String(r.stdout).trim(), () => null);
    if (head === branch) {
      await markSeeded(root, { branch, method: 'adopted' });
      logStructured('info', 'workspace_sandbox_adopted', { root, branch });
      return { seeded: false, reason: 'adopted' };
    }
    throw new Error(`refusing to seed ${root}: it is not empty and is not a motor-pool sandbox (reset the volume to reseed)`);
  }

  let method;
  const moved = [];
  try {
    await mkdir(stage);
    try {
      await git(['clone', '--quiet', '--no-hardlinks', source, stage]);
      await git(['checkout', '--quiet', '-b', branch], stage);
      method = 'clone';
      // Lay the source's current working tree over the clone (uncommitted work included).
      const listed = await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], source);
      const deleted = new Set(String((await git(['ls-files', '-z', '--deleted'], source)).stdout).split('\0').filter(Boolean));
      for (const rel of String(listed.stdout).split('\0').filter(Boolean)) {
        if (skipPath(rel) || deleted.has(rel)) continue;
        await mkdir(dirname(join(stage, rel)), { recursive: true });
        await cp(join(source, rel), join(stage, rel), { recursive: true, force: true });
      }
      for (const rel of deleted) await rm(join(stage, rel), { force: true });
      await git(['add', '-A'], stage);
      const dirty = String((await git(['status', '--porcelain'], stage)).stdout).trim();
      if (dirty) await git([...identity, 'commit', '--quiet', '-m', 'Snapshot of uncommitted changes in the source'], stage);
    } catch (cloneErr) {
      await rm(stage, { recursive: true, force: true });
      await mkdir(stage);
      await cp(source, stage, { recursive: true, filter: (src) => src === source || !skipName(basename(src)) });
      await git(['init', '--quiet', '-b', branch], stage);
      await git(['add', '-A'], stage);
      await git([...identity, 'commit', '--quiet', '--allow-empty', '-m', 'Seed agent sandbox'], stage);
      method = 'copy';
      logStructured('info', 'workspace_sandbox_clone_fallback', { source, reason: String(cloneErr.message || cloneErr).split('\n')[0] });
    }

    // Move into place; .git last so an interrupted move never looks like a checkout.
    const entries = (await readdir(stage)).sort((a, b) => (a === '.git') - (b === '.git'));
    for (const entry of entries) {
      await rename(join(stage, entry), join(root, entry));
      moved.push(entry);
    }
    await rm(stage, { recursive: true, force: true });
    await markSeeded(root, { branch, method, source });
  } catch (err) {
    for (const entry of moved) await rm(join(root, entry), { recursive: true, force: true });
    await rm(stage, { recursive: true, force: true });
    throw err;
  }

  logStructured('info', 'workspace_sandbox_seeded', { root, source, method, branch });
  return { seeded: true, method, branch };
}
