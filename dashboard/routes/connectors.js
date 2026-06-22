import express from 'express';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONNECTORS_PATH = join(__dirname, '..', '..', 'config', 'connectors.json');

export function createConnectorsRouter({ BB_MCP_ENABLED, BB_MCP_URL, logStructured }) {
  const router = express.Router();

  function resolveConnectorUrl(connectorId) {
    if (connectorId === 'blackboard-learn') {
      return BB_MCP_ENABLED ? BB_MCP_URL : null;
    }
    return null;
  }

  router.get('/connectors', (req, res) => {
    try {
      if (!existsSync(CONNECTORS_PATH)) {
        return res.json({ success: true, connectors: [] });
      }
      const raw = readFileSync(CONNECTORS_PATH, 'utf-8');
      const { connectors } = JSON.parse(raw);
      const filteredConnectors = (connectors || []).filter((connector) => {
        if (connector?.id !== 'blackboard-learn') return true;
        return BB_MCP_ENABLED;
      });
      res.json({ success: true, connectors: filteredConnectors });
    } catch (err) {
      logStructured('error', 'connectors_read_failed', { error: err.message });
      res.status(500).json({ success: false, error: 'Failed to load connectors' });
    }
  });

  router.use('/mcp/:connectorId', async (req, res) => {
    const { connectorId } = req.params;
    const baseUrl = resolveConnectorUrl(connectorId);

    if (!baseUrl) {
      return res.status(404).json({ success: false, error: `Unknown connector: ${connectorId}` });
    }

    const subPath = req.path === '/proxy' ? '/mcp' : req.path;
    const target = `${baseUrl}${subPath}`;

    try {
      const proxyRes = await axios({
        method: req.method,
        url: target,
        headers: {
          ...req.headers,
          host: new URL(baseUrl).host,
        },
        data: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
        params: req.query,
        timeout: 30000,
        responseType: 'json',
        validateStatus: () => true,
      });

      res.status(proxyRes.status);
      Object.entries(proxyRes.headers).forEach(([k, v]) => {
        if (!['transfer-encoding', 'connection'].includes(k.toLowerCase())) {
          res.setHeader(k, v);
        }
      });
      res.json(proxyRes.data);
    } catch (err) {
      logStructured('error', 'mcp_proxy_failed', { connectorId, target, error: err.message });
      res.status(502).json({ success: false, error: `MCP connector unreachable: ${err.message}` });
    }
  });

  return router;
}
