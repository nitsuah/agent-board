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
**Context:** METRICS.md currently shows 0% coverage and 0 tests, but the dashboard package already has runnable integration tests (e.g., under `dashboard/tests` with a `dashboard/package.json` `test` script). The real gap is that coverage collection/reporting is not wired up, so METRICS.md is stale and test visibility is poor for a local-first security tool.  
**Acceptance:** The existing `npm test` (or equivalent dashboard test script) runs the current test suite with coverage enabled; METRICS.md is updated with the actual coverage value (target >80%) and test counts; CI publishes coverage reports on push

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

### GPU Acceleration Setup (NVIDIA CUDA in Ollama Docker)

**Status:** Open  
**Context:** RTX 4080 (24GB VRAM) available but unused. Current CPU models run on system RAM. Need to enable CUDA support in Ollama container to offload GPU-optimized models to VRAM, freeing RAM for existing CPU-based workflows.  
**Acceptance:**  
  1. Update `docker-compose.yml` Ollama service: use `ollama/ollama:latest` with `deploy.resources.reservations.devices` for GPU  
  2. Add environment variable `CUDA_VISIBLE_DEVICES=0` to Ollama service  
  3. Verify GPU detection: `docker exec ollama nvidia-smi` succeeds; add `/api/tags` test in dashboard health check  
  4. Document in SETUP_INSTRUCTIONS.md: prerequisite steps (Docker Desktop GPU support enabled, NVIDIA Container Toolkit installed on host)  

**Why P1:** Prerequisite for utilizing 4080. Once enabled, can pull GPU-optimized model variants that won't compete with existing CPU RAM usage.

---

## P2 — Medium

### GPU-Optimized Model Portfolio (4080-Accelerated)

**Status:** Open  
**Context:** After GPU acceleration is enabled, add complementary GPU models to 4080 VRAM (24GB). Keep existing CPU models untouched. GPU models give superior throughput/latency vs. CPU models.  
**Recommendations (GPU-resident, ~20–24GB VRAM combined):**  
  - **Primary large model for compute-heavy tasks (16–18GB VRAM):**  
    - `llama3.1-70b:q4_k_m` (38–40GB quantized) — requires dedicated GPU load; use for complex reasoning when smaller models insufficient  
    - **OR** `qwen3-32b:latest` quantized (~20GB) — sweet spot for 4080, strong across code/reason/write tasks  
  - **Secondary smaller companion (4–6GB VRAM):**  
    - `phi-3.5-mini:latest` (3.8B, ~7GB VRAM) — fast inference for lightweight tasks, frees large model for heavier work  

**Pull commands** (once GPU acceleration P1 is done):  
```powershell
# Primary
docker exec ollama ollama pull qwen3-32b:latest

# Lightweight companion
docker exec ollama ollama pull phi-3.5-mini:latest

# Optional: reserve for compute-heavy sessions
docker exec ollama ollama pull llama3.1-70b:q4_k_m
```

**Acceptance:**  
  1. Verify pulls complete and models show in `/api/tags`  
  2. Dashboard endpoint selector includes GPU models  
  3. VRAM usage stable <24GB during concurrent access (measure with `nvidia-smi`)  
  4. Document in ROADMAP.md: "CPU models (existing) + GPU models (new, 4080-resident) co-exist"  

**Effort:** 3–5 hours (model pulls + vetting, dashboard update, VRAM testing)

### Model Lifecycle & Resource Management API

**Status:** Open (Planned for P3, elevated to P2 with GPU work)  
**Context:** Eventually need endpoints to stop/start/pause models to free VRAM between inference sessions (e.g., unload Qwen3 to make room for Llama70B temporary compute).  
**Acceptance:**  
  1. Document API design: `POST /api/models/:name/load` and `POST /api/models/:name/unload`  
  2. Stub endpoints in `server.js` with Ollama `/api/generate` and process management  
  3. Add "Model Manager" UI section to dashboard (load/unload buttons per model)  

**Effort:** 4–6 hours (API design, Ollama lifecycle integration, UI)

---

## P2 (continued)

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