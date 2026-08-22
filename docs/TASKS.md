# TASKS

Last Updated: 2026-08-22

## Todo

### P1 - High

- [ ] **PERFORMANCE** — setup turbovec to decrease LLM memory usage significantly.
  - Priority: P1
  - Context: follow-up from Docker optimization pass; turbovec can reduce per-request memory overhead.
  - Acceptance Criteria: turbovec integrated and memory usage measurably reduced under load.

- [ ] **[QUALITY] Raise test coverage to ≥80%** — statement coverage is 63.41%, below the documented target.
  - Priority: P1
  - Context: 64 test files exist but coverage (2026-04-03 baseline) sits at 63% statements / 57% branches / 74% functions. Gaps are concentrated in `persistence.js` (83%), `server.js` (63%), and `tracing.js` (54%). New route modules added since April are not yet measured.
  - Acceptance Criteria: `npm run test:coverage` reports ≥80% statements; lcov report published as a CI artifact.

- [ ] **[CI] Add unit-test step to `.github/workflows/ci.yml`** — the current CI pipeline builds the container and waits for a health check but never runs `npm run test:unit`.
  - Priority: P1
  - Context: CI currently runs pre-commit hooks and a Docker health check only. Regressions in server logic or safety layer are not caught by CI.
  - Acceptance Criteria: `npm run test:unit` (via `docker compose --profile test run --rm test`) runs in the CI job and fails the build on test failure.

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

- [x] **[Q3-CEO] bb-mcp streaming UI** — render streaming SSE responses from bb-mcp tools in the motor-pool chat/task panel with a typing indicator and incremental token display.
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

- [ ] **[Backlog] Agent skills system** — loadable skill modules for the dashboard agent runtime, similar in spirit to the Odysseus router integration.
  - Priority: P3
  - Context: tools/ MCP servers handle external integrations; skills would be first-class task-specific capabilities registered and invoked within the agent runtime itself.
  - Acceptance Criteria: at least one skill can be declared, loaded, and invoked from the dashboard; skills do not require modifying core server code.

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
