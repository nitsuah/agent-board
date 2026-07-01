/**
 * BYOK runtime endpoint registry
 * POST   /api/config/endpoints        — add/update a named external endpoint
 * GET    /api/config/endpoints        — list all endpoints (keys masked)
 * DELETE /api/config/endpoints/:key   — remove a runtime-added endpoint
 *
 * Endpoints added here merge into LLM_CONFIG at runtime.
 * They are lost on server restart (user re-enters via UI).
 */
import express from 'express';

const BUILTIN_KEYS = new Set(['primary', 'docker_runner', 'glm_flash', 'openllm']);

export function createEndpointsRouter({ LLM_CONFIG, logStructured }) {
  const router = express.Router();

  router.get('/config/endpoints', (req, res) => {
    const list = Object.entries(LLM_CONFIG).map(([key, cfg]) => ({
      key,
      name: cfg.name || key,
      url: cfg.url,
      apiStyle: cfg.apiStyle || 'openai',
      defaultModel: cfg.defaultModel || '',
      hasApiKey: !!(cfg.apiKey),
      builtin: BUILTIN_KEYS.has(key),
    }));
    res.json({ success: true, endpoints: list });
  });

  router.post('/config/endpoints', express.json(), (req, res) => {
    const { key, name, url, apiStyle, defaultModel, apiKey } = req.body || {};
    if (!key || !url) {
      return res.status(400).json({ success: false, error: 'key and url are required' });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      return res.status(400).json({ success: false, error: 'key must be alphanumeric/underscore/dash only' });
    }
    if (BUILTIN_KEYS.has(key)) {
      return res.status(400).json({ success: false, error: `"${key}" is a built-in endpoint and cannot be overwritten` });
    }
    LLM_CONFIG[key] = {
      url,
      name: name || key,
      backendType: 'custom',
      type: 'custom',
      apiStyle: apiStyle || 'openai',
      defaultModel: defaultModel || '',
      apiKey: apiKey || '',
    };
    logStructured('info', 'byok_endpoint_added', { key, url, apiStyle });
    res.json({ success: true, endpoint: { key, name: LLM_CONFIG[key].name, url, apiStyle, defaultModel, hasApiKey: !!(apiKey) } });
  });

  router.delete('/config/endpoints/:key', (req, res) => {
    const { key } = req.params;
    if (BUILTIN_KEYS.has(key)) {
      return res.status(400).json({ success: false, error: `"${key}" is a built-in endpoint and cannot be removed` });
    }
    if (!LLM_CONFIG[key]) {
      return res.status(404).json({ success: false, error: `Endpoint "${key}" not found` });
    }
    delete LLM_CONFIG[key];
    logStructured('info', 'byok_endpoint_removed', { key });
    res.json({ success: true, removed: key });
  });

  return router;
}
