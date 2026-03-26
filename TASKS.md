# Tasks

## Todo

- [ ] Deploy publicly — not just localhost (P3, L)
- [ ] Update README with product framing not just technical setup (P3, S)
- [ ] Record a 2-minute demo video (P3, S)

## In Progress

## Done

- [x] Initialize project with basic Express server and React frontend (P1, M)
- [x] Define basic project directory structure and linting rules (P1, S)
- [x] Persist EventBus events to Postgres — events table with full schema (P1, L)
- [x] Store session context in Postgres — user_id, session_id, created_at, model, endpoint (P1, M)
- [x] Add session identity — anonymous UUID on first visit via localStorage (P1, S)
- [x] Pass user context as metadata on every request (P1, S)
- [x] Build PromptWrapper middleware — system prompt prepended per experience/safety mode (P2, M)
- [x] Add input classifier — safe / sensitive / blocked categories (P2, M)
- [x] Add prompt injection detection — jailbreak patterns, role-switching attempts (P2, S)
- [x] Build blocked input response handler — graceful refusal messages (P2, S)
- [x] Add ResponseFilter — PII detection in model outputs (P2, M)
- [x] Add user-facing feedback mechanism — thumbs up/down on each response (P2, S)
- [x] Build SafetyConfig per session type — strict, standard, research (P2, S)
- [x] Build EventBus — lightweight in-memory pub/sub (P1, S)
- [x] Add event emission to every meaningful interaction point (P1, M)
- [x] Add GET /api/metrics/summary endpoint (P1, S)
- [x] Add GET /api/metrics/safety endpoint (P1, S)
- [x] Add GET /api/metrics/feedback endpoint (P1, S)
- [x] Add GET /api/metrics/errors endpoint (P1, S)
- [x] Add unit tests for EventBus and metrics API endpoints (P2, M)
- [x] Add unit tests for PromptWrapper, input classifier, and ResponseFilter (P2, M)
- [x] Consider OpenTelemetry traces on the critical path (P3, L)
- [x] Add dark mode support to the dashboard UI (P3, S)
- [x] Write a proper onboarding flow for first-time users (P2, M)
- [x] Add public demo mode — no auth required, limited to Safe Chat experience (P2, M)
- [x] Implement WebSocket connection for real-time agent log streaming (P2, L)
- [x] Add Metrics tab to React dashboard (P1, M)
- [x] Build ExperienceConfig — developer, research, safe-chat (P2, M)
- [x] Add experience selector to dashboard landing page (P2, M)
- [x] Route each experience to its own system prompt and safety profile (P2, M)
- [x] Track experience as a dimension on all metric events (P2, S)
- [x] Extend /api/health — model response times, error rates last 5 min (P2, S)

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