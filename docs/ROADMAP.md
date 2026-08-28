# ROADMAP

Last Updated: 2026-08-22

## 2026 Q2 - Persistence and Agent Control

- [x] Implement persistence for agent history, logs, and state snapshots. Verify they work with tests and examples.
- [x] Ship the agent command interface for start, stop, and restart actions. Verify they work with tests and examples (1 is fine can do before chat tests).
- [x] Add heartbeat and resource monitoring so agents can report health and resource usage back to the dashboard or if models fail the system can offer the "restart" option.
- [x] Finish or investigate for further review the real-time communication bridge that early docs implied.
- [x] Discover features from [1code](https://github.com/21st-dev/1code) and evaluate relevant patterns/approaches for local stack adaptation.
- [x] **Conversation replay mode** — step-through replay of persisted agent sessions (message-by-message) for debugging decision paths, auditing tool calls, and recording portfolio demos without a live model.

## 2026 Q2 - Quality Reset

- [x] P1: Validate safety-layer behavior with tests and examples.
- [x] P2: Finish API documentation for lifecycle and security flows.
- [x] P2: Define a validated production deployment path.
- [ ] `[deferred/P3]` Unblock NemoClaw sandbox container — Ollama is the active local runtime; revisit if NemoClaw becomes relevant.
- [ ] `[deferred/P3]` Replace OpenLLM endpoint — CPU-incompatible with current workflow; Ollama + tools/ cover needs. `OPENLLM_ENABLED=false` stays.

## 2026 Q3 - Extensibility Foundations

- [ ] Add multi-tenancy (user login/sso/etc.) and RBAC planning.
- [ ] Define custom agent plugin boundaries.
- [ ] Expand audit logging and compliance support.
- [ ] Improve analytics and operational observability.
- [x] **Named pub/sub event channels** — extend the event bus into a topic-based pub/sub model where agents subscribe to named channels (e.g., `file-saved`, `build-passed`) and react asynchronously; decouples agent coordination from direct point-to-point wiring and enables reactive multi-agent pipelines.

### Custom Agent System & Safety Guardrails

### Stability, Resource Optimization & Device Profiling

- [x] **Docker image optimization**: Gated nemoclaw (`sandbox` profile) and jaeger (`observability` profile); minimal default stack is agent-db + ollama + dashboard; all profiles documented in `.env.example` and README.
- [ ] **Host architecture profiling (Phase 1)**: Profile active hardware specs (host RAM, VRAM, CPU threads, OS overhead) beyond basic laptop/desktop checks.
- [ ] **Windows host mitigation (Phase 2)**: Establish a lean baseline profile for Windows nodes to account for WSL2/Docker Desktop resource taxes.
- [x] **GPU acceleration (RTX 4080 / CUDA)**: Detect available GPU devices, pass CUDA flags to Ollama, and document driver/toolkit prerequisites.
- [x] **Just-In-Time (JIT) model lifecycle (Phase 1)**: Implement a `/tools` orchestration wrapper to dynamically spin up/down containerized model sizes on task queue demand.
- [ ] **Service lifecycle dashboard**: Control on-demand model/service execution via UI and surface real-time per-service resource tracking. API-side `docker stats` parsing is implemented (graceful no-op when socket absent); UI renders stats inline when present. Remaining: mount `/var/run/docker.sock` for in-container stats or add a host-side stats sidecar.
- [ ] **Decoupled runtimes & routing (Phase 3)**: Decouple local runner images into headless worker nodes with cross-node routing for pooled resource scheduling.
- [ ] **Model configuration matrix (Phase 3)**: Pair custom "homebrew" open-source model configs with out-of-the-box vendor images.

### Custom Agent System & Safety Guardrails

- [ ] **tmux multi-agent worktrees**: Spawn parallel agent instances in isolated tmux panes, each with distinct worktrees, contexts, and output streams.
- [ ] **Plugin architecture**: Deliver a core plugin API for task/integration-specific extensions without core codebase modification.
- [x] **BYOK external LLM integration**: Implement dashboard key management and provider interfaces for Claude, Gemini, and other APIs.
- [x] **3D LiminalDashboard home screen**: Three.js force-directed agent-board mind map; bioluminescent hub/service/endpoint/session nodes; starfield; OrbitControls; physics simulation; live system state; experience strip + persona shortcuts. Hub v2 (2026-07-02): legend/hint repositioned, stats chips removed, mobile dropdown, Llama3.2 distance fix, ServiceDetail node panel (start/stop/restart/model-pull), BYOK endpoints appear in hub + model selector, settings panel slimmed to Stack/Memory/Uptime/LLM/AddExternal/Scan.
- [ ] **Odysseus router integration (Phase 1)**: Expose a standardized local endpoint for graceful switching between OpenRouter tiers and local model pools.
- [ ] **Agent skills system**: Loadable first-class skill modules registered and invoked within the agent runtime (similar to Odysseus); skills layer on top of tools/ MCP servers for task-specific capabilities. Lowest priority — after plugin architecture and BYOK.
- [x] **Workspace file browser**: Surface a git-aware file tree with read/write directory access directly in the dashboard.
- [ ] **File & payload guardrails (Phase 2)**: Enforce confirmation prompts, pre-operation snapshots, and gateway-level payload scrubbing (PII, credentials, regex injections).
- [ ] **Schema validation (Phase 2)**: Guard model responses with structured schema enforcement (JSON/Markdown formatting filters).
- [ ] **3D Memory Palace context**: Build a 3D AI workspace using Neo4j, Graphiti, and 3D Force Graph (WebGL) to map code structures and cross-session agent memories.

### MCP Container Ecosystem

- [ ] **MCP container manager**: Spin tool containers (Playwright, Jira/Confluence, Docker Hub MCPs) up and down on demand via UI.
- [ ] **bb-mcp integration (opt-in)**: Wire bb-mcp as an optional, config-driven service in the compose stack or bind it specifically to agent/chat experiences.
- [x] **Multi-MCP orchestration**: Declarative `config/mcp-registry.json` registry — declare new MCP containers once; `GET /api/mcp-registry` lists them with live health; `POST /api/mcp-registry/:key/ensure` JIT-starts a specific container on demand. Tested.

## 2027 Q1 - Developer Experience & Quality

- [ ] **Test coverage to ≥80%**: coverage currently at 63% statements; identify and fill gaps in lifecycle, workspace, and safety paths.
- [ ] **CI unit-test gate**: add a `npm run test:unit` step to `.github/workflows/ci.yml` so coverage regressions are caught on every push.
- [x] **Content-gen Docker socket security fix**: MPT sidecar service declared in docker-compose.yml; Docker socket mount removed from content-gen; content-gen calls `MPT_API_URL` via HTTP (see TASKS.md ARCH item — complete).
- [ ] **Service lifecycle dashboard (UI completion)**: mount `/var/run/docker.sock` for in-container `docker stats` or add a host-side stats sidecar; surface per-service resource charts in the dashboard.
- [ ] **Host architecture profiling Phase 2**: Windows host lean-baseline profile accounting for WSL2/Docker Desktop overhead.
- [ ] **Authentication gate (P2)**: add an optional JWT/session auth layer so the dashboard can be safely exposed on a LAN without open-access risk.
- [ ] **Persistent BYOK endpoints**: wire `CUSTOM_LLM_ENDPOINTS` env → encrypted volume store so runtime-added endpoints survive restart without editing `.env`.

## 2027 Q2 - Blackboard & MCP Frontend

> agent-board is the UI/dashboard layer that connects to bb-mcp. Frontend and showcase concerns out of scope for the MCP server live here by improving the chat experience and feedback loops (connecting to a real LRN instance).

- [x] **bb-mcp streaming UI**: SSE endpoint `/api/mcp/:id/stream`; ToolStream React component with animated typing indicator + fade-in tokens; demo mode scripts; Stream button in ToolWorkbench; 4 passing tests.
- [x] **Multi-persona Blackboard workflows**: Student/Instructor/Admin/Parent persona picker in SystemPanel BLACKBOARD MCP section; tool list filtered by persona; offline hint guiding BB_MCP_ENABLED=true.
- [ ] **Blackboard agent demo mode**: Add an offline preset workflow (course discovery → assignment submission → grade check) utilizing bb-mcp.
- [x] **bb-mcp tool registry UI (partial)**: BLACKBOARD MCP section in SystemPanel shows tool list with name/description; Load tools button fetches from /api/mcp/blackboard-learn/tools; per-persona filtering. Remaining: status badges per tool, per-tool schema display, last-run result panel (tracked in TASKS.md as `[Q3-CEO] bb-mcp tool registry panel`).
- [ ] **Portfolio-grade showcase path**: Package the bb-mcp + agent-board integration into a documented, single-command run (`BB_MCP_ENABLED=true docker compose up`).

## 2027 Q2 - Portfolio & Ecosystem

- [ ] **Portfolio-grade Blackboard showcase**: single-command `BB_MCP_ENABLED=true docker compose up` with documented offline demo flow (course → assignment → grade).
- [ ] **MCP container manager UI**: extend the declarative `config/mcp-registry.json` registry with a dashboard panel to spin tool containers up/down on demand.
- [ ] **Plugin architecture v1**: define core plugin API; ship at least one example plugin that registers without core code changes.
- [ ] **Odysseus router integration**: expose a standardized local endpoint for switching between OpenRouter tiers and local model pools.
- [ ] **3D Memory Palace / Neo4j context**: map cross-session agent memories using Neo4j + Graphiti + 3D Force Graph (WebGL).

## Notes

- The stack remains local-first and Docker-native.
- 2027 Q1 critical path: (1) test coverage gate [content-gen socket fix ✓ done] → (2) service lifecycle UI completion → (3) auth gate → (4) persistent BYOK.
- 2027 Q2 focuses on the Blackboard showcase and broadening the MCP/plugin ecosystem once the security and quality foundation is solid.
- GPU enablement unblocks larger models and reduces memory pressure; prioritize before adding model portfolio breadth.
- MCP container manager is the gateway to broader tool ecosystem integrations without bloating the base image.

<!--
AGENT INSTRUCTIONS:
1. Keep the roadmap quarter-first.
2. Use short checkpoint bullets, not narrative paragraphs.
3. Keep task-level detail in TASKS.md.
-->
