# ROADMAP

Last Updated: 2026-06-17

## 2026 Q2 - Persistence and Agent Control

- [ ] Implement persistence for agent history, logs, and state snapshots. Verify they work with tests and examples.
- [ ] Ship the agent command interface for start, stop, and restart actions. Verify they work with tests and examples (1 is fine can do before chat tests).
- [ ] Add heartbeat and resource monitoring so agents can report health and resource usage back to the dashboard or if models fail the system can offer the "restart" option.
- [ ] Finish or investigate for further review the real-time communication bridge that early docs implied.
- [ ] Discover features from [1code](https://github.com/21st-dev/1code) and evaluate relevant patterns/approaches for local stack adaptation.
- [ ] **Conversation replay mode** — step-through replay of persisted agent sessions (message-by-message) for debugging decision paths, auditing tool calls, and recording portfolio demos without a live model.

## 2026 Q2 - Quality Reset

- [x] P1: Validate safety-layer behavior with tests and examples.
- [x] P2: Finish API documentation for lifecycle and security flows.
- [ ] P2: Define a validated production deployment path.
- [ ] `[deferred/P3]` Unblock NemoClaw sandbox container — Ollama is the active local runtime; revisit if NemoClaw becomes relevant.
- [ ] `[deferred/P3]` Replace OpenLLM endpoint — CPU-incompatible with current workflow; Ollama + tools/ cover needs. `OPENLLM_ENABLED=false` stays.

## 2026 Q3 - Extensibility Foundations

- [ ] Add multi-tenancy (user login/sso/etc.) and RBAC planning.
- [ ] Define custom agent plugin boundaries.
- [ ] Expand audit logging and compliance support.
- [ ] Improve analytics and operational observability.
- [ ] **Named pub/sub event channels** — extend the event bus into a topic-based pub/sub model where agents subscribe to named channels (e.g., `file-saved`, `build-passed`) and react asynchronously; decouples agent coordination from direct point-to-point wiring and enables reactive multi-agent pipelines.

### Custom Agent System & Safety Guardrails

### Stability, Resource Optimization & Device Profiling

- [x] **Docker image optimization**: Gated nemoclaw (`sandbox` profile) and jaeger (`observability` profile); minimal default stack is agent-db + ollama + dashboard; all profiles documented in `.env.example` and README.
- [ ] **Host architecture profiling (Phase 1)**: Profile active hardware specs (host RAM, VRAM, CPU threads, OS overhead) beyond basic laptop/desktop checks.
- [ ] **Windows host mitigation (Phase 2)**: Establish a lean baseline profile for Windows nodes to account for WSL2/Docker Desktop resource taxes.
- [x] **GPU acceleration (RTX 4080 / CUDA)**: Detect available GPU devices, pass CUDA flags to Ollama, and document driver/toolkit prerequisites.
- [ ] **Just-In-Time (JIT) model lifecycle (Phase 1)**: Implement a `/tools` orchestration wrapper to dynamically spin up/down containerized model sizes on task queue demand.
- [ ] **Service lifecycle dashboard**: Control on-demand model/service execution via UI and surface real-time per-service resource tracking.
- [ ] **Decoupled runtimes & routing (Phase 3)**: Decouple local runner images into headless worker nodes with cross-node routing for pooled resource scheduling.
- [ ] **Model configuration matrix (Phase 3)**: Pair custom "homebrew" open-source model configs with out-of-the-box vendor images.

### Custom Agent System & Safety Guardrails

- [ ] **tmux multi-agent worktrees**: Spawn parallel agent instances in isolated tmux panes, each with distinct worktrees, contexts, and output streams.
- [ ] **Plugin architecture**: Deliver a core plugin API for task/integration-specific extensions without core codebase modification.
- [ ] **BYOK external LLM integration**: Implement dashboard key management and provider interfaces for Claude, Gemini, and other APIs.
- [ ] **Odysseus router integration (Phase 1)**: Expose a standardized local endpoint for graceful switching between OpenRouter tiers and local model pools.
- [ ] **Agent skills system**: Loadable first-class skill modules registered and invoked within the agent runtime (similar to Odysseus); skills layer on top of tools/ MCP servers for task-specific capabilities. Lowest priority — after plugin architecture and BYOK.
- [x] **Workspace file browser**: Surface a git-aware file tree with read/write directory access directly in the dashboard.
- [ ] **File & payload guardrails (Phase 2)**: Enforce confirmation prompts, pre-operation snapshots, and gateway-level payload scrubbing (PII, credentials, regex injections).
- [ ] **Schema validation (Phase 2)**: Guard model responses with structured schema enforcement (JSON/Markdown formatting filters).
- [ ] **3D Memory Palace context**: Build a 3D AI workspace using Neo4j, Graphiti, and 3D Force Graph (WebGL) to map code structures and cross-session agent memories.

### MCP Container Ecosystem

- [ ] **MCP container manager**: Spin tool containers (Playwright, Jira/Confluence, Docker Hub MCPs) up and down on demand via UI.
- [ ] **bb-mcp integration (opt-in)**: Wire bb-mcp as an optional, config-driven service in the compose stack or bind it specifically to agent/chat experiences.
- [ ] **Multi-MCP orchestration**: Implement a registry pattern to declare and surface new MCP containers to agents without manual compose updates.

## 2027 Q2 - Blackboard & MCP Frontend

> agent-board is the UI/dashboard layer that connects to bb-mcp. Frontend and showcase concerns out of scope for the MCP server live here by improving the chat experience and feedback loops (connecting to a real LRN instance).

- [ ] **bb-mcp streaming UI**: Render streaming SSE responses from bb-mcp tools in the chat/task panel with typing indicators and incremental display.
- [ ] **Multi-persona Blackboard workflows**: Surface student, instructor, admin, and parent bb-mcp flows as selectable agent personas with permitted toolsets.
- [ ] **Blackboard agent demo mode**: Add an offline preset workflow (course discovery → assignment submission → grade check) utilizing bb-mcp.
- [ ] **bb-mcp tool registry UI**: Display available bb-mcp tools alongside other providers showing status, last invocation, and role availability.
- [ ] **Portfolio-grade showcase path**: Package the bb-mcp + agent-board integration into a documented, single-command run (`BB_MCP_ENABLED=true docker compose up`).

## Notes

- The stack remains local-first and Docker-native.
- 2027 Q1 critical path: (1) Docker optimization + GPU → (2) service lifecycle + workspace file access → (3) plugin architecture + BYOK → (4) MCP container manager.
- 2027 Q2 focuses heavily on the Blackboard frontend layer once bb-mcp establishes a stable MCP provider contract.
- GPU enablement unblocks larger models and reduces memory pressure; prioritize before adding model portfolio breadth.
- MCP container manager is the gateway to broader tool ecosystem integrations without bloating the base image.

<!--
AGENT INSTRUCTIONS:
1. Keep the roadmap quarter-first.
2. Use short checkpoint bullets, not narrative paragraphs.
3. Keep task-level detail in TASKS.md.
-->
