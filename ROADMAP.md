# 📊 Agent Board Product Roadmap

**Last Updated:** 2026-03-27 | PMO audit — Docker-containerized setup (no live public deployment), test coverage needs baseline

## Status Legend

- ✅ Done
- 🔄 In Progress / Partially Done
- 📋 Planned
- 🔭 Exploratory

---

## 2025 Q1 ✅ — Foundation & Dashboard (Completed — now 12+ months old)

- ✅ **Project setup & architecture** — Repository initialized, docs/ organized, base structure in place
- ✅ **Core Dashboard UI** — React-based grid layout with agent cards, real-time status indicators implemented
- ✅ **Real-time Communication Bridge** — WebSocket server setup (latency <100ms target)
- ✅ **Docker containerization** — Compose setup with Dashboard, Ollama, Jaeger, NemoClaw endpoints

---

## 2025 Q2 📋 — NOT STARTED (Should have been current in Dec 2025, now 3 months overdue)

**Goal:** Agent management, data persistence, foundational APIs.

- 📋 **Persistence Layer** — Database (SQLite or MongoDB) for agent history, logs, state snapshots
- 📋 **Agent Command Interface** — Start/Stop/Restart endpoints + UI buttons (sub-500ms command execution)
- 📋 **Task Queue Management** — Pending/Active/Completed task visualization and routing
- 📋 **Health Checking & Monitoring** — Agent heartbeat tracking, resource (CPU/memory) monitoring

---

## 2026 Q1 🔭 — Advanced Integration & Quality (Current Quarter — starting from scratch)

**Goal:** Move from prototype to production-ready; establish quality baseline; extend agent ecosystem.

**Critical Path:**
- **P0 — Test Coverage Baseline** — Establish CI measurement; set target (80%+); implement core test suites
- **P1 — Feature Inventory** — Audit FEATURES.md against actual implementation; mark shipped vs. planned
- **P1 — Security Validation** — Verify PII detection, content filtering, safe mode behavior with tests
- **P2 — API Documentation** — Complete `docs/API.md` with agent lifecycle, task, and security endpoints
- **P2 — Docker/K8 Deployment** — Multi-node setup; load balancing; prod environment variables

**Exploratory:**
- MCP (Model Context Protocol) integration for extended model support
- Webhook trigger system for external event-driven workflows
- Event Bus for cross-agent communication and coordination

---

## 2026 Q2+ 🔭 — Enterprise & Extensibility

**Goal:** Scale to team use; enable custom extensions; achieve production SLA.

- **Multi-tenancy & RBAC** — Org/user/role management; permission matrices
- **Custom Agent Plugins** — Extension points for user-provided agent types and behaviors
- **Audit Logging & Compliance** — Full log retention, compliance reports (HIPAA, SOC 2 preparation)
- **Public Deployment Infrastructure** — Move from localhost to production domain; SSL/TLS, CDN, DDoS protection
- **Analytics & Observability** — Agent performance dashboards, cost tracking, SLA monitoring

---

## Architecture North Star

**Philosophy:** Local-first by default, cloud-optional. Docker-native. Safety-first for AI workloads.

**Current Stack:**
- **Frontend:** React dashboard (card-based, dark/light mode, responsive)
- **Backend:** Express/Node.js (implied from docs) + WebSocket server
- **Observability:** OpenTelemetry → Jaeger tracing, metrics collection (TBD storage)
- **AI Models:** Ollama (primary), Docker Model Runner, GLM-Flash support
- **Safety:** PII detection, harmful content filtering, NemoClaw policy engine
- **Deployment:** Docker Compose (dev/local), Kubernetes-ready (future prod)

**End Goal (2027):** Enterprise-grade local-or-cloud multi-agent platform with:
- Configurable safety policies
- Full audit trails for compliance
- Team collaboration (assignments, approvals)
- Custom agent ecosystem (plugins, templates)
- Seamless cloud sync without required central dependency

---

## Known Gaps & Risks

| Area | Gap | Impact | Timeline |
|---|---|---|---|
| Test coverage | 0% baseline, no CI reporting | Quality assurance broken | P0 — immediate |
| Feature status | FEATURES.md unvetted vs. code | Users confused about capabilities | P1 — this quarter |
| Public deployment | Localhost-only, no prod readiness | Cannot be shared with teams | P2 — Q2 |
| Documentation | API.md exists but may be stale | Developers unsure of endpoints | P2 — Q1 |
| Security validation | Features listed but not proven | Safety claims unverified | P1 — this quarter |

---

## Effort Estimation

| Milestone | Estimated | Priority | Owner |
|---|---|---|---|
| P0: Test baseline & CI | 2 weeks | 🔴 Blocking | Engineering |
| P1: Feature audit | 1 week | 🔴 High | PM + QA |
| P1: Security tests | 2 weeks | 🔴 High | Security + Eng |
| P2: API docs + examples | 1 week | 🟡 Medium | Docs + Eng |
| Q2: Persistence layer | 4 weeks | 🟡 Medium | Backend |
| Q2: Public deployment | 3 weeks | 🟡 Medium | DevOps |

---

<!--
AGENT INSTRUCTIONS:
1. This roadmap reflects the actual state as of 2026-03-27 PMO audit
2. Q1 2025 items marked completed but roadmap not updated since then
3. Q2 2025 items were never started (now 3 months overdue)
4. Q1 2026 serves as reset point with realistic prioritization
5. Update quarterly with shipped/completed markers
-->