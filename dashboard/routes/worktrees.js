/**
 * tmux multi-agent worktrees
 *
 * GET    /api/worktrees        — list agent worktrees + their tmux windows
 * POST   /api/worktrees        — create a git worktree and launch an agent in its own tmux window
 * DELETE /api/worktrees/:slug  — kill the tmux window and remove the worktree
 *
 * ── tmux session naming scheme ───────────────────────────────────────────────
 *   session : "agentboard"            (override with AGENT_BOARD_TMUX_SESSION)
 *   window  : "ab-<slug>"             one window per agent worktree
 *   target  : "agentboard:ab-<slug>"  what tmux commands address
 *   path    : <WORKTREE_ROOT>/<slug>  the worktree checkout the window starts in
 *   branch  : "agent/<slug>"          branch created for the worktree
 *
 * <slug> is derived from the requested name, lowercased and restricted to
 * [a-z0-9-]. One flat session with one window per agent means `tmux attach -t
 * agentboard` then Ctrl-b w gives a human the full picture of every running
 * agent, and `tmux kill-window -t agentboard:ab-<slug>` cleanly stops just one.
 *
 * Disabled by default. Set AGENT_BOARD_ENABLE_TMUX=true to allow this router to
 * spawn processes — same opt-in shape as AGENT_BOARD_ENABLE_DOCKER_CONTROL.
 */
import express from 'express';
import { join } from 'path';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DEFAULT_SESSION = 'agentboard';
const WINDOW_PREFIX = 'ab-';
const BRANCH_PREFIX = 'agent/';
const EXEC_TIMEOUT_MS = 30_000;

/** Lowercase, collapse to [a-z0-9-], trim dashes, cap at 40 chars. */
export function slugifyWorktreeName(raw) {
  const slug = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return SLUG_RE.test(slug) ? slug : null;
}

export function windowNameFor(slug) { return `${WINDOW_PREFIX}${slug}`; }
export function tmuxTargetFor(slug, session = DEFAULT_SESSION) { return `${session}:${WINDOW_PREFIX}${slug}`; }
export function branchNameFor(slug) { return `${BRANCH_PREFIX}${slug}`; }

export function createWorktreesRouter({
  execFileAsync,
  WORKSPACE_ROOT,
  WORKTREE_ROOT = null,
  TMUX_ENABLED = false,
  TMUX_SESSION = DEFAULT_SESSION,
  eventBus = null,
  logStructured = () => {},
}) {
  const router = express.Router();
  const worktreeRoot = WORKTREE_ROOT || (WORKSPACE_ROOT ? join(WORKSPACE_ROOT, '.worktrees') : null);

  const naming = {
    session: TMUX_SESSION,
    windowPattern: `${WINDOW_PREFIX}<slug>`,
    targetPattern: `${TMUX_SESSION}:${WINDOW_PREFIX}<slug>`,
    branchPattern: `${BRANCH_PREFIX}<slug>`,
    worktreeRoot,
  };

  /** Run a command, never throwing — callers branch on `ok`. */
  async function run(cmd, args, opts = {}) {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 1024 * 1024, ...opts });
      return { ok: true, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() };
    } catch (err) {
      return { ok: false, error: err.message, stderr: String(err.stderr || '').trim(), code: err.code };
    }
  }

  function tmuxUnavailable(result) {
    const details = `${result.error || ''} ${result.stderr || ''}`;
    return result.code === 'ENOENT' || /not found|is not recognized|no such file/i.test(details);
  }

  function guard(res) {
    if (!TMUX_ENABLED) {
      res.status(503).json({
        success: false,
        error: 'tmux worktrees are disabled. Set AGENT_BOARD_ENABLE_TMUX=true to enable.',
        naming,
      });
      return false;
    }
    if (!worktreeRoot) {
      res.status(503).json({
        success: false,
        error: 'No worktree root configured. Set WORKSPACE_ROOT or AGENT_BOARD_WORKTREE_ROOT.',
        naming,
      });
      return false;
    }
    return true;
  }

  /** Ensure the shared tmux session exists (idempotent). */
  async function ensureSession() {
    const has = await run('tmux', ['has-session', '-t', TMUX_SESSION]);
    if (has.ok) return { ok: true, created: false };
    if (tmuxUnavailable(has)) return { ok: false, unavailable: true, error: 'tmux is not installed on the dashboard host' };
    const created = await run('tmux', ['new-session', '-d', '-s', TMUX_SESSION, '-c', worktreeRoot]);
    if (!created.ok) {
      return { ok: false, unavailable: tmuxUnavailable(created), error: created.stderr || created.error };
    }
    return { ok: true, created: true };
  }

  async function listTmuxWindows() {
    const result = await run('tmux', ['list-windows', '-t', TMUX_SESSION, '-F', '#{window_name}\t#{window_index}\t#{pane_current_path}']);
    if (!result.ok) return { available: !tmuxUnavailable(result), windows: [] };
    const windows = result.stdout.split('\n').filter(Boolean).map(line => {
      const [name, index, path] = line.split('\t');
      return { name, index: Number(index), path: path || null };
    }).filter(w => w.name?.startsWith(WINDOW_PREFIX));
    return { available: true, windows };
  }

  async function listGitWorktrees() {
    if (!WORKSPACE_ROOT) return [];
    const result = await run('git', ['worktree', 'list', '--porcelain'], { cwd: WORKSPACE_ROOT });
    if (!result.ok) return [];
    const entries = [];
    let current = {};
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) entries.push(current);
        current = { path: line.slice('worktree '.length) };
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).replace('refs/heads/', '');
      } else if (line === 'detached') {
        current.branch = null;
      }
    }
    if (current.path) entries.push(current);
    return entries;
  }

  router.get('/worktrees', async (req, res) => {
    if (!TMUX_ENABLED) {
      return res.json({ success: true, enabled: false, worktrees: [], naming, tmuxAvailable: false });
    }
    const { available, windows } = await listTmuxWindows();
    const gitWorktrees = await listGitWorktrees();
    const worktrees = windows.map(w => {
      const slug = w.name.slice(WINDOW_PREFIX.length);
      const branch = branchNameFor(slug);
      return {
        slug,
        window: w.name,
        windowIndex: w.index,
        target: tmuxTargetFor(slug, TMUX_SESSION),
        path: w.path,
        branch,
        attachCommand: `tmux attach -t ${TMUX_SESSION} \\; select-window -t ${w.name}`,
        hasGitWorktree: gitWorktrees.some(g => g.branch === branch),
      };
    });
    res.json({ success: true, enabled: true, tmuxAvailable: available, worktrees, count: worktrees.length, gitWorktrees, naming });
  });

  router.post('/worktrees', async (req, res) => {
    if (!guard(res)) return;

    const { name, command = null, branch: requestedBranch = null } = req.body || {};
    const slug = slugifyWorktreeName(name);
    if (!slug) {
      return res.status(400).json({
        success: false,
        error: 'A "name" is required and must reduce to a slug matching [a-z0-9][a-z0-9-]{0,39}',
      });
    }
    if (requestedBranch !== null && (typeof requestedBranch !== 'string' || !/^[A-Za-z0-9._\/-]{1,100}$/.test(requestedBranch))) {
      return res.status(400).json({ success: false, error: 'Invalid branch name' });
    }
    if (command !== null && (typeof command !== 'string' || command.length > 2000)) {
      return res.status(400).json({ success: false, error: 'command must be a string under 2000 chars' });
    }

    const branch = requestedBranch || branchNameFor(slug);
    const windowName = windowNameFor(slug);
    const target = tmuxTargetFor(slug, TMUX_SESSION);
    const worktreePath = join(worktreeRoot, slug);

    const session = await ensureSession();
    if (!session.ok) {
      return res.status(503).json({ success: false, error: session.error, tmuxAvailable: !session.unavailable, naming });
    }

    // Reject duplicates rather than silently attaching to an existing agent window.
    const { windows } = await listTmuxWindows();
    if (windows.some(w => w.name === windowName)) {
      return res.status(409).json({ success: false, error: `Worktree "${slug}" already has a tmux window (${target})`, target });
    }

    // Create the git worktree. If the branch already exists, check it out instead of -b.
    let worktreeCreated = false;
    let worktreeWarning = null;
    if (WORKSPACE_ROOT) {
      let add = await run('git', ['worktree', 'add', '-b', branch, worktreePath], { cwd: WORKSPACE_ROOT });
      if (!add.ok && /already exists|already used by worktree/i.test(`${add.stderr} ${add.error}`)) {
        add = await run('git', ['worktree', 'add', worktreePath, branch], { cwd: WORKSPACE_ROOT });
      }
      if (add.ok) {
        worktreeCreated = true;
      } else {
        worktreeWarning = `git worktree add failed: ${add.stderr || add.error}`;
        logStructured('warn', 'worktree_git_add_failed', { slug, branch, error: worktreeWarning });
      }
    } else {
      worktreeWarning = 'WORKSPACE_ROOT not set — tmux window created without a git worktree';
    }

    const startDir = worktreeCreated ? worktreePath : worktreeRoot;
    const created = await run('tmux', ['new-window', '-d', '-t', TMUX_SESSION, '-n', windowName, '-c', startDir]);
    if (!created.ok) {
      // Roll the worktree back so a failed launch does not leave orphaned checkouts.
      if (worktreeCreated) {
        await run('git', ['worktree', 'remove', '--force', worktreePath], { cwd: WORKSPACE_ROOT });
      }
      return res.status(503).json({
        success: false,
        error: `Failed to create tmux window: ${created.stderr || created.error}`,
        tmuxAvailable: !tmuxUnavailable(created),
        naming,
      });
    }

    // send-keys passes `command` as a single argv element to tmux (execFile, no
    // shell on our side), but tmux itself runs it in the window's shell.
    if (command) {
      await run('tmux', ['send-keys', '-t', target, command, 'Enter']);
    }

    logStructured('info', 'worktree_created', { slug, target, branch, path: startDir, worktreeCreated, hasCommand: !!command });
    eventBus?.emit('worktree_created', {
      metadata: { slug, target, branch, path: startDir, session: TMUX_SESSION, worktreeCreated },
    });

    res.status(201).json({
      success: true,
      worktree: {
        slug,
        session: TMUX_SESSION,
        window: windowName,
        target,
        branch,
        path: startDir,
        worktreeCreated,
        commandSent: !!command,
        attachCommand: `tmux attach -t ${TMUX_SESSION} \\; select-window -t ${windowName}`,
      },
      warning: worktreeWarning,
      naming,
    });
  });

  router.delete('/worktrees/:slug', async (req, res) => {
    if (!guard(res)) return;

    const slug = slugifyWorktreeName(req.params.slug);
    if (!slug) return res.status(400).json({ success: false, error: 'Invalid worktree slug' });

    const target = tmuxTargetFor(slug, TMUX_SESSION);
    const worktreePath = join(worktreeRoot, slug);
    const removeWorktree = req.query.keepWorktree !== 'true';

    const killed = await run('tmux', ['kill-window', '-t', target]);
    if (!killed.ok && tmuxUnavailable(killed)) {
      return res.status(503).json({ success: false, error: 'tmux is not installed on the dashboard host', naming });
    }

    let worktreeRemoved = false;
    if (removeWorktree && WORKSPACE_ROOT) {
      const removed = await run('git', ['worktree', 'remove', '--force', worktreePath], { cwd: WORKSPACE_ROOT });
      worktreeRemoved = removed.ok;
    }

    logStructured('info', 'worktree_removed', { slug, target, windowKilled: killed.ok, worktreeRemoved });
    eventBus?.emit('worktree_removed', { metadata: { slug, target, windowKilled: killed.ok, worktreeRemoved } });

    res.json({ success: true, slug, target, windowKilled: killed.ok, worktreeRemoved });
  });

  return router;
}
