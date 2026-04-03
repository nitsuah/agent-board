# ROADMAP

Last Updated: 2026-04-03

## 2025 Q1 - Foundation and Dashboard

- [x] Establish the repository structure, dashboard shell, and local Docker stack.
- [x] Ship the core dashboard UI and baseline model configuration.
- [ ] Finish the real-time communication bridge that early docs implied.
- [ ] Discover features from [1code](https://github.com/21st-dev/1code) and implement any relevant functionality or patterns into our stack (we're primarily focused on local models but want to see if there are useful patterns / approaches we can adopt from 1code to our design as well or include outright)

## 2025 Q2 - Persistence and Agent Control

- [ ] Implement persistence for agent history, logs, and state snapshots.
- [ ] Ship the agent command interface for start, stop, and restart actions.
- [x] Add task queue visibility and routing.
- [x] Add webhook trigger ingestion and task creation path.
- [ ] Add heartbeat and resource monitoring.

## 2026 Q1 - Quality Reset

- [x] P0: Restore coverage reporting and publish a trustworthy baseline.
- [x] P1: Audit FEATURES.md and mark shipped versus planned capabilities.
- [ ] P1: Validate safety-layer behavior with tests and examples.
- [ ] P2: Finish API documentation for lifecycle and security flows.
- [ ] P2: Define a validated production deployment path.

## 2026 Q2 - Extensibility and Team Readiness

### Stability & Resource Optimization (CEO Priority)
- [ ] **Docker image optimization**: Reduce container footprint by making heavy subsystems (e.g., bb-mcp, large model pre-loads) opt-in rather than always-on. Logging, metrics, and the database must always be available.
- [ ] **Selective model loading**: Only load models explicitly enabled by configuration; default to a lightweight profile suitable for laptops and lower-memory environments.
- [ ] **GPU acceleration (RTX 4080 / CUDA)**: Detect available GPU devices and pass CUDA/device flags to the Ollama runtime so inference executes on GPU when available. Document prerequisites including driver and container-toolkit requirements.
- [ ] **File I/O and workspace access**: Add an agent capability to read and write files within a user-selected folder, enabling code authoring and git commits to local codebases via configurable workspace mounts.

### MCP Container Ecosystem (CEO Priority)
- [ ] **MCP container manager**: Introduce a lightweight manager service (or API layer) that can spin MCP tool containers up and down on demand — e.g., Playwright MCP, Jira/Confluence MCP, Docker Hub–sourced MCPs — without requiring them to run continuously.
- [ ] **bb-mcp integration (opt-in)**: Wire bb-mcp as an optional enabled-by-config service in the compose stack so agent-board agents can use Blackboard tooling when the flag is set.
- [ ] **Multi-MCP orchestration**: Design a registry pattern so new MCP containers can be declared and surfaced to agents without manual compose changes.

### Existing Items
- [ ] Add multi-tenancy and RBAC planning.
- [ ] Define custom agent plugin boundaries.
- [ ] Expand audit logging and compliance support.
- [ ] Improve analytics and operational observability.

## 2026 Q3 - Blackboard & MCP Frontend

> agent-board is the UI/dashboard layer that connects to bb-mcp. Frontend and showcase concerns that are out of scope for the MCP server itself live here.

- [ ] **bb-mcp streaming UI**: render streaming SSE responses from bb-mcp tools in the agent-board chat/task panel with a typing indicator and incremental display.
- [ ] **Multi-persona Blackboard workflows**: surface student, instructor, admin, and parent bb-mcp tool flows as selectable agent personas in the dashboard; each persona loads its permitted tool set.
- [ ] **Blackboard agent demo mode**: add a demo-mode preset that walks through an end-to-end Blackboard workflow (course discovery → assignment submission → grade check) using bb-mcp without a live Blackboard instance.
- [ ] **bb-mcp tool registry UI**: display available bb-mcp tools alongside other MCP providers; show tool status, last invocation, and per-role availability.
- [ ] **Portfolio-grade showcase path**: package the bb-mcp + agent-board integration as a documented, runnable demo (`BB_MCP_ENABLED=true docker compose up`) suitable for portfolio or interview demonstration.

## Notes

- The stack is still local-first and Docker-native.
- Q2 critical path: (1) Docker optimization + GPU → (2) file I/O + workspace access → (3) MCP container manager → (4) multi-tenancy & RBAC.
- Q3 picks up the Blackboard frontend layer once bb-mcp has a stable MCP provider contract.
- GPU enablement unblocks larger models and reduces memory pressure; prioritize before adding more model portfolio breadth.
- MCP container manager is the gateway to broader tool ecosystem integrations without bloating the base image.

<!--
AGENT INSTRUCTIONS:
1. Keep the roadmap quarter-first.
2. Use short checkpoint bullets, not narrative paragraphs.
3. Keep task-level detail in TASKS.md.
-->