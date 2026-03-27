# TASKS

Last Updated: 2026-03-27

## P0 - Blocking

- [ ] Restore test coverage reporting.
  - Priority: P0
  - Context: METRICS.md still reports 0% coverage even though dashboard tests exist under `dashboard/tests`.
  - Acceptance Criteria: dashboard tests run with coverage, METRICS.md reflects measured values, and CI publishes coverage results.

## P1 - High

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

## P2 - Medium

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

## P3 - Exploratory

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
