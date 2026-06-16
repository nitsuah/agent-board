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

- [x] **Expand safety-layer coverage and add adversarial prompt cases.**
  - Context: baseline safety tests passed, but edge-case coverage for prompt injection and mixed-content payloads was thin.
  - Acceptance Criteria: added `dashboard/tests/safety-layer.js` tests for whitespace/tab/newline-split and zero-width-character (U+200B) evasion of `blockedPatterns`/`sensitivePatterns`/`outputHarmKeywords`, mixed multi-type PII payloads (JSON-embedded, space-separated credit cards, all four PII types in one message), prompt-injection-over-PII classification priority, and mixed harmful-content+PII response sanitization. Fixed the underlying gap in `classifyInput`/`filterResponse` (`dashboard/server.js`) via a new `normalizeForMatching()` helper that strips zero-width characters and collapses whitespace runs before pattern matching. Full unit suite (`npm run test:unit`) and integration suite (`npm run test:integration`, all 12 e2e steps) pass in Docker against the rebuilt `agent-dashboard` image.

- [x] **Validate dashboard and Docker initialization.**
  - Context: README lists dashboard, Jaeger, Ollama, and NemoClaw endpoints that had not been revalidated together.
  - Acceptance Criteria: `docker compose up` completes cleanly and the documented local endpoints respond. Verified: dashboard (`/api/health` → 200), Jaeger UI (16686 → 200), Ollama API (8081/api/tags → 200), tool-content-gen (3200/health → 200), tool-website (3201/health → 200) all respond. NemoClaw (9000) does not respond — already tracked as a known crash-loop (P2 "Unblock NemoClaw sandbox container"); README's Quick Start endpoint list now notes this. OpenLLM (8082) does not respond — opt-in profile, disabled by default (P2 "Find a working OpenLLM endpoint"), already noted as opt-in in README.

- [x] **[Now] Real container control + model pulls from the Services panel** — Start/Stop/Restart now hit the live `docker compose` CLI (gated by `AGENT_BOARD_ENABLE_DOCKER_CONTROL`, activated via the opt-in `config/docker-compose.docker-control.yml` overlay), and a new Models section lets the user pull each configured LLM endpoint's model (`ollama pull` for `primary`, streamed with live progress over `/ws/events`; `docker model pull` for the Docker Model Runner endpoints).
  - Context: the system panel previously only displayed start commands as text (e.g. "Start it on the host: docker compose ... up -d tool-content-gen") without a way to run them, and models had to be pulled manually outside the dashboard.
  - Acceptance Criteria: `POST /api/system/services/:serviceKey/:action` and the new `POST /api/models/pull` / `GET /api/models/pull-status` work against the live stack when the docker-control overlay is applied; Services panel shows Start/Stop/Restart with inline error feedback; Models panel shows install status and pull progress; unit + integration tests cover the new endpoints and route guards.
  - Follow-up: the Services panel previously only rendered the 4 `/api/docker/status` containers (ollama, docker-runner, nemoclaw, llm_openllm); it now also renders the `tool_content_gen`, `tool_website`, and `bb_mcp` entries from `/api/system/services` with the same Start/Stop/Restart controls. Also fixed `tool_content_gen`/`tool_website` intermittently reporting `unavailable` despite being healthy — concurrent DNS lookups for down hosts (nemoclaw, llm_openllm) were starving Node's libuv threadpool (default `UV_THREADPOOL_SIZE=4`) and delaying lookups for the healthy tool containers past their axios timeout; fixed via `ENV UV_THREADPOOL_SIZE=16` in `dashboard/Dockerfile`.

- [x] **[Now] Hook up content-gen & website tool servers as agent experiences** — 🎬 Content Studio and 🌐 Website Agent are selectable experiences whose chat sessions are paired with a tool workbench panel.
  - Context: the MCP servers under `tools/` (ports 3200/3201, compose profile `tools`) had no dashboard integration; the workbench lists each server's MCP tools, generates forms from their input schemas, and executes them via the new `/api/tools` proxy routes (Streamable HTTP MCP, stateless).
  - Acceptance Criteria: `/api/tools`, `/api/tools/:toolKey/tools`, `/api/tools/:toolKey/call` work against the live tool containers; both containers appear in the system services registry (start/stop gated by `AGENT_BOARD_ENABLE_DOCKER_CONTROL`); unit + integration tests cover experience wiring, MCP response parsing, and route guards.

- [x] **[Q2-CEO] Model loading performance audit** — profiled Ollama startup and model load times; identified bottleneck (`load_tensors: mmap=false`); added opt-in warmup service.
  - Context: large models take a long time to load, impacting development iteration speed and user experience.
  - Acceptance Criteria: profiling data ✅ documented in `docs/MODEL_LOADING_AUDIT.md` (all 8 log samples, bottleneck analysis, ranked recommendations). ≥50% cold-load reduction ⚠️ not met by model swap alone (~17-23% average reduction from llama2→llama3.2:3b). Opt-in `ollama-warmup` compose service (profile `warmup`) moves the cold-load delay from first user chat to `docker compose up` time. Remaining path to 50%+ is GPU acceleration (tracked separately, P1).

- [x] **[Now] Swap primary Ollama model from llama2 to llama3.2:3b** — llama2-7B on a CPU-only host exceeded the dashboard's 120s chat timeout once conversation context grew; llama3.2:3b (2.0 GB) generates ~4x faster with far better instruction-following.
  - Context: the Docker Desktop VM has ~7.6 GB RAM, so only one Ollama model can be resident at a time; the default is now env-configurable via `PRIMARY_LLM_MODEL`.
  - Acceptance Criteria: full e2e-chat suite (all 12 steps) passes against the live stack with the new default; `OLLAMA_KEEP_ALIVE=30m` keeps the model warm between requests.

- [x] **[Now] Add OpenLLM endpoint to docker-compose.yml** — second OpenAI-compatible endpoint on port 8082 for custom/fine-tuned models.
  - Context: AI_STACK_STRATEGY.md priority queue #2.
  - Acceptance Criteria: `llm_openllm` service added behind the opt-in `openllm` compose profile (port `8082:3000`, `tools/llm-openllm/Dockerfile`); registered as the `openllm` endpoint in `LLM_CONFIG`, `getServiceRegistry()`, and the dashboard frontend; documented in README.md and `.env.example`.

- [x] **[Q2-CEO] File I/O and workspace mount** — agent-dashboard can read, write, and git-commit/push files in a host-mounted workspace folder.
  - Context: agents had no path to write to codebases or commit changes. Added `/api/workspace/*` routes (ls, read, write, git/status, git/commit, git/push) sandboxed to `WORKSPACE_ROOT`; compose overlay mounts any host folder via `WORKSPACE_PATH`; System panel file browser + git controls.
  - Acceptance Criteria: `/api/workspace/read` and `/api/workspace/write` are path-traversal-sandboxed; `POST /api/workspace/git/commit` stages and commits; `POST /api/workspace/git/push` pushes; System panel shows file browser, changed files, commit message input, Commit + Push buttons; "Not configured" state shown when `WORKSPACE_ROOT` not set. ✅ Shipped.

- [x] **[Now] Embed turbovec into Kryptos FastAPI** — cipher/hypothesis RAG over `artifacts/`.
  - Context: AI_STACK_STRATEGY.md priority queue #1. Kryptos had no FastAPI/HTTP layer; new `kryptos serve` CLI command starts a FastAPI app with turbovec-backed semantic search over `artifacts/`. Implemented in `~/code/kryptos` (separate repo/branch, PR #113 merged 2026-06-16).
  - Acceptance Criteria: `kryptos serve` starts a FastAPI app; `POST /api/rag/reindex` builds a turbovec index over `artifacts/`; `GET /api/rag/search?q=...` returns ranked results; `data/turbovec/` index is gitignored. ✅ Merged.

- [x] **[Q2-CEO] Selective model loading / device profile system** — auto-detect host hardware (GPU VRAM + RAM) at startup; select the best default model for the detected tier without any manual configuration.
  - Context: instead of a static model manifest, implemented a three-tier device profile system (`minimal` / `laptop` / `desktop`) with hardware thresholds. Profile drives `primary` endpoint's default model; `DEVICE_PROFILE` env var allows manual override.
  - Acceptance Criteria: `DEVICE_PROFILE` env var (or auto-detected value) selects profile; profile models are documented in `config/device-profiles.json`; `scripts/detect-profile.ps1` writes the correct value to `.env`; dashboard System panel shows active profile name, GPU status, and model assignments. ✅ Shipped in this PR.

- [x] **[Q2-CEO] GPU acceleration via CUDA** — configure Ollama container with NVIDIA runtime and device passthrough; support RTX 3070 (laptop) and RTX 4080 (desktop) via compose overlay.
  - Context: host hardware ranges from RTX 3070 TPD-locked (8 GB VRAM) to RTX 4080 (24 GB VRAM). GPU passthrough is opt-in via `config/docker-compose.gpu.yml` overlay so CPU-only hosts are unaffected.
  - Acceptance Criteria: `docker compose -f config/docker-compose.yml -f config/docker-compose.gpu.yml --project-directory . up -d` enables NVIDIA runtime for Ollama; NVIDIA Container Toolkit prerequisites documented in `docker-compose.gpu.yml` header; device profile system selects GPU-appropriate models when CUDA is available. ✅ Shipped in this PR.

<!--
AGENT INSTRUCTIONS:
1. Keep active items in P0-P3.
2. Move completed items to Done with [x].
3. Keep each task scannable: checkbox, short context, clear acceptance.
-->
