# TASKS

Last Updated: 2026-09-02

## Todo

### P1 - High

- [x] **[QUALITY] Raise statement coverage to ≥80%** — statement coverage is 63.41%, below the documented target.
  - Priority: P1
  - Context: 64 test files exist but coverage (2026-04-03 baseline) sits at 63% statements / 57% branches / 74% functions. Gaps are concentrated in `persistence.js` (83%), `server.js` (63%), and `tracing.js` (54%). New route modules added since April are not yet measured.
  - Acceptance Criteria: `npm run test:coverage` reports ≥80% statements. (Publishing the lcov report as a CI artifact is tracked separately below — this task is scoped to the coverage number itself.)
  - Done (2026-08-27): **81.03% statements** / 71.85% branches / 89.59% functions,
    66/66 unit tests passing. The 63.41% figure was not reproducible; the real
    measured baseline was 64.27%. Got there by (a) un-excluding 12 suites that
    already started the app in-process but were skipped by `run-unit-tests.mjs`,
    (b) fixing 6 suites that hardcoded `localhost:3000` without starting a server
    (`tests/helpers/test-server.js`), and (c) new behavioral suites for
    `mcp-helpers` (100%), `workspace` with a real git root (29→71%),
    `agent-tools` via a scripted stub LLM (43→82%), and `session-stream`
    (2→69%). Remaining gaps are integration-shaped — Postgres, OTEL collector,
    Docker daemon — and are itemized in `docs/METRICS.md`.

- [ ] **[CI] Publish the lcov coverage report as a CI artifact** — `npm run test:coverage` already generates lcov output locally; it is not yet uploaded anywhere CI runs.
  - Priority: P2
  - Context: split out from the coverage task above, which is complete on the coverage number itself but never covered CI publication. Depends on the CI task below actually running tests in the pipeline.
  - Acceptance Criteria: the CI workflow uploads the lcov report (e.g. as a workflow artifact or to a coverage service) on every run.

- [x] **[CI] Add unit-test step to `.github/workflows/ci.yml`** — the current CI pipeline builds the container and waits for a health check but never runs `npm run test:unit`.
  - Priority: P1
  - Context: CI currently runs pre-commit hooks and a Docker health check only. Regressions in server logic or safety layer are not caught by CI.
  - Acceptance Criteria: `npm run test:unit` (via `docker compose --profile test run --rm test`) runs in the CI job and fails the build on test failure.
  - Done (2026-09-02): `Run unit tests` step added to `.github/workflows/ci.yml`, running
    before the image build so a failing suite fails fast. Also fixed the CI `.env` setup:
    it was creating `config/.env`, which is the wrong path now that `config/docker-compose.yml`'s
    `env_file` entries were corrected to `../.env` (repo-root) — see the docker-compose
    path fix below.

### P2 - Medium

- [ ] Add a GPU-oriented model portfolio after CUDA is enabled.
  - Priority: P2
  - Context: the repo needs an explicit plan for which large and small models should live on GPU without displacing the existing CPU workflows.
  - Acceptance Criteria: selected GPU models are documented, pulled successfully, surfaced in the dashboard, and kept within VRAM limits.

- [x] Document model lifecycle and resource management APIs.
  - Priority: P2
  - Context: once GPU models are added, the system will need a documented load and unload story for reclaiming VRAM.
  - Acceptance Criteria: API design is written down and the dashboard has a defined model-management surface.

- [x] Document a production deployment path.
  - Priority: P2
  - Context: the stack is local-first today and still lacks an agreed production deployment contract.
  - Acceptance Criteria: deployment guide or prod compose path exists and secrets handling is documented.

- [x] **[Q2-CEO] MCP container manager** — design and implement a lightweight manager (container or API) that can spin up/down MCP tool containers (Playwright MCP, Jira/Confluence MCP, bb-mcp) on demand.
  - Priority: P2
  - Context: always-running MCP containers waste resources; a lifecycle manager lets agents request tools only when needed.
  - Acceptance Criteria: ✅ `config/mcp-registry.json` declarative registry; `GET/POST /api/mcp-registry/:key/ensure` JIT-starts; `POST /api/mcp-registry/:key/stop` stops; `config/docker-compose.stats.yml` opt-in override for socket access. 8 tests passing.

- [x] **[Q2-CEO] bb-mcp streaming UI** — render streaming SSE responses from bb-mcp tools in the agent-board chat/task panel with a typing indicator and incremental token display.
  - Priority: P2
  - Context: bb-mcp's server-side SSE transport is a Q2 item; this is the dashboard-side consumer. Together they complete the streaming story.
  - Acceptance Criteria: ✅ GET /api/mcp/:id/stream SSE endpoint; ToolStream React component with fade-in tokens + animated typing indicator; demo mode scripts for list_courses/get_announcements/submit_assignment; Stream button in ToolWorkbench for bb_mcp sessions; 4 passing tests.

- [x] **[Q3-CEO] Multi-persona Blackboard agent selector** — expose student, instructor, admin, and parent bb-mcp tool sets as selectable agent personas in the dashboard.
  - Priority: P2
  - Context: bb-mcp RBAC gates tools per role server-side; the dashboard needs a persona picker so the right tool set loads for the right user type.
  - Acceptance Criteria: ✅ Persona selector (Student/Instructor/Admin/Parent) in SystemPanel BLACKBOARD MCP section; switching persona reloads available tools; offline hint shown with BB_MCP_ENABLED=true instruction; tool list filtered by persona when live.

- [ ] **[Q3-CEO] Blackboard agent demo mode** — add a demo-mode preset that walks through a full Blackboard workflow (course discovery → assignment submission → grade check) using bb-mcp without a live Blackboard connection.
  - Priority: P2
  - Context: portfolio showcase requires a runnable demo; demo mode lets this work without institutional credentials.
  - Acceptance Criteria: `BB_MCP_ENABLED=true BB_MCP_DEMO=true docker compose up` runs the full demo flow; documented in README.

- [ ] **[Q3-CEO] bb-mcp tool registry panel** — display available bb-mcp tools alongside other MCP providers in the dashboard; show last invocation time and per-role availability status.
  - Priority: P2
  - Context: as the MCP container ecosystem grows, the dashboard needs a registry view so users know what tools are available and active.
  - Acceptance Criteria: a tools panel lists bb-mcp tools with status badges; clicking a tool shows its schema and last-run result.

- [x] Expand coverage after the reporting baseline is restored.
  - Priority: P2
  - Context: once coverage reporting is working, the repo still needs broader automated coverage around lifecycle, safety, and task orchestration.
  - Acceptance Criteria: at least 20 focused tests cover the core agent flows and publish coverage.

- [x] **[ARCH] Replace Docker socket mount in content-gen with MPT sidecar service**
  - Priority: P2
  - Context: content-gen currently mounts `/var/run/docker.sock` so it can dynamically start MoneyPrinterTurbo via `docker compose`. This gives the container root-equivalent access to the host Docker daemon — a significant security risk. The right pattern is MPT as a declared top-level sidecar in `docker-compose.yml` (under the `tools` profile, like `tool-content-gen`), always up when content-gen is up. Content-gen then just calls `MPT_API_URL` via HTTP — same pattern as Ollama. `ensureMptRunning()` in content-gen's server gets deleted. Longer-term: all local model services should follow the Ollama shape (HTTP API, no socket access) — LM Studio and similar tools fit this pattern too.
  - Acceptance Criteria: Docker socket volume removed from content-gen in `docker-compose.yml`; MPT runs as a first-class sidecar service; content-gen returns 503 cleanly when MPT is not in the stack; no regression in video generation flow.

### P3 - Exploratory / Deferred

- [ ] **[Deferred] Unblock NemoClaw sandbox container** — deprioritized; Ollama is the active local runtime.
  - Priority: P3
  - Context: `nemoclaw:latest` crash-loops due to CRLF line endings in entrypoint scripts (Windows build environment issue) and a stale compose command vs. current upstream image layout. No Docker Hub fallback image exists.
  - Acceptance Criteria: container runs non-crash-looping on `9000:8080`; revisit if NemoClaw becomes relevant to a specific use case.

- [ ] **[Deferred] OpenLLM / replacement custom-model endpoint** — deprioritized; Ollama + tools/ endpoints cover current needs.
  - Priority: P3
  - Context: `openllm` 0.6.30 dropped arbitrary HuggingFace repo id support; catalog-only GPU-sized serving is incompatible with the local CPU-friendly workflow. `OPENLLM_ENABLED=false` remains the default.
  - Acceptance Criteria: revisit if a lightweight CPU-compatible serving stack (llama.cpp server, text-generation-inference) becomes the right fit.

- [x] **Plugin architecture (infrastructure)** — declarative plugin manifests, loader, and API.
  - Priority: P3
  - Context: infrastructure half of the Agent skills system below.
  - Acceptance Criteria: ✅ Declarative manifests in `dashboard/config/plugins/*.plugin.json`
    (loader: `dashboard/modules/plugin-loader.js`); `GET /api/plugins`, `GET /api/plugins/tools`,
    `POST /api/plugins/reload`, `POST /api/plugins/:name/tools/:tool/invoke`,
    `POST /api/plugins/:name/events`. Registration is by file placement — no core server
    edits. Example manifest ships (disabled by default). Documented in `docs/API.md#plugins`.

- [x] **[Backlog] Agent skills system** — loadable skill modules for the dashboard agent runtime, similar in spirit to the Odysseus router integration.
  - Priority: P3
  - Context: tools/ MCP servers handle external integrations; skills would be first-class task-specific capabilities registered and invoked within the agent runtime itself.
  - Acceptance Criteria: at least one skill can be declared, loaded, and invoked from the dashboard; skills do not require modifying core server code.
  - Done (2026-09-02): the missing wiring is in. `createAgentHelpers` (`dashboard/modules/agent-tools.js`)
    now takes `pluginRegistry` and merges every enabled plugin's tools into the tool list for the
    developer/research/website experiences, exposed to the model as `<plugin>__<tool>` function-call
    names (double underscore — plugin/tool names are restricted to `[a-zA-Z0-9_-]`, so this can't
    collide with a real name; `.` is unsafe in OpenAI/Ollama function names, which is why the
    `/api/plugins` HTTP API's `plugin.tool` qualifiedName isn't reused directly here). A matching
    `<plugin>__<tool>` call routes through `callPluginTool`, which does the same HTTP invocation as
    `POST /api/plugins/:name/tools/:tool/invoke`. Plain chat / Safe Chat experiences still get zero
    tools, plugin or otherwise — enabling a plugin cannot change chat/safety behavior there.
    `example-echo` (`dashboard/config/plugins/example-echo.plugin.json`) ships disabled by default,
    so this is inert until an operator both enables a plugin and uses a tool-using experience.

- [x] Clarify MCP integration scope.
  - Priority: P3
  - Context: `docs/MCP_SETUP.md` exists, but the practical integration story is still unclear.
  - Acceptance Criteria: one documented MCP provider flow works end to end.
  - Done (2026-09-02): the integration story was never actually unclear — `docs/MCP_SETUP.md`
    was describing an unrelated concept (installing generic Claude Desktop MCP servers)
    and was archived to `docs/archive/`. The real, working MCP integration is the
    declarative `config/mcp-registry.json` registry (`GET /api/mcp-registry`,
    `POST /api/mcp-registry/:key/ensure`) plus the `bb-mcp` service and plugin
    architecture, documented end to end in `docs/API.md` (`## MCP Tool Servers`,
    `## Plugins`) with passing tests (`dashboard/tests/mcp-registry.js`,
    `dashboard/tests/plugins-api.js`).

- [ ] Validate cross-agent event bus behavior.
  - Priority: P3
  - Context: event-bus coordination is still listed as capability without a proven scenario.
  - Acceptance Criteria: two agents exchange events in a documented demo path.

- [ ] **[Follow-up] Measure Ollama memory usage under load** — replaces the rejected
  turbovec item below with something the codebase can actually act on.
  - Priority: P3
  - Context: the original "reduce LLM memory usage" goal is real, but nothing has ever
    measured where Ollama's memory actually goes (model weights vs. KV cache vs.
    concurrent-request overhead). `docker stats` on the `ollama` container during a
    sustained multi-session chat load, compared against `config/model-manifest.json`
    sizes, would show whether the real lever is fewer concurrently-loaded models,
    quantization, or context-length limits — before reaching for any new dependency.
  - Acceptance Criteria: a documented measurement (README/METRICS.md note) of Ollama
    RSS/VRAM under a defined load profile, with a recommendation on the actual lever
    to pull (if any) — no new service required to close this out.

## Rejected / Won't Do

- [x] ~~**PERFORMANCE** — setup turbovec to decrease LLM memory usage significantly.~~
  **Rejected (2026-09-02), formally closed after a second review.** turbovec is a
  Rust/Python *vector index* that compresses embeddings for RAG (~8–16x smaller
  indexes) — it does not reduce LLM inference memory, so it cannot satisfy "reduce
  per-request memory overhead" as originally written. It also has nothing to attach to:
  a repo-wide search confirms zero references to embeddings, a vector store, or any RAG
  path anywhere in `dashboard/`. Adopting it would mean building a retrieval layer that
  nothing in this product currently needs, purely to justify a Python/Rust sidecar in a
  Node stack. This was flagged as blocked on 2026-08-27 and left open pending a
  decision; the decision is: do not build it. Split into two concrete replacements
  instead of leaving this ambiguous a third time:
  1. **[Follow-up] Measure Ollama memory usage under load** (P3, above) — addresses the
     real underlying goal without a new dependency.
  2. **RAG / vector-store foundation** — moved to `ROADMAP.md` 2027 Q3 as a scoped,
     larger architectural item. turbovec is a legitimate candidate *if and when* that
     foundation gets built, not before.

## In Progress

## Done

<!--
AGENT INSTRUCTIONS:
1. Keep active items in P0-P3.
2. Move completed items to Done with [x].
3. Keep each task scannable: checkbox, short context, clear acceptance.
-->
