# TASKS

Last Updated: 2026-03-27

## Todo

### P0 - Blocking

- [ ] Restore test coverage reporting.
  - Priority: P0
  - Context: METRICS.md still reports 0% coverage even though dashboard tests exist under `dashboard/tests`.
  - Acceptance Criteria: dashboard tests run with coverage, METRICS.md reflects measured values, and CI publishes coverage results.

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

- [ ] Audit shipped versus planned features.
  - Priority: P1
  - Context: FEATURES.md lists broad capabilities without clearly separating shipped work from planned work.
  - Acceptance Criteria: FEATURES.md uses `[shipped]`, `[planned]`, and `[exploratory]` markers that match the current dashboard state.

- [ ] Verify safety layer behavior.
  - Priority: P1
  - Context: README and FEATURES.md claim PII filtering and harmful-content protections, but the behavior is not backed by visible validation.
  - Acceptance Criteria: at least one safety feature has a passing test and documented behavior example.

- [ ] Enable Ollama GPU acceleration for the RTX 4080.
  - Priority: P1
  - Context: the local stack is still CPU-bound even though the host has a 24 GB GPU available.
  - Acceptance Criteria: the Ollama service is configured for CUDA, GPU detection is validated, and setup prerequisites are documented.

### P2 - Medium

- [ ] **[Q2-CEO] MCP container manager** — design and implement a lightweight manager (container or API) that can spin up/down MCP tool containers (Playwright MCP, Jira/Confluence MCP, bb-mcp) on demand.
  - Priority: P2
  - Context: always-running MCP containers waste resources; a lifecycle manager lets agents request tools only when needed.
  - Acceptance Criteria: at least one MCP container (e.g., Playwright) can be started, used, and stopped via the manager API; compose integration documented.

- [ ] **[Q2-CEO] bb-mcp opt-in integration** — add `BB_MCP_ENABLED` env flag to compose; when set, wire bb-mcp as an available MCP provider for agents.
  - Priority: P2
  - Context: bb-mcp is a sister repo providing Blackboard/LMS tooling; agents should be able to use it without it running by default.
  - Acceptance Criteria: `BB_MCP_ENABLED=true docker compose up` starts bb-mcp alongside agent-board; agents can invoke its tools; disabled by default.

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

- [ ] Add a webhook trigger story.
  - Priority: P3
  - Context: FEATURES.md references webhooks without examples or validation.
  - Acceptance Criteria: example payloads and one tested trigger path are documented.

- [ ] Validate cross-agent event bus behavior.
  - Priority: P3
  - Context: event-bus coordination is still listed as capability without a proven scenario.
  - Acceptance Criteria: two agents exchange events in a documented demo path.

## In Progress

## Done

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
