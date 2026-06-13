# ROADMAP

Last Updated: 2026-06-12

## 2026 Q1 - Foundation and Dashboard ✅

> Completed. See FEATURES.md for shipped capabilities.

## 2026 Q2 - Persistence and Agent Control

- [ ] Implement persistence for agent history, logs, and state snapshots.
- [ ] Ship the agent command interface for start, stop, and restart actions.
- [ ] Add heartbeat and resource monitoring.
- [ ] Finish the real-time communication bridge that early docs implied.
- [ ] Discover features from [1code](https://github.com/21st-dev/1code) and implement any relevant functionality or patterns into our stack (we're primarily focused on local models but want to see if there are useful patterns / approaches we can adopt from 1code to our design as well or include outright)

## 2026 Q3 - Quality Reset

- [ ] P1: Validate safety-layer behavior with tests and examples.
- [ ] P2: Finish API documentation for lifecycle and security flows.
- [ ] P2: Define a validated production deployment path.
- [ ] P2: Unblock NemoClaw sandbox container (CRLF/build + stale entrypoint) and find a working
  OpenLLM or replacement custom-model endpoint (`OPENLLM_ENABLED=false` pending). See TASKS.md.

## 2026 Q4 - Extensibility Foundations

- [ ] Add multi-tenancy (user login/sso/etc.) and RBAC planning.
- [ ] Define custom agent plugin boundaries.
- [ ] Expand audit logging and compliance support.
- [ ] Improve analytics and operational observability.

## 2026 Q4 - Blackboard & MCP Frontend

> agent-board is the UI/dashboard layer that connects to bb-mcp. Frontend and showcase concerns that are out of scope for the MCP server itself live here by improving the chat experience and feedback loops enabled theirein (improvements to both the underlying mcp and model/chat/guardrails around it by connecting to a real LRN instance).

- [ ] **bb-mcp streaming UI**: Render streaming SSE responses from bb-mcp tools in the agent-board chat/task panel with a typing indicator and incremental display.
- [ ] **Multi-persona Blackboard workflows**: Surface student, instructor, admin, and parent bb-mcp tool flows as selectable agent personas; each persona loads its permitted tool set.
- [ ] **Blackboard agent demo mode**: Add a demo-mode preset that walks through an end-to-end Blackboard workflow (course discovery → assignment submission → grade check) using bb-mcp without a live Blackboard instance.
- [ ] **bb-mcp tool registry UI**: Display available bb-mcp tools alongside other MCP providers; show tool status, last invocation, and per-role availability.
- [ ] **Portfolio-grade showcase path**: Package the bb-mcp + agent-board integration as a documented, runnable demo (`BB_MCP_ENABLED=true docker compose up`) suitable for portfolio or interview demonstration.

## 2027 Q1 - Custom Agents, Stability & MCP Ecosystem

### Stability & Resource Optimization

- [ ] **Docker image optimization**: Make heavy subsystems (bb-mcp, large model pre-loads) opt-in rather than always-on; logging, metrics, and the database remain required.
- [ ] **Selective model loading**: Load only models explicitly enabled by configuration; default to a lightweight profile suitable for laptops and lower-memory environments.
- [ ] **GPU acceleration (RTX 4080 / CUDA)**: Detect available GPU devices and pass CUDA/device flags to the Ollama runtime; document driver and container-toolkit prerequisites.
- [ ] **Service lifecycle management**: On-demand start/stop for models and services from the dashboard; surface per-service resource usage and running status.

### Custom Agent System

- [ ] **tmux multi-agent worktrees**: Spawn parallel agent instances in isolated tmux panes, each with its own worktree, context, and output stream (cursor, codex, etc. can be its own panel/pane setup)
- [ ] **Plugin architecture**: Core plugin API for task-specific or integration-specific agent extensions; plugins register capabilities without modifying core code.
- [ ] **BYOK external LLM integration**: Standardized key management and provider interface to connect Claude, Gemini, and other APIs directly from the dashboard.
- [ ] **Local model bridge**: Adapter layer exposing local Ollama models to external tools; enables hybrid local/cloud agent workflows.
- [ ] **Workspace file browser**: R/W access to user-selected directories with git-aware file tree navigation surfaced in the dashboard.
- [ ] **File safety guardrails**: Require confirmation before destructive file operations; provide recovery options and pre-operation snapshots for agent-driven file work.
- [ ] **Context persistence and code memory**: Visual file structure and agentic connections, file annotations, and cross-session agent memory to reduce context loss in long-running workflows. See the Neo4js.md `/docs` for more details on this vision. But our objective is building an immersive 3D AI "Memory Palace" workspace using Neo4j, Graphiti, and 3D Force Graph (WebGL) to map code structures and cross-session agent memories into an interactive, spatial context network.

### MCP Container Ecosystem

- [ ] **MCP container manager**: Lightweight manager service to spin MCP tool containers (Playwright, Jira/Confluence, Docker Hub–sourced MCPs) up and down on demand via UI.
- [ ] **bb-mcp integration (opt-in)**: Wire bb-mcp as an optional enabled-by-config service in the compose stack. or make it specific to an agent/chat experience that can be enabled/disabled as needed.
- [ ] **Multi-MCP orchestration**: Registry pattern so new MCP containers can be declared and surfaced to agents without manual compose changes.

## Notes

- The stack is still local-first and Docker-native.
- Q3 critical path: (1) Docker optimization + GPU → (2) service lifecycle + workspace file access → (3) plugin architecture + BYOK → (4) MCP container manager.
- Q4 picks up the Blackboard frontend layer once bb-mcp has a stable MCP provider contract.
- GPU enablement unblocks larger models and reduces memory pressure; prioritize before adding more model portfolio breadth.
- MCP container manager is the gateway to broader tool ecosystem integrations without bloating the base image.

<!--
AGENT INSTRUCTIONS:
1. Keep the roadmap quarter-first.
2. Use short checkpoint bullets, not narrative paragraphs.
3. Keep task-level detail in TASKS.md.
-->
