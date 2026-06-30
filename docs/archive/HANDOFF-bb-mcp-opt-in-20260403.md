# Delivery Pipeline Handoff

## Repository Context

- Repository: nitsuah/agent-board
- Default branch: master
- Working branch: feat/agent-board/bb-mcp-opt-in-20260403
- PR link: (pending)
- Related issue/task: TASKS.md — [Q2-CEO] bb-mcp opt-in integration

## Work Summary

- Title: bb-mcp opt-in integration with runtime connector gating
- Problem statement: bb-mcp was always modeled as available in dashboard connector and status surfaces, even when service should be optional. This kept Blackboard-specific checks/proxy routes effectively always-on from the app perspective.
- Priority: P2
- Type: Feature
- Requested by: Q2-CEO task set

## Evidence

- Observed behavior: `/api/connectors` always exposed `blackboard-learn` and `/api/mcp/blackboard-learn/*` routed based only on URL mapping.
- Reproduction steps: run dashboard with no bb-mcp service and call `/api/connectors`.
- Confidence: High

## Scope

- In scope:
  - Add explicit `BB_MCP_ENABLED` runtime flag handling in server APIs.
  - Gate compose service startup behind an explicit profile.
  - Add test coverage for disabled-path behavior.
  - Update README usage and TASKS status.
- Out of scope:
  - bb-mcp streaming UI and persona selector work.
  - MCP manager orchestration.
- Files changed:
  - `docker-compose.yml`
  - `dashboard/server.js`
  - `dashboard/tests/bb-mcp-opt-in.js`
  - `dashboard/package.json`
  - `README.md`
  - `TASKS.md`
- Dependencies: bb-mcp service in sibling repo remains unchanged.
- Constraints: preserve default local stack startup without bb-mcp.

## Acceptance Criteria

- [x] `BB_MCP_ENABLED` flag introduced and consumed by dashboard server.
- [x] bb-mcp service is disabled by default in compose and starts only when requested.
- [x] Blackboard connector and proxy routes are unavailable when bb-mcp is disabled.
- [x] Unit/integration test coverage added for disabled-path behavior.

## Delivery/DevOps Update

- Changes made:
  - Added compose profile `bb-mcp` for the `bb-mcp` service.
  - Added `BB_MCP_ENABLED` env passthrough to `agent-dashboard`.
  - Added runtime guards for `/bb-health`, `/api/connectors`, and `/api/mcp/:connectorId` routing.
  - Added `dashboard/tests/bb-mcp-opt-in.js` and wired into `test` and `test:unit` scripts.
  - Updated README with opt-in startup command and TASKS status evidence.
- Validation performed:
  - `npm run test:unit` from `dashboard/` (includes new bb-mcp opt-in test).
- Remaining risks:
  - Enabling `BB_MCP_ENABLED=true` without starting compose `bb-mcp` profile still yields expected health/proxy failures (by design), but operators must follow README command pair.
- PR opened: (opening now)

## QA Update

- Scope tested: API behavior with `BB_MCP_ENABLED=false`.
- Pass/fail summary: pass
- Defects found: none
- Documentation compliance findings: README now documents explicit opt-in path.
- Release recommendation: Go

## PMO Follow-Up

- TASKS updates needed: complete and keep follow-on streaming/persona tasks in backlog.
- ROADMAP updates needed: none.
- Repo notes update needed: optional mention in future Q2 status rollup.
- Final disposition: completed and ready for merge.
