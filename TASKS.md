# TASKS

Last Updated: 2026-04-03

## Todo

### P1 - High

- [ ] **[Q2-CEO] Docker optimization pass** — audit compose services and model pre-loads; make all non-essential subsystems opt-in via env flags; keep logging, metrics, and DB always up.
  - Priority: P1
  - Context: CEO flagged stability issues due to container size and memory usage on laptops and low-memory hosts.
  - Acceptance Criteria: `docker compose up` succeeds with a minimal profile on a 16 GB host; optional services (bb-mcp, large models) are gated behind env flags and documented.

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

- [ ] Expand safety-layer coverage and add adversarial prompt cases.
  - Priority: P1
  - Context: baseline safety tests pass, but edge-case coverage for prompt injection and mixed-content payloads remains thin.
  - Acceptance Criteria: new test cases for prompt injection and mixed PII payloads are added and pass in Docker.

- [ ] Enable Ollama GPU acceleration for the RTX 4080.
  - Priority: P1
  - Context: the local stack is still CPU-bound even though the host has a 24 GB GPU available.
  - Acceptance Criteria: the Ollama service is configured for CUDA, GPU detection is validated, and setup prerequisites are documented.

### P2 - Medium

- [ ] **[Q2-CEO] MCP container manager** — design and implement a lightweight manager (container or API) that can spin up/down MCP tool containers (Playwright MCP, Jira/Confluence MCP, bb-mcp) on demand.
  - Priority: P2
  - Context: always-running MCP containers waste resources; a lifecycle manager lets agents request tools only when needed.
  - Acceptance Criteria: at least one MCP container (e.g., Playwright) can be started, used, and stopped via the manager API; compose integration documented.

- [x] **[Q2-CEO] bb-mcp opt-in integration** — add `BB_MCP_ENABLED` env flag to compose; when set, wire bb-mcp as an available MCP provider for agents.
  - Priority: P2
  - Context: bb-mcp is a sister repo providing Blackboard/LMS tooling; agents should be able to use it without it running by default.
  - Acceptance Criteria: `BB_MCP_ENABLED=true docker compose up` starts bb-mcp alongside agent-board; agents can invoke its tools; disabled by default.
  - Completed: 2026-04-03
  - Evidence: `docker-compose.yml` now gates `bb-mcp` behind profile `bb-mcp`; `agent-dashboard` receives `BB_MCP_ENABLED`; dashboard API hides Blackboard connectors and proxy routes when disabled.

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

- [x] Restore test coverage reporting baseline with Docker (`npm run test:coverage`) and publish measured values in METRICS.md.
- [x] Audit shipped versus planned features in FEATURES.md with explicit status markers.
- [x] Verify safety layer behavior via passing tests in `dashboard/tests/safety-layer.js`.
- [x] Add webhook trigger story with tested endpoint (`POST /api/webhooks/trigger`) and API docs.
- [x] Project setup and architecture foundation.
- [x] Core dashboard UI.
- [x] Service containerization for dashboard, Ollama, Jaeger, and NemoClaw.
- [x] Agent configuration and model support.
- [x] Initial REST API documentation in `docs/API.md`.
- [x] Observability stack wiring.
- [x] Baseline security features.
- [x] Core docs in `docs/`.

<!--
AGENT INSTRUCTIONS:
1. Keep active items in P0-P3.
2. Move completed items to Done with [x].
3. Keep each task scannable: checkbox, short context, clear acceptance.
-->
