# TASKS

Last Updated: 2026-06-16

## Todo

### P1 - High

- [ ] **[Q2-CEO] Docker optimization pass** — audit compose services and model pre-loads; make all non-essential subsystems opt-in via env flags; keep logging, metrics, and DB always up.
  - Priority: P1
  - Context: CEO flagged stability issues due to container size and memory usage on laptops and low-memory hosts.
  - Acceptance Criteria: `docker compose up` succeeds with a minimal profile on a 16 GB host; optional services (bb-mcp, large models) are gated behind env flags and documented.
  - [ ] **PERFORMANCE** - setup turbovec - setup turbovec to decrease LLM memory usage significantly
  - [x] **COMPETITORS** - Review other LLM products to integrate improvements or work alongside these tools effectively (ex: Thoth, OpenLLM, AirLLM, turbovec, BridgeMind, etc.) — see `docs/AI_STACK_STRATEGY.md` for the full breakdown and integration priority queue.

- [ ] **[Q2-CEO] File I/O and workspace mount** — ✅ In this PR. See Done section.

### P2 - Medium

- [ ] **[Now] Unblock NemoClaw sandbox container** — `nemoclaw:latest` builds (1.92GB) but the container crash-loops.
  - Priority: P2
  - Context: Built via `scripts/setup-nemoclaw.ps1` (NVIDIA/NemoClaw). The image's entrypoint
    `/usr/local/bin/nemoclaw-start` and `/usr/local/lib/nemoclaw/sandbox-init.sh` come out of the
    Docker-Desktop-on-Windows build with CRLF line endings despite clean LF sources in the upstream
    repo (`env: 'bash\r': No such file or directory`) — a systemic Windows build-environment issue,
    not a one-file fix. Separately, `config/docker-compose.yml`'s `nemoclaw` service execs
    `/usr/local/bin/nemoclaw-wrapper.sh`, which doesn't exist in the current upstream image (the real
    entrypoint is `nemoclaw-start`) — the compose service command is stale vs. upstream's current
    image layout. No `nvidia/nemoclaw` image exists on Docker Hub as a fallback (`docker pull
    nvidia/nemoclaw:latest` 404s).
  - Acceptance Criteria: `docker compose up -d nemoclaw` produces a running, non-crash-looping
    container reachable on `9000:8080` — either by building on native Linux/WSL (avoids CRLF
    corruption), patching the built image's scripts to LF post-build, or rewriting the compose
    service's command to match the current upstream entrypoint.

- [ ] **[Now] Find a working OpenLLM (or replacement) custom-model endpoint** — `OPENLLM_ENABLED=false` until resolved.
  - Priority: P2
  - Context: AI_STACK_STRATEGY.md priority queue #2 added the `llm_openllm` compose service
    (port 8082, opt-in `openllm` profile). `openllm` 0.6.30 removed the `start` subcommand (fixed in
    `tools/llm-openllm/entrypoint.sh` to use `serve`, this PR), but `openllm serve` only accepts
    model names from its own GPU-sized catalog (24G-80Gx8 VRAM: llama3.1/3.2, qwen2.5, mistral,
    phi4, etc.) — not arbitrary HuggingFace repo ids as `OPENLLM_MODEL`/`.env.example` document.
    Catalog-only, GPU-only serving is fundamentally incompatible with arbitrary CPU-friendly
    custom models on this CLI version.
  - Acceptance Criteria: either (a) pin an older `openllm` version whose CLI accepts arbitrary HF
    repo ids, (b) replace `tools/llm-openllm` with a CPU-friendly serving stack (e.g. llama.cpp
    server, text-generation-inference) that can load `OPENLLM_MODEL`, or (c) drop the `openllm`
    endpoint from `LLM_CONFIG`/compose/docs if no viable option is found. Whichever path is chosen,
    flip `OPENLLM_ENABLED=true` and verify `/api/docker/status` reports
    `endpoints.openllm.live: true`.

- [ ] Add a GPU-oriented model portfolio after CUDA is enabled.
  - Priority: P2
  - Context: the repo needs an explicit plan for which large and small models should live on GPU without displacing the existing CPU workflows.
  - Acceptance Criteria: selected GPU models are documented, pulled successfully, surfaced in the dashboard, and kept within VRAM limits.

- [ ] Document model lifecycle and resource management APIs.
  - Priority: P2
  - Context: once GPU models are added, the system will need a documented load and unload story for reclaiming VRAM.
  - Acceptance Criteria: API design is written down and the dashboard has a defined model-management surface.

- [ ] Document a production deployment path.
  - Priority: P2
  - Context: the stack is local-first today and still lacks an agreed production deployment contract.
  - Acceptance Criteria: deployment guide or prod compose path exists and secrets handling is documented.

- [ ] **[Q2-CEO] MCP container manager** — design and implement a lightweight manager (container or API) that can spin up/down MCP tool containers (Playwright MCP, Jira/Confluence MCP, bb-mcp) on demand.
  - Priority: P2
  - Context: always-running MCP containers waste resources; a lifecycle manager lets agents request tools only when needed.
  - Acceptance Criteria: at least one MCP container (e.g., Playwright) can be started, used, and stopped via the manager API; compose integration documented.

- [ ] **[Q3-CEO] bb-mcp streaming UI** — render streaming SSE responses from bb-mcp tools in the agent-board chat/task panel with a typing indicator and incremental token display.
  - Priority: P2
  - Context: bb-mcp's server-side SSE transport is a Q2 item; this is the dashboard-side consumer. Together they complete the streaming story.
  - Acceptance Criteria: agent-board task panel streams bb-mcp responses character-by-character; typing indicator shows while stream is open; no content shift on completion.

- [ ] **[Q3-CEO] Multi-persona Blackboard agent selector** — expose student, instructor, admin, and parent bb-mcp tool sets as selectable agent personas in the dashboard.
  - Priority: P2
  - Context: bb-mcp RBAC gates tools per role server-side; the dashboard needs a persona picker so the right tool set loads for the right user type.
  - Acceptance Criteria: persona selector appears when bb-mcp is enabled; switching persona reloads available tools from the bb-mcp manifest; demo mode works without a live Blackboard instance.

- [ ] **[Q3-CEO] Blackboard agent demo mode** — add a demo-mode preset that walks through a full Blackboard workflow (course discovery → assignment submission → grade check) using bb-mcp without a live Blackboard connection.
  - Priority: P2
  - Context: portfolio showcase requires a runnable demo; demo mode lets this work without institutional credentials.
  - Acceptance Criteria: `BB_MCP_ENABLED=true BB_MCP_DEMO=true docker compose up` runs the full demo flow; documented in README.

- [ ] **[Q3-CEO] bb-mcp tool registry panel** — display available bb-mcp tools alongside other MCP providers in the dashboard; show last invocation time and per-role availability status.
  - Priority: P3
  - Context: as the MCP container ecosystem grows, the dashboard needs a registry view so users know what tools are available and active.
  - Acceptance Criteria: a tools panel lists bb-mcp tools with status badges; clicking a tool shows its schema and last-run result.

- [ ] Document agent lifecycle APIs.
  - Priority: P2
  - Context: README references agent start, stop, restart, and persistence behavior that is not described in `docs/API.md`.
  - Acceptance Criteria: lifecycle endpoints are documented with request and response examples.

- [ ] Expand coverage after the reporting baseline is restored.
  - Priority: P2
  - Context: once coverage reporting is working, the repo still needs broader automated coverage around lifecycle, safety, and task orchestration.
  - Acceptance Criteria: at least 20 focused tests cover the core agent flows and publish coverage.

### P3 - Exploratory

- [ ] Clarify MCP integration scope.
  - Priority: P3
  - Context: `docs/MCP_SETUP.md` exists, but the practical integration story is still unclear.
  - Acceptance Criteria: one documented MCP provider flow works end to end.

- [ ] Validate cross-agent event bus behavior.
  - Priority: P3
  - Context: event-bus coordination is still listed as capability without a proven scenario.
  - Acceptance Criteria: two agents exchange events in a documented demo path.

## In Progress

## Done

<!--
AGENT INSTRUCTIONS:
1. Keep active items in P0-P3.
2. Move completed items to Done with [x].
3. Keep each task scannable: checkbox, short context, clear acceptance.
-->
