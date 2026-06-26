/**
 * Session outputs — per-session file storage for generated outputs.
 * Files are saved under <cwd>/tmp/<sessionId>/<filename>.
 * Cleaned up when the session is deleted.
 */
import { Router } from 'express';
import { createReadStream, mkdirSync, writeFileSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import path from 'path';

const router = Router();
const TMP_ROOT = path.join(process.cwd(), 'tmp');

/**
 * Save a file to the session's output directory.
 * Called from server code when a tool or agent produces output.
 */
export function saveOutput(sessionId, filename, content) {
  const dir = path.join(TMP_ROOT, sessionId);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  writeFileSync(filePath, content);
  return filePath;
}

router.get('/sessions/:id/outputs', async (req, res) => {
  const dir = path.join(TMP_ROOT, req.params.id);
  try {
    const files = await readdir(dir).catch(() => []);
    const results = await Promise.all(files.map(async f => {
      const s = await stat(path.join(dir, f)).catch(() => null);
      return s ? { filename: f, size: s.size, createdAt: s.birthtime } : null;
    }));
    res.json(results.filter(Boolean));
  } catch { res.json([]); }
});

router.get('/sessions/:id/outputs/:filename', (req, res) => {
  const dir = path.join(TMP_ROOT, req.params.id);
  const safe = path.resolve(dir, req.params.filename);
  if (!safe.startsWith(dir)) return res.status(403).end();
  res.download(safe, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

export default router;
