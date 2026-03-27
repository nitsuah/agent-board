# TASKS

**Last Updated:** 2026-03-27 | PMO audit — local-first Docker setup (no public deployment, test coverage unknown)

## Priority Key

- **P0** — Blocking (critical feature broken or unsafe)
- **P1** — High (foundational feature incomplete or untested)
- **P2** — Medium (nice-to-have, quality improvement)
- **P3** — Low (exploratory, future direction)

---

## P0 — Blocking

### Restore Test Coverage Reporting

**Status:** Open  
**Context:** METRICS.md shows 0% coverage, 0 tests — this suggests either tests don't exist or the measurement hasn't been set up. FEATURES.md lists no test counts. Since this is a local-first security tool, lack of test visibility is a gap.  
**Acceptance:** `npm test` (or equivalent) runs and reports coverage; METRICS.md shows actual value (target >80%); CI reports coverage on push

---

## P1 — High

### Dashboard/Docker Initialization Validation

**Status:** Open  
**Context:** README claims Docker endpoints (Dashboard: localhost:3000, Jaeger: 16686, Ollama: 8081, NemoClaw: 9000). No validation done that these are actually functional.  
**Acceptance:** Docker Compose up completes without error; at least 3/4 endpoints respond (health check or status page)

### Core Features Inventory & Shipped Status

**Status:** Open  
**Context:** FEATURES.md lists 25+ features but METRICS and ROADMAP don't clarify which are shipped/tested vs. aspirational. Q1 2025 roadmap is from 12+ months ago and stale.  
**Acceptance:** FEATURES.md annotated with [shipped] / [planned] / [exploratory] markers; corresponds to actual dashboard state

### Security Safety Features Validation

**Status:** Open  
**Context:** README and FEATURES.md emphasize "safety layers" (PII detection, harmful content filtering, NemoClaw integration). No test cases visible.  
**Acceptance:** At least one safety feature (e.g., PII redaction) has a passing test; behavior documented with examples

---

## P2 — Medium

### Public Deployment Setup

**Status:** Open (P3 in original TASKS)  
**Context:** Currently local-only (`localhost`). Deployment docs/infrastructure for prod not present.  
**Acceptance:** `docker-compose.prod.yml` or deployment guide created; environment variable handling for prod secrets documented

### Agent Lifecycle API Documentation

**Status:** Open  
**Context:** README claims "Start/Stop/Restart agents" and "Persistent Agent History" but no API endpoint documentation.  
**Acceptance:** `docs/API.md` lists agent lifecycle endpoints with request/response examples

### Test Coverage Setup (as P2, post-P0)

**Status:** Open  
**Context:** After P0 (restore test discovery), implement actual test suite.  
**Acceptance:** 20+ test cases covering agent lifecycle, safety features, task queue; coverage reported

---

## P3 — Low / Exploratory

### MCP (Model Context Protocol) Integration

**Status:** Open  
**Context:** `docs/MCP_SETUP.md` exists but scope unclear.  
**Acceptance:** MCP integration story documented; 1 example integration (e.g., Claude MCP provider) working

### Webhook Trigger System

**Status:** Open  
**Context:** FEATURES.md lists "Webhook Triggers" but no examples or verification.  
**Acceptance:** Example webhook payload documented; at least 1 test triggering an agent from HTTP endpoint

### Event Bus & Cross-Agent Comm

**Status:** Open  
**Context:** FEATURES.md lists "Event Bus Integration" but implementation unclear.  
**Acceptance:** Event system functional between 2+ agents in demo scenario

---

## Done

- [x] **Project setup & architecture** — repository initialized, docs/, scripts/, config/ organized
- [x] **Core Dashboard UI** — React-based dashboard with agent cards (card-based layout functional)
- [x] **Service containerization** — Docker Compose setup for Dashboard + Ollama + Jaeger + NemoClaw
- [x] **Agent configuration** — Model support (Llama2, Qwen3-Coder, GLM-Flash)
- [x] **API layer** — RESTful API documented in `docs/API.md`
- [x] **Observability stack** — OpenTelemetry tracing to Jaeger, metrics dashboard placeholders
- [x] **Security features** — PII detection, harmful content filtering, safe mode framework
- [x] **Documentation** — ARCHITECTURE.md, SETUP_INSTRUCTIONS.md, API.md, DEMO_VIDEO scripts

---

<!--
AGENT INSTRUCTIONS:
This file tracks actionable tasks.
1. Keep active items in their priority sections (P0–P3)
2. Move completed items to Done with [x]
3. Evidence source in Context field
4. Keep descriptions concise but actionable
-->