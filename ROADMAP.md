# ROADMAP

Last Updated: 2026-03-27

## 2025 Q1 - Foundation and Dashboard

- [x] Establish the repository structure, dashboard shell, and local Docker stack.
- [x] Ship the core dashboard UI and baseline model configuration.
- [ ] Finish the real-time communication bridge that early docs implied.
- [ ] Discover features from [1code](https://github.com/21st-dev/1code) and implement any relevant functionality or patterns into our stack (we're primarily focused on local models but want to see if there are useful patterns / approaches we can adopt from 1code to our design as well or include outright)

## 2025 Q2 - Persistence and Agent Control

- [ ] Implement persistence for agent history, logs, and state snapshots.
- [ ] Ship the agent command interface for start, stop, and restart actions.
- [ ] Add task queue visibility and routing.
- [ ] Add heartbeat and resource monitoring.

## 2026 Q1 - Quality Reset

- [ ] P0: Restore coverage reporting and publish a trustworthy baseline.
- [ ] P1: Audit FEATURES.md and mark shipped versus planned capabilities.
- [ ] P1: Validate safety-layer behavior with tests and examples.
- [ ] P2: Finish API documentation for lifecycle, task, and security flows.
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

## Notes

- The stack is still local-first and Docker-native.
- The immediate gap is quality and validation, not feature volume.
- GPU enablement and broader model orchestration stay behind the Q1 quality reset.

<!--
AGENT INSTRUCTIONS:
1. Keep the roadmap quarter-first.
2. Use short checkpoint bullets, not narrative paragraphs.
3. Keep task-level detail in TASKS.md.
-->