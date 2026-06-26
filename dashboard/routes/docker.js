import express from 'express';
import axios from 'axios';

export function createDockerRouter({
  DOCKER_CONTROL_ENABLED, DOCKER_COMPOSE_FILE, DOCKER_PROJECT_DIR, DOCKER_ENV_FILE,
  LLM_CONFIG, DEVICE_PROFILE, DEVICE_PROFILES, PRIMARY_LLM_URL_CANDIDATES,
  DOCKER_RUNNER_URL, MODEL_PULL_TIMEOUT_MS,
  BB_MCP_ENABLED, BB_MCP_URL, NEMOCLAW_URL, IN_DOCKER, WORKSPACE_ROOT,
  getServiceRegistry, runComposeAction, resolvePrimaryLlmUrl,
  fetchOllamaModels, fetchDockerRunnerModels, checkModelInRunnerList,
  checkTcpService, checkHttpService, normalizeOllamaModelName,
  execFileAsync,
  pullStatus, eventBus, logStructured, activeDockerRunnerModelRef,
}) {
  const router = express.Router();
  const activeProfile = DEVICE_PROFILES[DEVICE_PROFILE] || DEVICE_PROFILES.minimal;

  /**
   * Streams an Ollama `/api/pull` request, relaying progress via the event bus
   * (`model_pull_progress`) and recording the latest status in `pullStatus`.
   */
  async function startOllamaPull(endpoint, modelName, pullKey) {
    const startedAt = new Date().toISOString();
    pullStatus.set(pullKey, { endpoint, model: modelName, status: 'pulling', percent: null, message: 'starting', startedAt });
    eventBus.emit('model_pull_started', { endpoint, model: modelName, metadata: { status: 'pulling', message: 'starting' } });

    try {
      const primaryResolution = await resolvePrimaryLlmUrl();
      const response = await axios.post(
        `${primaryResolution.url}/api/pull`,
        { name: modelName, stream: true },
        { responseType: 'stream', timeout: MODEL_PULL_TIMEOUT_MS }
      );

      let buffer = '';
      let lastEmittedPercent = -1;
      let pullError = null;

      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!line) continue;

            let parsed;
            try {
              parsed = JSON.parse(line);
            } catch {
              continue;
            }

            if (parsed.error) {
              pullError = parsed.error;
              continue;
            }

            const percent = parsed.total ? Math.round((parsed.completed / parsed.total) * 100) : null;
            const current = { endpoint, model: modelName, status: 'pulling', percent, message: parsed.status || '', startedAt };
            pullStatus.set(pullKey, current);

            if (percent === null || percent !== lastEmittedPercent) {
              lastEmittedPercent = percent ?? lastEmittedPercent;
              eventBus.emit('model_pull_progress', { endpoint, model: modelName, metadata: current });
            }
          }
        });
        response.data.on('end', resolve);
        response.data.on('error', reject);
      });

      if (pullError) {
        throw new Error(pullError);
      }

      const completed = { endpoint, model: modelName, status: 'completed', percent: 100, message: 'success', startedAt, completedAt: new Date().toISOString() };
      pullStatus.set(pullKey, completed);
      eventBus.emit('model_pull_completed', { endpoint, model: modelName, metadata: completed });
    } catch (error) {
      const failed = { endpoint, model: modelName, status: 'failed', error: error.message, startedAt, completedAt: new Date().toISOString() };
      pullStatus.set(pullKey, failed);
      eventBus.emit('model_pull_failed', { endpoint, model: modelName, metadata: failed });
      logStructured('error', 'model_pull_failed', { endpoint, model: modelName, error: error.message });
    }
  }

  /**
   * Runs `docker model pull <model>` for Docker Model Runner endpoints.
   * Requires Docker CLI + socket access (AGENT_BOARD_ENABLE_DOCKER_CONTROL).
   */
  async function startDockerModelPull(endpoint, modelName, pullKey) {
    const startedAt = new Date().toISOString();
    pullStatus.set(pullKey, { endpoint, model: modelName, status: 'pulling', percent: null, message: 'docker model pull starting', startedAt });
    eventBus.emit('model_pull_started', { endpoint, model: modelName, metadata: { status: 'pulling', message: 'docker model pull starting' } });

    try {
      await execFileAsync('docker', ['model', 'pull', modelName], { timeout: MODEL_PULL_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
      const completed = { endpoint, model: modelName, status: 'completed', percent: 100, message: 'success', startedAt, completedAt: new Date().toISOString() };
      pullStatus.set(pullKey, completed);
      eventBus.emit('model_pull_completed', { endpoint, model: modelName, metadata: completed });
    } catch (error) {
      const details = error.code === 'ENOENT'
        ? `docker CLI not in container — pull from host: docker model pull ${modelName}`
        : `${error.message || ''}\n${error.stderr || ''}`.trim();
      const failed = { endpoint, model: modelName, status: 'failed', error: details, startedAt, completedAt: new Date().toISOString() };
      pullStatus.set(pullKey, failed);
      eventBus.emit('model_pull_failed', { endpoint, model: modelName, metadata: failed });
      logStructured('error', 'model_pull_failed', { endpoint, model: modelName, error: details });
    }
  }

  /**
   * Check service health via HTTP (no docker CLI needed inside container)
   * Ollama: GET /api/tags   Docker Model Runner (OpenAI): GET /v1/models
   */
  router.get('/docker/status', async (req, res) => {
    const primaryResolution = await resolvePrimaryLlmUrl();

    // Physical service checks (containers or Docker Desktop features)
    const serviceChecks = [
      {
        name: 'ollama',
        label: 'Ollama',
        url: `${primaryResolution.url}/api/tags`,
        ports: '8081:8080',
        backendType: 'ollama-container',
        checkType: 'http'
      },
      {
        name: 'docker-runner',
        label: 'Docker Model Runner',
        // Docker Model Runner: OpenAI-compatible, /v1/models lists pulled models
        url: `${DOCKER_RUNNER_URL}/models`,
        ports: 'host-internal',
        backendType: 'docker-runner',
        checkType: 'http'
      },
      {
        name: 'nemoclaw',
        label: 'NemoClaw',
        url: `${NEMOCLAW_URL}/`,
        ports: '9000:8080',
        backendType: 'sandbox',
        checkType: 'tcp'
      },
      {
        name: 'llm_openllm',
        label: 'OpenLLM',
        url: `${LLM_CONFIG.openllm.url}/v1/models`,
        ports: '8082:3000',
        backendType: 'openllm-container',
        checkType: 'http'
      }
    ];

    if (BB_MCP_ENABLED) {
      serviceChecks.push({
        name: 'bb-mcp',
        label: 'Blackboard MCP',
        url: `${BB_MCP_URL}/health`,
        ports: '3100:3100',
        backendType: 'mcp',
        checkType: 'http'
      });
    }

    // Probe in parallel — sequential 3s timeouts against down services stack up
    // fast enough to blow client budgets once a few services are offline.
    const containerEntries = await Promise.all(
      serviceChecks.map(async ({ name, label, url, ports, backendType, checkType }) => {
        try {
          if (checkType === 'tcp') {
            await checkTcpService(url, 3000);
          } else {
            await checkHttpService(url, 3000);
          }
          return [name, { running: true, status: 'healthy', ports, backendType, label }];
        } catch {
          return [name, { running: false, status: 'unavailable', ports, backendType, label }];
        }
      })
    );
    const containers = Object.fromEntries(containerEntries);

    // Per-endpoint LLM status — derived from the service checks above
    const runnerLive = containers['docker-runner']?.running ?? false;

    // When runner is up, check each docker-runner endpoint's model is actually pulled.
    let runnerModels = [];
    if (runnerLive) {
      try { runnerModels = await fetchDockerRunnerModels(DOCKER_RUNNER_URL); } catch { /* runner up but models list unavailable */ }
    }

    const endpoints = {};
    for (const [key, config] of Object.entries(LLM_CONFIG)) {
      if (config.backendType === 'ollama-container') {
        const ollamaUp = containers['ollama']?.running ?? false;
        let modelInstalled = false;
        if (ollamaUp) {
          try {
            const ollamaModels = await fetchOllamaModels(primaryResolution.url);
            modelInstalled = ollamaModels.some(
              (name) => normalizeOllamaModelName(name) === normalizeOllamaModelName(config.defaultModel)
            );
          } catch { /* ollama up but tags unavailable */ }
        }
        endpoints[key] = {
          name: config.name,
          model: config.defaultModel,
          backendType: config.backendType,
          live: ollamaUp && modelInstalled,
          containerRunning: ollamaUp,
          modelInstalled,
          fallback: !ollamaUp || !modelInstalled,
          resolvedUrl: primaryResolution.url,
          discovered: primaryResolution.discovered,
          candidates: PRIMARY_LLM_URL_CANDIDATES,
        };
      } else if (config.backendType === 'docker-runner') {
        const modelLoaded = runnerLive && checkModelInRunnerList(runnerModels, config.defaultModel);
        // On laptop profile, 16GB Docker Runner models exceed 8GB VRAM — mark as
        // disabled so the UI doesn't show them as available.
        const tooLargeForDevice = DEVICE_PROFILE === 'laptop' || DEVICE_PROFILE === 'minimal';
        if (tooLargeForDevice) {
          endpoints[key] = {
            name: config.name, model: config.defaultModel, backendType: config.backendType,
            live: false, modelLoaded, runnerLive, fallback: true,
            disabledReason: `${config.defaultModel} requires ≥16GB VRAM (${DEVICE_PROFILE} profile has 8GB)`,
          };
        } else {
          endpoints[key] = { name: config.name, model: config.defaultModel, backendType: config.backendType, live: modelLoaded, modelLoaded, runnerLive, fallback: !modelLoaded };
        }
      } else if (config.backendType === 'openllm-container') {
        const openllmUp = containers['llm_openllm']?.running ?? false;
        endpoints[key] = { name: config.name, model: config.defaultModel, backendType: config.backendType, live: openllmUp, fallback: !openllmUp };
      } else {
        // 'custom' backendType — cloud or user-registered endpoints. Treat as live when
        // an apiKey is present (cloud APIs don't have a local health endpoint to probe).
        const hasKey = !!(config.apiKey);
        endpoints[key] = {
          name: config.name,
          model: config.defaultModel,
          backendType: config.backendType,
          type: config.type || 'custom',
          live: hasKey,
          hasApiKey: hasKey,
          fallback: !hasKey,
        };
      }
    }

    const dockerRunning = Object.values(containers).some(c => c.running);
    res.json({
      dockerRunning,
      containers,
      endpoints,
      networks: { agentNetwork: true },
      volumes: {},
      errors: [],
      deviceProfile: { name: DEVICE_PROFILE, models: activeProfile.models, gpu: activeProfile.gpu },
      workspace: { configured: !!WORKSPACE_ROOT, root: WORKSPACE_ROOT || null },
      activeDockerRunnerModel: activeDockerRunnerModelRef.current,
    });
  });

  /**
   * Start/stop Docker containers
   */
  // NOTE: Docker management from inside this container is not supported by default.
  // The dashboard image does not install the Docker CLI or mount the Docker socket,
  // so attempting to run `docker compose` here will fail in the default deployment.
  // Control Docker from the host instead, or explicitly add in-container Docker support
  // (install CLI, mount /var/run/docker.sock) with appropriate security review.
  router.post('/docker/:action', async (req, res) => {
    const { action } = req.params;

    if (!['start', 'stop', 'restart'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    // Always return a warning unless Docker CLI is explicitly enabled in the container
    return res.status(501).json({
      success: false,
      action,
      error:
        'Docker management endpoints are disabled in this deployment. ' +
        'Please control Docker from the host or explicitly enable in-container Docker support.'
    });
  });

  router.get('/system/services', async (req, res) => {
    try {
      const registry = getServiceRegistry();
      const primaryResolution = await resolvePrimaryLlmUrl();

      const ollamaUrl = primaryResolution.url;

      const serviceEntries = await Promise.all(
        Object.values(registry).map(async (service) => {
          // Any service explicitly disabled via env var (controllable=false + disabledReason set)
          if (!service.controllable && service.disabledReason) {
            return [
              service.key,
              {
                ...service,
                running: false,
                status: 'disabled',
                resolvedUrl: null,
              },
            ];
          }

          const candidateUrl = service.key === 'ollama' ? ollamaUrl : service.candidates[0];

          try {
            if (service.checkType === 'tcp') {
              await checkTcpService(candidateUrl, 3000);
            } else {
              const probeUrl = `${candidateUrl}${service.probePath || '/'}`;
              await checkHttpService(probeUrl, 3000);
            }
            return [
              service.key,
              {
                ...service,
                running: true,
                status: 'healthy',
                resolvedUrl: candidateUrl,
              },
            ];
          } catch {
            return [
              service.key,
              {
                ...service,
                running: false,
                status: 'unavailable',
                resolvedUrl: candidateUrl,
              },
            ];
          }
        })
      );
      const services = Object.fromEntries(serviceEntries);

      // Fetch per-container resource usage from `docker stats`
      let containerStats = {};
      try {
        const { stdout } = await execFileAsync('docker', [
          'stats', '--no-stream', '--format',
          '{"name":"{{.Name}}","cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","memPerc":"{{.MemPerc}}","net":"{{.NetIO}}","block":"{{.BlockIO}}"}',
        ]);
        for (const line of stdout.trim().split('\n').filter(Boolean)) {
          try {
            const entry = JSON.parse(line);
            // Normalize container name → service key (strip leading slash, project prefix)
            const rawName = entry.name.replace(/^\//, '');
            containerStats[rawName] = {
              cpu: entry.cpu,
              mem: entry.mem,
              memPerc: entry.memPerc,
              net: entry.net,
              block: entry.block,
            };
          } catch { /* skip malformed line */ }
        }
        // Attach stats to matching service entries by composeService name
        for (const svc of Object.values(services)) {
          if (!svc.composeService) continue;
          const match = Object.entries(containerStats).find(([name]) =>
            name === svc.composeService || name.includes(svc.composeService)
          );
          if (match) svc.stats = match[1];
        }
      } catch { /* docker not available or not running — stats remain absent */ }

      res.json({
        success: true,
        dockerControlEnabled: DOCKER_CONTROL_ENABLED,
        inDocker: IN_DOCKER,
        services,
        containerStats,
        primaryLlm: {
          resolvedUrl: primaryResolution.url,
          discovered: primaryResolution.discovered,
          candidates: PRIMARY_LLM_URL_CANDIDATES,
        },
      });
    } catch (error) {
      logStructured('error', 'system_services_failed', { error: error.message });
      res.status(500).json({ success: false, error: 'Failed to load system services' });
    }
  });

  router.post('/system/services/:serviceKey/:action', async (req, res) => {
    const { serviceKey, action } = req.params;
    const validActions = new Set(['start', 'stop', 'restart']);
    if (!validActions.has(action)) {
      return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    const registry = getServiceRegistry();
    const service = registry[serviceKey];
    if (!service) {
      return res.status(404).json({ success: false, error: `Unknown service: ${serviceKey}` });
    }

    if (!service.controllable) {
      return res.status(400).json({
        success: false,
        error: `Service is not controllable in current mode${service.disabledReason ? ` (${service.disabledReason})` : ''}`,
      });
    }

    if (!DOCKER_CONTROL_ENABLED) {
      return res.status(501).json({
        success: false,
        error: 'Docker control is disabled. Set AGENT_BOARD_ENABLE_DOCKER_CONTROL=true to enable start/stop/restart actions.',
      });
    }

    // Enforce one LLM sidecar at a time: when starting an optional LLM container,
    // stop any other optional LLM sidecar that may be running.
    const LLM_SIDECAR_KEYS = ['llm_openllm'];
    if (action === 'start' && LLM_SIDECAR_KEYS.includes(serviceKey)) {
      const siblingsToStop = LLM_SIDECAR_KEYS.filter(k => k !== serviceKey);
      for (const siblingKey of siblingsToStop) {
        const sibling = registry[siblingKey];
        if (sibling?.controllable && sibling.composeService) {
          try {
            await runComposeAction('stop', sibling.composeService, null);
            logStructured('info', 'llm_sidecar_stopped_for_exclusive_start', { stopped: siblingKey, starting: serviceKey });
          } catch {
            // Non-fatal — sibling may not be running
          }
        }
      }
    }

    try {
      const result = await runComposeAction(action, service.composeService, service.composeProfile || null);
      res.json({
        success: true,
        serviceKey,
        action,
        result,
      });
    } catch (error) {
      logStructured('error', 'service_control_failed', {
        serviceKey,
        action,
        error: error.message,
      });
      res.status(500).json({ success: false, error: `Service action failed: ${error.message}` });
    }
  });

  /**
   * Pull a model for an LLM endpoint.
   * - `primary` (Ollama): streams progress from `/api/pull` via the event bus.
   * - `docker_runner`/`glm_flash` (Docker Model Runner): runs `docker model pull`,
   *   gated by AGENT_BOARD_ENABLE_DOCKER_CONTROL (requires Docker CLI + socket).
   * - `openllm`: not supported — its model is fixed at container build time.
   */
  router.post('/models/pull', async (req, res) => {
    const { endpoint, model } = req.body || {};
    const config = LLM_CONFIG[endpoint];
    if (!config) {
      return res.status(400).json({ success: false, error: `Unknown endpoint: ${endpoint}` });
    }

    const modelName = model || config.defaultModel;
    if (!modelName) {
      return res.status(400).json({ success: false, error: 'No model specified and the endpoint has no default model configured.' });
    }

    const pullKey = `${endpoint}:${modelName}`;
    const existing = pullStatus.get(pullKey);
    if (existing?.status === 'pulling') {
      return res.json({ success: true, pullKey, ...existing });
    }

    if (config.backendType === 'ollama-container') {
      startOllamaPull(endpoint, modelName, pullKey);
      return res.status(202).json({ success: true, pullKey, endpoint, model: modelName, status: 'pulling' });
    }

    if (config.backendType === 'docker-runner') {
      if (!DOCKER_CONTROL_ENABLED) {
        return res.status(501).json({
          success: false,
          error: `Pulling Docker Model Runner models from the dashboard requires AGENT_BOARD_ENABLE_DOCKER_CONTROL=true and Docker CLI/socket access. Until then, run on the host: docker model pull ${modelName}`,
        });
      }
      startDockerModelPull(endpoint, modelName, pullKey);
      return res.status(202).json({ success: true, pullKey, endpoint, model: modelName, status: 'pulling' });
    }

    return res.status(400).json({ success: false, error: `Pull is not supported for endpoint "${endpoint}" (${config.backendType}).` });
  });

  /**
   * Status of in-progress/last-known model pulls, keyed by `${endpoint}:${model}`.
   */
  router.get('/models/pull-status', (req, res) => {
    res.json({ success: true, pulls: Object.fromEntries(pullStatus) });
  });

  /**
   * Kick off pulls for all models that are not yet installed.
   * Ollama models are pulled via startOllamaPull; Docker Runner models require
   * AGENT_BOARD_ENABLE_DOCKER_CONTROL and are pulled via startDockerModelPull.
   */
  router.post('/models/pull-all', async (req, res) => {
    const initiated = [];
    const skipped = [];

    for (const [endpointKey, config] of Object.entries(LLM_CONFIG)) {
      const modelName = config.defaultModel;
      if (!modelName) { skipped.push({ endpoint: endpointKey, reason: 'no_model_configured' }); continue; }

      const pullKey = `${endpointKey}:${modelName}`;
      if (pullStatus.get(pullKey)?.status === 'pulling') {
        skipped.push({ endpoint: endpointKey, model: modelName, reason: 'already_pulling' });
        continue;
      }

      if (config.backendType === 'ollama-container') {
        startOllamaPull(endpointKey, modelName, pullKey);
        initiated.push({ endpoint: endpointKey, model: modelName });
      } else if (config.backendType === 'docker-runner') {
        if (!DOCKER_CONTROL_ENABLED) {
          skipped.push({ endpoint: endpointKey, model: modelName, reason: 'docker_control_disabled' });
          continue;
        }
        // Skip if already loaded in the runner (avoids noisy ENOENT errors for existing models)
        try {
          const runnerModels = await fetchDockerRunnerModels(DOCKER_RUNNER_URL);
          if (runnerModels.some(m => m.id === modelName)) {
            skipped.push({ endpoint: endpointKey, model: modelName, reason: 'already_loaded' });
            continue;
          }
        } catch { /* runner offline — proceed with pull attempt */ }
        startDockerModelPull(endpointKey, modelName, pullKey);
        initiated.push({ endpoint: endpointKey, model: modelName });
      } else {
        skipped.push({ endpoint: endpointKey, model: modelName, reason: 'unsupported_backend' });
      }
    }

    res.json({ success: true, initiated, skipped });
  });

  /**
   * Unload a Docker Runner model from memory.
   * Attempts `docker model rm <model>` to remove the pulled model.
   * Requires AGENT_BOARD_ENABLE_DOCKER_CONTROL=true.
   */
  router.post('/models/unload', async (req, res) => {
    if (!DOCKER_CONTROL_ENABLED) {
      return res.status(403).json({ success: false, error: 'Docker control not enabled' });
    }
    const { model } = req.body;
    if (!model) return res.status(400).json({ success: false, error: 'model is required' });
    try {
      await execFileAsync('docker', ['model', 'rm', model]);
      if (activeDockerRunnerModelRef.current?.model === model) activeDockerRunnerModelRef.current = null;
      res.json({ success: true, model });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/system/config-check
   * Validates that each registered service has a reachable candidate URL
   * and that Docker control is enabled (if any service is controllable).
   * Returns a list of passing/failing checks with diagnostic hints.
   */
  router.get('/system/config-check', async (req, res) => {
    const registry = getServiceRegistry();
    const checks = await Promise.all(
      Object.values(registry).map(async (svc) => {
        const base = {
          key: svc.key,
          label: svc.label,
          backendType: svc.backendType,
          controllable: svc.controllable,
          disabled: !!svc.disabledReason,
          disabledReason: svc.disabledReason || null,
        };

        if (svc.disabledReason) {
          return { ...base, reachable: null, hint: `Disabled: ${svc.disabledReason}` };
        }

        const candidate = svc.candidates?.[0];
        if (!candidate) return { ...base, reachable: false, hint: 'No candidate URL configured' };

        try {
          if (svc.checkType === 'tcp') {
            await checkTcpService(candidate, 2000);
          } else {
            const probe = svc.probePath ? `${candidate}${svc.probePath}` : candidate;
            await checkHttpService(probe, 2000);
          }
          return { ...base, reachable: true, hint: null };
        } catch {
          const hints = [];
          if (svc.controllable && !DOCKER_CONTROL_ENABLED) {
            hints.push('Docker control disabled — rebuild with docker-compose.docker-control.yml overlay to enable start/stop');
          }
          if (svc.composeProfile) hints.push(`Requires compose profile: ${svc.composeProfile}`);
          hints.push(`Expected at: ${candidate}`);
          return { ...base, reachable: false, hint: hints.join('; ') };
        }
      })
    );

    const passing = checks.filter(c => c.reachable === true).length;
    const failing = checks.filter(c => c.reachable === false).length;
    const disabled = checks.filter(c => c.reachable === null).length;

    res.json({
      success: true,
      dockerControlEnabled: DOCKER_CONTROL_ENABLED,
      summary: { total: checks.length, passing, failing, disabled },
      checks,
    });
  });

  return router;
}
