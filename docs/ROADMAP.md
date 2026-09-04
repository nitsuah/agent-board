# ROADMAP

Last Updated: 2026-09-02

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

- [x] Define custom agent plugin boundaries. Resolved by the shipped plugin
  architecture below: manifests declare tools (HTTP method/endpoint/schema) and
  events (channel + allowed emit types) as the boundary — a plugin can only do what
  its manifest declares, registration is by file placement, and nothing requires a
  core server edit.
- [x] **Named pub/sub event channels** — extend the event bus into a topic-based pub/sub model where agents subscribe to named channels (e.g., `file-saved`, `build-passed`) and react asynchronously; decouples agent coordination from direct point-to-point wiring and enables reactive multi-agent pipelines.
- `[moved to 2027 Q3]` Multi-tenancy (user login/SSO) and RBAC planning — see below.
- `[moved to 2027 Q3]` Audit logging and compliance support — see below.
- `[moved to 2027 Q3]` Analytics and operational observability — see below.

### Stability, Resource Optimization & Device Profiling

- [x] **Docker image optimization**: Gated nemoclaw (`sandbox` profile) and jaeger (`observability` profile); minimal default stack is agent-db + ollama + dashboard; all profiles documented in `.env.example` and README.
- [x] **GPU acceleration (RTX 4080 / CUDA)**: Detect available GPU devices, pass CUDA flags to Ollama, and document driver/toolkit prerequisites.
- [x] **Just-In-Time (JIT) model lifecycle (Phase 1)**: Implement a `/tools` orchestration wrapper to dynamically spin up/down containerized model sizes on task queue demand.
- `[moved to 2027 Q3]` Host architecture profiling (Phase 1) and Windows host mitigation (Phase 2) — see below.
- `[moved to 2027 Q3]` Decoupled runtimes & routing (Phase 3) and model configuration matrix (Phase 3) — see below.
- `[tracked in 2027 Q1]` Service lifecycle dashboard (UI completion) — see that section; not duplicated here.

### Custom Agent System & Safety Guardrails

- [x] **tmux multi-agent worktrees**: Spawn parallel agent instances in isolated tmux windows, each with distinct worktrees, contexts, and output streams (PR #60). Execution is disabled by default (`AGENT_BOARD_ENABLE_TMUX`) and, since the route has no per-request authentication, command execution is additionally gated behind an empty-by-default exact-match `AGENT_BOARD_TMUX_ALLOWED_COMMANDS` allowlist — enabling the feature alone grants worktree creation only, not command execution.
- [x] **Plugin architecture**: Deliver a core plugin API for task/integration-specific extensions without core codebase modification (PR #60) — manifests register by file placement under `dashboard/config/plugins/`, no core edits required.
- [x] **BYOK external LLM integration**: Implement dashboard key management and provider interfaces for Claude, Gemini, and other APIs.
- [x] **3D LiminalDashboard home screen**: Three.js force-directed agent-board mind map; bioluminescent hub/service/endpoint/session nodes; starfield; OrbitControls; physics simulation; live system state; experience strip + persona shortcuts. Hub v2 (2026-07-02): legend/hint repositioned, stats chips removed, mobile dropdown, Llama3.2 distance fix, ServiceDetail node panel (start/stop/restart/model-pull), BYOK endpoints appear in hub + model selector, settings panel slimmed to Stack/Memory/Uptime/LLM/AddExternal/Scan.
- [x] **Agent skills system**: plugin tools are now merged into the model's tool list
  for developer/research/website experiences (`<plugin>__<tool>` function-call
  names), so an agent can invoke a plugin tool on its own — see `TASKS.md`.
- [x] **Workspace file browser**: Surface a git-aware file tree with read/write directory access directly in the dashboard.
- `[moved to 2027 Q3]` File & payload guardrails (Phase 2) and schema validation (Phase 2) — see below.
- `[tracked in 2027 Q2]` Odysseus router integration and 3D Memory Palace / Neo4j context — see that section; not duplicated here.

### MCP Container Ecosystem

- [x] **bb-mcp integration (opt-in)**: `bb-mcp` compose profile gates the service (`docker compose --profile bb-mcp up -d bb-mcp`, per README); dashboard hides Blackboard connectors/routes when disabled.
- [x] **Multi-MCP orchestration**: Declarative `config/mcp-registry.json` registry — declare new MCP containers once; `GET /api/mcp-registry` lists them with live health; `POST /api/mcp-registry/:key/ensure` JIT-starts a specific container on demand. Tested.
- `[tracked in 2027 Q2]` MCP container manager UI — see that section; not duplicated here.

## 2027 Q1 - Developer Experience & Quality

- [x] **Test coverage to ≥80%**: 81.03% statements / 71.85% branches / 89.59% functions (measured, PR #60) — raised from a measured 64.27% baseline by un-hiding suites wrongly excluded as "integration" and adding real coverage for MCP parsing, workspace path-traversal, agent-loop tool execution, and SSE streaming.
- [x] **CI unit-test gate**: `npm run test:unit` runs in `.github/workflows/ci.yml` before the image build so a failing suite fails CI. lcov artifact publication remains open (`TASKS.md`).
- [x] **Content-gen Docker socket security fix**: MPT sidecar service declared in docker-compose.yml; Docker socket mount removed from content-gen; content-gen calls `MPT_API_URL` via HTTP (see TASKS.md ARCH item — complete).
- [ ] **Service lifecycle dashboard (UI completion)**: mount `/var/run/docker.sock` for in-container `docker stats` or add a host-side stats sidecar; surface per-service resource charts in the dashboard.
- [ ] **Host architecture profiling Phase 2**: Windows host lean-baseline profile accounting for WSL2/Docker Desktop overhead.
- [ ] **Authentication gate (P2)**: add an optional JWT/session auth layer so the dashboard can be safely exposed on a LAN without open-access risk.
- [ ] **Scoped API token for exec-capable routes (interim, before full auth gate)**: new idea (2026-08-28) — the worktree launch/exec route and `/api/workspace/exec` both stay unauthenticated by design until the full JWT/session gate lands; a single shared-secret header check on just the exec-capable routes (not full session auth) would close the gap for LAN exposure sooner without waiting on the larger auth project.
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
- [ ] **Odysseus router integration**: expose a standardized local endpoint for switching between OpenRouter tiers and local model pools.
- [ ] **3D Memory Palace / Neo4j context**: map cross-session agent memories using Neo4j + Graphiti + 3D Force Graph (WebGL). Full design notes: `docs/archive/neo4js-memory-palace-notes.md`.

## 2027 Q3 - Platform Hardening & Scale

> New section (2026-09-02). These are 2026 Q3 "Extensibility Foundations" items that
> never had a real target — each is a genuine architectural undertaking on its own
> (new subsystem, new infra dependency, or a cross-cutting security surface), not
> something to half-ship alongside a docs pass. Writeups below instead of bare
> checkboxes so the next pass can actually scope them.

- [ ] **Multi-tenancy & RBAC (planning)**
  - *What*: user accounts (login/SSO) and role-based access control — today
    agent-board is single-user/single-host with no auth at all (see the 2027 Q1
    "Authentication gate" item, which is a prerequisite, not the same thing: auth
    proves who you are, RBAC decides what you're allowed to do once you are).
  - *Why*: every current deployment story is "one trusted operator on localhost or a
    private LAN." Multi-tenancy is what would let a team share one instance safely.
  - *Approach*: land the JWT/session auth gate first (2027 Q1). Only after that
    exists does an RBAC layer have an identity to hang permissions off; design it as
    a table of (role → allowed routes/actions) checked in middleware, not scattered
    per-route checks. Needs a decision on where user records live (new Postgres
    table vs. an external IdP) before implementation starts.

- [ ] **Audit logging & compliance support**
  - *What*: a durable, queryable record of who did what (service start/stop, model
    pulls, workspace file writes/commits, plugin tool invocations) beyond the
    existing structured JSON stdout logs.
  - *Why*: current logging is ops-facing (debugging, `docker logs`) not
    compliance-facing (a timeline for "what changed and who triggered it").
  - *Approach*: the cleanest fit is a dedicated `audit_log` Postgres table (reuse the
    existing `agent-db` — no new infra) written by a small middleware wrapper around
    the state-changing routes (workspace git ops, service actions, model pulls,
    plugin invokes) rather than instrumenting every route by hand. Depends on the
    persistence layer already being reliable (it is — `persistence.js`, 2026 Q2).

- [ ] **Analytics & operational observability**
  - *What*: aggregate usage/health trends over time (session volume, model
    distribution, error rates, safety-block rates) beyond the current point-in-time
    `/api/metrics/*` snapshots.
  - *Why*: `/api/metrics/summary|safety|feedback|errors` answer "what does it look
    like right now"; there's no history, so trends and regressions aren't visible.
  - *Approach*: OpenTelemetry is already wired for tracing (`tracing.js`, opt-in via
    `OTEL_ENABLED`) — the pragmatic path is periodic snapshots of the existing
    metrics endpoints into a time-series table (or an OTEL metrics exporter, reusing
    the same collector as tracing) rather than a new observability stack.

- [ ] **Host architecture profiling (Phase 1) & Windows host mitigation (Phase 2)**
  - *What*: profile real host specs (RAM, VRAM, CPU threads, OS overhead) beyond the
    current `minimal`/`laptop`/`desktop` device-profile tiers, and establish a lean
    baseline specifically accounting for WSL2/Docker Desktop's resource tax on
    Windows hosts.
  - *Why*: `config/device-profiles.json` and `scripts/detect-profile.ps1` already
    pick a model tier from GPU VRAM + RAM, but don't account for virtualization
    overhead, so a Windows host's *effective* budget is smaller than its raw specs
    suggest.
  - *Approach*: extend `detect-profile.ps1` to subtract a measured WSL2/Docker
    Desktop overhead constant (needs real measurement first, not a guess) before
    tier selection; Phase 2 (Windows-specific baseline) depends on Phase 1's
    measurement existing.

- [ ] **Decoupled runtimes & routing (Phase 3) + model configuration matrix (Phase 3)**
  - *What*: split local runner images into headless worker nodes with cross-node
    routing for pooled resource scheduling, plus a documented matrix pairing custom
    "homebrew" model configs with out-of-the-box vendor images.
  - *Why*: today every model runtime (Ollama, Docker Model Runner, OpenLLM) is
    single-host and single-node; this is only worth doing once there's an actual
    multi-host use case, which doesn't exist yet.
  - *Approach*: explicitly Phase 3 — depends on the device profiling work above
    landing first (you need to know a node's real capacity before you can route
    across nodes). No implementation should start before that.

- [ ] **File & payload guardrails (Phase 2) + schema validation (Phase 2)**
  - *What*: confirmation prompts and pre-operation snapshots before destructive
    workspace/tool operations, gateway-level payload scrubbing (PII, credentials,
    regex injections) beyond the existing input-side safety layer, and structured
    schema enforcement on model responses (JSON/Markdown formatting filters).
  - *Why*: `safety.js` already classifies/redacts on the way *in*; there's no
    equivalent guard on tool-call arguments or model output shape on the way *out*
    for the agentic (developer/research/website/plugin-tool) experiences.
  - *Approach*: two independent, separately-shippable pieces — (a) a
    confirmation/snapshot step in `runAgentLoop` before `bash`/`write_file`/plugin
    tool calls with side effects, (b) an optional per-experience JSON-schema
    validator on the final model response. Neither needs new infrastructure, just
    scoping and tests; smaller than the other items in this section but grouped here
    because both are security-surface work that deserves its own pass rather than
    riding along with a docs cycle.

- [ ] **RAG / vector-store foundation**
  - *What*: an actual retrieval-augmented-generation layer — embeddings, a vector
    index, and a query path that injects retrieved context into a chat/agent
    session.
  - *Why*: `TASKS.md` rejected a "turbovec for memory" item because there is
    currently zero embeddings/vector-store/RAG code anywhere in `dashboard/` for
    turbovec (or anything else) to attach to. If retrieval over the workspace,
    session history, or docs ever becomes a real product goal, this is the
    prerequisite.
  - *Approach*: not started, and shouldn't be until there's a concrete use case
    (e.g. "search past sessions," "answer from repo docs"). If it happens, turbovec
    is a legitimate candidate for the index layer given its stated compression
    ratio — evaluate it then, against whatever the actual retrieval requirements
    turn out to be.

## Notes

- The stack remains local-first and Docker-native.
- 2027 Q1 critical path: (1) test coverage gate [done] → (2) service lifecycle UI completion → (3) auth gate → (4) persistent BYOK.
- 2027 Q2 focuses on the Blackboard showcase and broadening the MCP/plugin ecosystem once the security and quality foundation is solid.
- 2027 Q3 is deliberately last: multi-tenancy/RBAC and audit logging both depend on
  the 2027 Q1 auth gate landing first; decoupled runtimes depend on the host
  profiling work in the same section landing first. Nothing in Q3 should start early.
- GPU enablement unblocks larger models and reduces memory pressure; prioritize before adding model portfolio breadth.
- MCP container manager is the gateway to broader tool ecosystem integrations without bloating the base image.

<!--
AGENT INSTRUCTIONS:
1. Keep the roadmap quarter-first.
2. Use short checkpoint bullets, not narrative paragraphs.
3. Keep task-level detail in TASKS.md.
-->
