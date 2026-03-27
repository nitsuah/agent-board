# Tasks

## Todo

- [ ] Restore test coverage reporting — tests exist in dashboard/tests but coverage collection not wired up; METRICS.md shows 0% and is stale (target >80%) (P0)
- [ ] Dashboard/Docker initialization validation — verify all Docker endpoints respond: localhost:3000, :16686, :8081, :9000 (P1)
- [ ] Core features inventory and shipped status — audit FEATURES.md against actual code; annotate shipped/planned/exploratory (P1)
- [ ] Security safety features validation — add at least one passing test for PII redaction or harmful content filtering (P1)
- [ ] GPU acceleration setup — enable NVIDIA CUDA in Ollama Docker container for RTX 4080; update docker-compose.yml with GPU device reservation (P1)
- [ ] GPU-optimized model portfolio — pull qwen3-32b and phi-3.5-mini to 4080 VRAM after GPU setup; verify stable <24GB VRAM (P2)
- [ ] Model lifecycle and resource management API — stub POST /api/models/:name/load and /unload endpoints; add Model Manager UI section (P2)
- [ ] Public deployment setup — create docker-compose.prod.yml; document prod environment variable handling (P2)
- [ ] Agent lifecycle API documentation — document start/stop/restart endpoints with request/response examples in docs/API.md (P2)
- [ ] Test coverage expansion — implement 20+ test cases covering agent lifecycle, safety features, and task queue (P2)
- [ ] MCP (Model Context Protocol) integration — document integration story; implement 1 example integration (P3)
- [ ] Webhook trigger system — document payload format; add 1 test triggering an agent from HTTP endpoint (P3)
- [ ] Event bus and cross-agent communication — functional event system between 2+ agents in demo scenario (P3)

## In Progress

## Done

- [x] Project setup and architecture — repository initialized, docs/ organized, base structure in place
- [x] Core Dashboard UI — React-based dashboard with agent cards (card-based layout functional)
- [x] Service containerization — Docker Compose setup for Dashboard + Ollama + Jaeger + NemoClaw
- [x] Agent configuration — model support (Llama2, Qwen3-Coder, GLM-Flash)
- [x] API layer — RESTful API documented in docs/API.md
- [x] Observability stack — OpenTelemetry tracing to Jaeger, metrics dashboard placeholders
- [x] Security features — PII detection, harmful content filtering, safe mode framework
- [x] Documentation — ARCHITECTURE.md, SETUP_INSTRUCTIONS.md, API.md, DEMO_VIDEO scripts

<!--
AGENT INSTRUCTIONS:
This file tracks specific actionable tasks using a structured format.

CRITICAL FORMAT REQUIREMENTS:
1. Use EXACTLY these section names: "## Todo", "## In Progress", "## Done"
2. Tasks MUST use checkbox format: "- [ ]" for incomplete, "- [x]" for complete
3. Keep task titles on single lines`
1. Section headers must be ## (h2) level

STATUS MARKERS:
- [ ] = todo (not started)
- [/] = in-progress (actively working) - OPTIONAL, use "In Progress" section instead
- [x] = done (completed)

GOOD EXAMPLES:
## Todo
- [ ] Add user authentication
- [ ] Implement dark mode

## In Progress
- [ ] Refactor API endpoints

## Done
- [x] Set up database schema

BAD EXAMPLES (will break parser):
### Todo (wrong heading level)
* [ ] Task (wrong bullet marker)
- Task without checkbox
- [ ] Multi-line task
      with continuation (avoid this)

When updating:
1. Move tasks between sections as status changes
2. Mark completed tasks with [x] and move to "Done"
3. Add new tasks to "Todo" section
4. Keep descriptions actionable and concise
-->
