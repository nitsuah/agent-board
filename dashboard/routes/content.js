import express from 'express';
import { join, resolve as resolvePath } from 'path';
import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';

export function createContentRouter({ WEBSITE_OUTPUT_DIR }) {
  const router = express.Router();

  router.get('/content/clients', async (req, res) => {
    try {
      let entries;
      try {
        entries = await readdir(WEBSITE_OUTPUT_DIR);
      } catch {
        return res.json({ success: true, clients: [] });
      }
      const clients = [];
      for (const entry of entries) {
        try {
          const s = await stat(join(WEBSITE_OUTPUT_DIR, entry));
          if (s.isDirectory()) clients.push(entry);
        } catch { /* skip */ }
      }
      res.json({ success: true, clients });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/content/clients/:slug/files', async (req, res) => {
    const { slug } = req.params;
    if (!/^[\w-]+$/.test(slug)) return res.status(400).json({ success: false, error: 'Invalid slug' });
    const clientDir = join(WEBSITE_OUTPUT_DIR, slug);
    try {
      const files = [];
      async function walk(dir, prefix) {
        let entries;
        try { entries = await readdir(dir); } catch { return; }
        for (const entry of entries) {
          const full = join(dir, entry);
          const rel  = prefix ? `${prefix}/${entry}` : entry;
          try {
            const s = await stat(full);
            if (s.isDirectory()) {
              await walk(full, rel);
            } else {
              files.push({ path: rel, size: s.size, mtime: s.mtime });
            }
          } catch { /* skip */ }
        }
      }
      await walk(clientDir, '');
      res.json({ success: true, slug, files });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/content/download/:slug/*', (req, res) => {
    const { slug } = req.params;
    if (!/^[\w-]+$/.test(slug)) return res.status(400).json({ success: false, error: 'Invalid slug' });
    const filePath = req.params[0];
    if (!filePath) return res.status(400).json({ success: false, error: 'Missing file path' });
    const fullPath = resolvePath(join(WEBSITE_OUTPUT_DIR, slug, filePath));
    if (!fullPath.startsWith(resolvePath(WEBSITE_OUTPUT_DIR))) {
      return res.status(403).json({ success: false, error: 'Path traversal blocked' });
    }
    if (!existsSync(fullPath)) return res.status(404).json({ success: false, error: 'File not found' });
    res.download(fullPath);
  });

  return router;
}
