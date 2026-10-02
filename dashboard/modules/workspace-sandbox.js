/**
 * Agent workspace sandbox.
 *
 * By default the stack gives agents their own checkout instead of the real
 * repo: WORKSPACE_ROOT is a dedicated Docker volume, seeded once from a
 * read-only source (the repo, mounted at /workspace-root). Agents can read,
 * edit, run and commit freely there — on an `agent/sandbox` branch — without
 * touching the files on the host. Pointing agents at a real project is an
 * explicit opt-in (config/docker-compose.workspace.yml, WORKSPACE_SANDBOX=false).
 *
 * Seeding: `git clone` of the source when it is a normal repository (history
 * included, untracked files like .env left behind); otherwise — e.g. the source
 * is itself a git worktree whose .git pointer resolves only on the host — a
 * filtered copy plus `git init`. An already-seeded sandbox is never touched.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readdir, mkdir, cp, rm } from 'fs/promises';
import { basename, join } from 'path';

const execFileAsync = promisify(execFile);

// Never copied into the sandbox: dependencies, build output, VCS internals, secrets.
const SKIP_NAMES = new Set(['node_modules', '.git', 'dist', 'coverage', '.v8-coverage', 'brag-output', '.env']);

export async function ensureWorkspaceSandbox({
  root, source, branch = 'agent/sandbox', logStructured = () => {}, run = execFileAsync,
}) {
  if (!root || !source) return { seeded: false, reason: 'not_configured' };
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length > 0) return { seeded: false, reason: 'already_seeded' };

  // safe.directory: the source is a bind mount owned by the host user, not the container user.
  const git = (args, cwd) => run('git', ['-c', 'safe.directory=*', ...args], { cwd, timeout: 120000 });
  const identity = ['-c', 'user.name=motor-pool', '-c', 'user.email=agent@motor-pool.local'];

  let method;
  try {
    await git(['clone', '--quiet', '--no-hardlinks', source, root]);
    await git(['checkout', '--quiet', '-b', branch], root);
    method = 'clone';
  } catch (cloneErr) {
    for (const entry of await readdir(root)) await rm(join(root, entry), { recursive: true, force: true });
    await cp(source, root, {
      recursive: true,
      filter: (src) => src === source || !SKIP_NAMES.has(basename(src)),
    });
    await git(['init', '--quiet', '-b', branch], root);
    await git(['add', '-A'], root);
    await git([...identity, 'commit', '--quiet', '--allow-empty', '-m', 'Seed agent sandbox'], root);
    method = 'copy';
    logStructured('info', 'workspace_sandbox_clone_fallback', { source, reason: String(cloneErr.message || cloneErr).split('\n')[0] });
  }

  logStructured('info', 'workspace_sandbox_seeded', { root, source, method, branch });
  return { seeded: true, method, branch };
}
