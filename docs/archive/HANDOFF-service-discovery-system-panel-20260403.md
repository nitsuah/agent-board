# Delivery Pipeline Handoff

## Repository Context

- Repository: nitsuah/agent-board
- Default branch: master
- Working branch: feat/agent-board/service-discovery-system-panel-20260403
- PR link: (pending)
- Related issue/task: System panel service startup/restart control + endpoint discovery hardening

## Work Summary

- Title: Service discovery and system management backlayer API
- Problem statement: dashboard behavior depended on hardcoded endpoint assumptions (especially Ollama URL/port), and system panel lacked a backend API to start/restart services.
- Priority: P1
- Type: Feature / Ops
- Requested by: user feedback during DEV round

## Evidence

- Observed behavior: status checks and endpoint bindings leaned on static URLs (`PRIMARY_LLM_URL` default only), and `/api/docker/:action` always returned 501.
- Reproduction steps: system panel showed status only, no functional service controls.
- Confidence: High

## Scope

- In scope:
  - Add primary LLM endpoint discovery using candidate URL list.
  - Add service discovery catalog endpoint for system panel.
  - Add gated service control endpoint (`start|stop|restart`).
  - Update system panel UI to call service control API and show discovery context.
  - Add API regression test.
- Out of scope:
  - In-container Docker control enablement by default.
  - Full compose lifecycle orchestration UI.
- Files changed:
  - `dashboard/server.js`
  - `dashboard/src/App.jsx`
  - `dashboard/package.json`
  - `dashboard/tests/system-services.js`
  - `README.md`
  - `TASKS.md`
- Dependencies:
  - Docker CLI availability where dashboard server runs.
  - `AGENT_BOARD_ENABLE_DOCKER_CONTROL=true` for action routes.
- Constraints:
  - Must remain safe by default when Docker control is not explicitly enabled.

## Acceptance Criteria

- [x] Primary endpoint discovery checks candidate URLs instead of a single hardcoded port.
- [x] System panel receives discovery metadata via API.
- [x] System panel has actionable start/restart controls backed by API.
- [x] Service control API is explicitly gated by environment configuration.
- [x] Regression test added for system services API contract.

## Delivery/DevOps Update

- Changes made:
  - Added primary URL candidate resolver (`PRIMARY_LLM_URL_CANDIDATES`) and runtime resolution usage.
  - Added `GET /api/system/services` and `POST /api/system/services/:serviceKey/:action`.
  - Added Docker control guard (`AGENT_BOARD_ENABLE_DOCKER_CONTROL`) and compose path overrides.
  - Updated system panel UI to show resolved endpoint/candidates and invoke service actions.
  - Added `dashboard/tests/system-services.js` and wired into test scripts.
- Validation performed:
  - Docker-based `test:unit` run including new system-services test (pending run in this step).
- Remaining risks:
  - Service actions depend on Docker CLI availability in the server runtime environment.
  - If running inside a locked-down container without Docker socket/CLI, actions remain disabled by design.
- PR opened: (opening now)

## QA Update

- Scope tested: API contract + UI wiring path for system services metadata and action handlers.
- Pass/fail summary: pending final test run in this delivery step.
- Defects found: none yet.
- Release recommendation: Go with Risks (runtime Docker control depends on deployment configuration).

## PMO Follow-Up

- TASKS updates needed: done.
- ROADMAP updates needed: optional follow-up for broader service discovery manager item.
- Repo notes update needed: document host/runtime requirements for Docker control API.
- Final disposition: ready for review after validation output is attached.
