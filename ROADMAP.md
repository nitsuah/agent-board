# Roadmap

## Q1 2025 (Near Term)

- [x] Project setup and architecture
  * **Goal**: Establish a scalable foundation for the agent-board ecosystem.
  * **Rationale**: Ensure long-term maintainability and modularity.
  * **Scope**: Repository initialization, linting, and base directory structure.
  * **Success**: Clean builds and structured folder hierarchy.
  * **Risks**: Over-engineering early abstractions.
- [x] Core Dashboard UI: Build a responsive grid for agent visualization.
  * **Goal**: Provide a central interface to monitor multiple agents simultaneously.
  * **Rationale**: Users need a single pane of glass for agent status.
  * **Scope**: JavaScript-based frontend (React/Vue) with card-based layouts.
  * **Success**: Rendering 10+ agents with real-time status indicators.
  * **Risks**: UI performance bottlenecks with high update frequencies.
- [ ] Real-time Communication Bridge: Implement WebSocket connectivity.
  * **Goal**: Enable low-latency updates from agents to the board.
  * **Rationale**: Polling is inefficient for dynamic agent behavior.
  * **Scope**: Node.js WebSocket server and client-side listeners.
  * **Note**: Not yet implemented — docs/API.md states "WebSocket Support — Not currently implemented".
  * **Success**: Message delivery latency under 100ms.
  * **Risks**: Handling socket reconnections and state synchronization.
- [x] Docker containerization: Set up Compose stack with all services.
  * **Goal**: Reproducible local environment for all contributors.
  * **Scope**: Dashboard, Ollama, Jaeger, NemoClaw endpoints.
  * **Success**: `docker compose up` starts all four services without error.

## Q2 2025 (Mid Term)

- [ ] Persistence Layer: Implement agent history, logs, and state snapshot persistence.
  * **Goal**: Save agent states, logs, and configurations across sessions.
  * **Rationale**: Prevent data loss on page refresh or server restart.
  * **Scope**: Build on existing DB infrastructure (Postgres in docker-compose.yml, /api/persistence/status endpoint); agent history and state snapshots not yet implemented.
  * **Success**: Successful retrieval of agent history after a full reboot.
  * **Risks**: Database schema migrations as agent data structures evolve.
- [ ] Agent Command Interface: Enable bi-directional interaction.
  * **Goal**: Allow users to send instructions (Start/Stop/Configure) to agents.
  * **Rationale**: Moving from passive monitoring to active management.
  * **Scope**: Command API endpoints and UI action buttons.
  * **Success**: Commands executed by agents within 500ms of UI click.
  * **Risks**: Security and concurrent command handling.
- [ ] Task Queue Management: Visualize and route pending/active/completed tasks.
  * **Goal**: Provide task lifecycle visibility across agents.
  * **Scope**: Queue UI component + routing API.
  * **Success**: Task state transitions visible in real time.
- [ ] Health Checking and Monitoring: Agent heartbeat and resource tracking.
  * **Goal**: Detect and surface unhealthy or stalled agents.
  * **Scope**: Heartbeat endpoints + CPU/memory metrics display.
  * **Success**: Unhealthy agent flagged within 30s.

## Q1 2026 (Current Quarter)

- [ ] Test coverage baseline — wire up coverage collection; METRICS.md currently shows 0% but tests already exist in dashboard/tests; target >80% with CI reporting on push.
- [ ] Feature inventory audit — annotate FEATURES.md with shipped/planned/exploratory status against actual code.
- [ ] Security validation — verify PII detection, content filtering, and safe mode with passing test cases.
- [ ] API documentation completion — fill docs/API.md gaps for agent lifecycle, task, and security endpoints.
- [ ] Docker/Kubernetes deployment — multi-node setup, load balancing, prod environment variable handling.
- [ ] GPU acceleration setup — enable NVIDIA CUDA in Ollama Docker for RTX 4080 (P1).
- [ ] GPU-optimized model portfolio — qwen3-32b + phi-3.5-mini to 4080 VRAM (P2).
- [ ] Model lifecycle and resource management API — load/unload endpoints, Model Manager UI (P2).

## Q2 2026+ (Future)

- [ ] Multi-tenancy and RBAC — org/user/role management with permission matrices.
- [ ] Custom agent plugins — extension points for user-provided agent types.
- [ ] Audit logging and compliance — full log retention, HIPAA/SOC2 preparation.
- [ ] Public deployment infrastructure — production domain, SSL/TLS, CDN, DDoS protection.
- [ ] Analytics and observability — agent performance dashboards, cost tracking, SLA monitoring.
- [ ] MCP (Model Context Protocol) integration — extended model support.
- [ ] Webhook trigger system — external event-driven agent workflows.
- [ ] Event bus for cross-agent communication and coordination.
