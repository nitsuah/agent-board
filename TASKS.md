# TASKS

Last Updated: 2026-06-12

## Todo

### P1 - High

- [ ] **[Q2-CEO] Docker optimization pass** — audit compose services and model pre-loads; make all non-essential subsystems opt-in via env flags; keep logging, metrics, and DB always up.
  - Priority: P1
  - Context: CEO flagged stability issues due to container size and memory usage on laptops and low-memory hosts.
  - Acceptance Criteria: `docker compose up` succeeds with a minimal profile on a 16 GB host; optional services (bb-mcp, large models) are gated behind env flags and documented.
  - [ ] **PERFORMANCE** - setup turbovec - setup turbovec to decrease LLM memory usage significantly
  - [x] **COMPETITORS** - Review other LLM products to integrate improvements or work alongside these tools effectively (ex: Thoth, OpenLLM, AirLLM, turbovec, BridgeMind, etc.) — see `docs/AI_STACK_STRATEGY.md` for the full breakdown and integration priority queue.

- [ ] **[Now] Embed turbovec into Kryptos FastAPI** — cipher/hypothesis RAG over `artifacts/`.
  - Priority: P1
  - Context: AI_STACK_STRATEGY.md priority queue #1. Kryptos (`~/code/kryptos`) currently has no FastAPI/HTTP layer — it's CLI + library only (`src/kryptos/cli/main.py`). Scope includes scaffolding a minimal FastAPI app before wiring in turbovec.
  - Tracking: implemented via a separate worktree/branch in `~/code/kryptos`, not in this repo.
  - Acceptance Criteria: kryptos exposes a search/query FastAPI endpoint backed by turbovec over `artifacts/`; documented in kryptos README.

- [ ] **[Q2-CEO] Model loading performance audit** — profile Ollama startup and model load times; identify bottlenecks and optimize for faster readiness.
  - Priority: P1
  - Context: large models take a long time to load, impacting development iteration speed and user experience.
  - Acceptance Criteria: Ollama startup time is reduced by at least 50% for the default model set; profiling data is documented in the repo.

- [ ] **[Q2-CEO] Selective model loading** — implement a model manifest or config flag so only explicitly requested models are loaded at startup; default to one small model.
  - Priority: P1
  - Context: large model pre-loads inflate memory and destabilize the stack for everyday use.
  - Acceptance Criteria: default compose starts with one lightweight model; adding more models requires an explicit config change; documented in README.

- [ ] **[Q2-CEO] GPU acceleration via CUDA** — configure Ollama container with NVIDIA runtime and device passthrough; detect RTX 4080 in docs and runtime checks.
  - Priority: P1
  - Context: host has an RTX 4080 (24 GB VRAM); GPU inference reduces RAM pressure and speeds generation significantly.
  - Acceptance Criteria: Ollama runs GPU-based inference when CUDA is available; setup guide covers driver, container-toolkit, and docker-compose GPU stanza requirements.

- [ ] **[Q2-CEO] File I/O and workspace mount** — add an agent capability to read/write files within a user-selected folder; support git commit/push via a workspace-scoped tool.
  - Priority: P1
  - Context: agents currently have no path to actually write to codebases or commit changes; this is a core capability gap.
  - Acceptance Criteria: agent can read a file, modify content, write it back, and run `git commit` within a declared workspace folder; folder path is user-configured; sandbox boundary is documented.

- [ ] Validate dashboard and Docker initialization.
  - Priority: P1
  - Context: README lists dashboard, Jaeger, Ollama, and NemoClaw endpoints that have not been revalidated together.
  - Acceptance Criteria: `docker compose up` completes cleanly and the documented local endpoints respond.

- [ ] Enable Ollama GPU acceleration for the RTX 4080.
  - Priority: P1
  - Context: the local stack is still CPU-bound even though the host has a 24 GB GPU available.
  - Acceptance Criteria: the Ollama service is configured for CUDA, GPU detection is validated, and setup prerequisites are documented.

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

- [x] **Expand safety-layer coverage and add adversarial prompt cases.**
  - Context: baseline safety tests passed, but edge-case coverage for prompt injection and mixed-content payloads was thin.
  - Acceptance Criteria: added `dashboard/tests/safety-layer.js` tests for whitespace/tab/newline-split and zero-width-character (U+200B) evasion of `blockedPatterns`/`sensitivePatterns`/`outputHarmKeywords`, mixed multi-type PII payloads (JSON-embedded, space-separated credit cards, all four PII types in one message), prompt-injection-over-PII classification priority, and mixed harmful-content+PII response sanitization. Fixed the underlying gap in `classifyInput`/`filterResponse` (`dashboard/server.js`) via a new `normalizeForMatching()` helper that strips zero-width characters and collapses whitespace runs before pattern matching. Full unit suite (`npm run test:unit`) and integration suite (`npm run test:integration`, all 12 e2e steps) pass in Docker against the rebuilt `agent-dashboard` image.

- [x] **[Now] Real container control + model pulls from the Services panel** — Start/Stop/Restart now hit the live `docker compose` CLI (gated by `AGENT_BOARD_ENABLE_DOCKER_CONTROL`, activated via the opt-in `config/docker-compose.docker-control.yml` overlay), and a new Models section lets the user pull each configured LLM endpoint's model (`ollama pull` for `primary`, streamed with live progress over `/ws/events`; `docker model pull` for the Docker Model Runner endpoints).
  - Context: the system panel previously only displayed start commands as text (e.g. "Start it on the host: docker compose ... up -d tool-content-gen") without a way to run them, and models had to be pulled manually outside the dashboard.
  - Acceptance Criteria: `POST /api/system/services/:serviceKey/:action` and the new `POST /api/models/pull` / `GET /api/models/pull-status` work against the live stack when the docker-control overlay is applied; Services panel shows Start/Stop/Restart with inline error feedback; Models panel shows install status and pull progress; unit + integration tests cover the new endpoints and route guards.
  - Follow-up: the Services panel previously only rendered the 4 `/api/docker/status` containers (ollama, docker-runner, nemoclaw, llm_openllm); it now also renders the `tool_content_gen`, `tool_website`, and `bb_mcp` entries from `/api/system/services` with the same Start/Stop/Restart controls. Also fixed `tool_content_gen`/`tool_website` intermittently reporting `unavailable` despite being healthy — concurrent DNS lookups for down hosts (nemoclaw, llm_openllm) were starving Node's libuv threadpool (default `UV_THREADPOOL_SIZE=4`) and delaying lookups for the healthy tool containers past their axios timeout; fixed via `ENV UV_THREADPOOL_SIZE=16` in `dashboard/Dockerfile`.

- [x] **[Now] Hook up content-gen & website tool servers as agent experiences** — 🎬 Content Studio and 🌐 Website Agent are selectable experiences whose chat sessions are paired with a tool workbench panel.
  - Context: the MCP servers under `tools/` (ports 3200/3201, compose profile `tools`) had no dashboard integration; the workbench lists each server's MCP tools, generates forms from their input schemas, and executes them via the new `/api/tools` proxy routes (Streamable HTTP MCP, stateless).
  - Acceptance Criteria: `/api/tools`, `/api/tools/:toolKey/tools`, `/api/tools/:toolKey/call` work against the live tool containers; both containers appear in the system services registry (start/stop gated by `AGENT_BOARD_ENABLE_DOCKER_CONTROL`); unit + integration tests cover experience wiring, MCP response parsing, and route guards.

- [x] **[Now] Swap primary Ollama model from llama2 to llama3.2:3b** — llama2-7B on a CPU-only host exceeded the dashboard's 120s chat timeout once conversation context grew; llama3.2:3b (2.0 GB) generates ~4x faster with far better instruction-following.
  - Context: the Docker Desktop VM has ~7.6 GB RAM, so only one Ollama model can be resident at a time; the default is now env-configurable via `PRIMARY_LLM_MODEL`.
  - Acceptance Criteria: full e2e-chat suite (all 12 steps) passes against the live stack with the new default; `OLLAMA_KEEP_ALIVE=30m` keeps the model warm between requests.

- [x] **[Now] Add OpenLLM endpoint to docker-compose.yml** — second OpenAI-compatible endpoint on port 8082 for custom/fine-tuned models.
  - Context: AI_STACK_STRATEGY.md priority queue #2.
  - Acceptance Criteria: `llm_openllm` service added behind the opt-in `openllm` compose profile (port `8082:3000`, `tools/llm-openllm/Dockerfile`); registered as the `openllm` endpoint in `LLM_CONFIG`, `getServiceRegistry()`, and the dashboard frontend; documented in README.md and `.env.example`.

<!--
AGENT INSTRUCTIONS:
1. Keep active items in P0-P3.
2. Move completed items to Done with [x].
3. Keep each task scannable: checkbox, short context, clear acceptance.
-->
