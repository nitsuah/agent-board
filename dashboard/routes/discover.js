/**
 * Local endpoint discovery
 * GET /api/discover/endpoints
 *
 * Probes common LLM ports on localhost and host.docker.internal in parallel,
 * identifies OpenAI-compatible (/v1/models) and Ollama (/api/tags) endpoints,
 * and returns discovered services with detected API style and available models.
 */
import express from 'express';

// Ports likely to host a local LLM or OpenAI-compatible proxy
const DEFAULT_PORTS = [
  1234,   // LM Studio
  1337,   // Jan AI
  4891,   // LM Studio alternate
  5000,
  5001,
  7860,   // Gradio / text-gen-webui
  8000,
  8080,   // Ollama (Docker), generic
  8081,
  8082,
  8083,
  8084,
  8888,
  11434,  // Ollama (native host)
  11435,
  20128,  // 9router
];

const PROBE_TIMEOUT_MS = 1500;
const HOSTS = ['localhost', 'host.docker.internal'];

// Known port→name hints so discovered endpoints get a useful display name
const PORT_HINTS = {
  1234:  'LM Studio',
  1337:  'Jan AI',
  4891:  'LM Studio',
  7860:  'text-gen-webui',
  11434: 'Ollama (host)',
  11435: 'Ollama (host alt)',
  20128: '9router',
};

async function probeEndpoint(host, port) {
  const baseUrl = `http://${host}:${port}`;
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);

  // Try OpenAI-compatible first
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { signal });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const models = data?.data?.map(m => m.id) || [];
      return { url: baseUrl, apiStyle: 'openai', models };
    }
  } catch { /* not openai */ }

  // Try Ollama
  try {
    const res2 = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (res2.ok) {
      const data = await res2.json().catch(() => null);
      const models = data?.models?.map(m => m.name) || [];
      return { url: baseUrl, apiStyle: 'ollama', models };
    }
  } catch { /* not ollama */ }

  return null;
}

export function createDiscoverRouter({ LLM_CONFIG, logStructured }) {
  const router = express.Router();

  router.get('/discover/endpoints', async (req, res) => {
    const customPorts = req.query.ports
      ? String(req.query.ports).split(',').map(Number).filter(p => p > 0 && p < 65536)
      : [];
    const ports = customPorts.length > 0 ? customPorts : DEFAULT_PORTS;
    const hosts = req.query.host ? [String(req.query.host)] : HOSTS;

    // Build the set of URLs already registered so we can flag them
    const knownUrls = new Set(Object.values(LLM_CONFIG).map(c => c.url?.replace(/\/$/, '')));

    const probes = [];
    for (const host of hosts) {
      for (const port of ports) {
        probes.push({ host, port });
      }
    }

    const results = await Promise.allSettled(
      probes.map(({ host, port }) =>
        probeEndpoint(host, port).then(result => result ? { host, port, ...result } : null)
      )
    );

    const discovered = [];
    const seen = new Set();

    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const { host, port, url, apiStyle, models } = r.value;

      // De-duplicate: same port on both hosts often resolves to same service
      const dedupeKey = `${port}:${apiStyle}`;
      if (seen.has(dedupeKey) && host !== 'localhost') continue;
      seen.add(dedupeKey);

      const hint = PORT_HINTS[port];
      const name = hint || `${apiStyle === 'ollama' ? 'Ollama' : 'LLM'} on :${port}`;
      const key = `local_${port}`;

      discovered.push({
        key,
        name,
        url,
        apiStyle,
        models,
        defaultModel: models[0] || '',
        alreadyRegistered: knownUrls.has(url.replace(/\/$/, '')),
      });
    }

    logStructured('info', 'endpoint_discovery', {
      portsScanned: ports.length * hosts.length,
      found: discovered.length,
    });

    res.json({ success: true, discovered, scanned: ports.length * hosts.length });
  });

  return router;
}
