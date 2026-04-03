# ROADMAP

Last Updated: 2026-04-03

## 2025 Q1 - Foundation and Dashboard

- [x] Establish the repository structure, dashboard shell, and local Docker stack.
- [x] Ship the core dashboard UI and baseline model configuration.
- [ ] Finish the real-time communication bridge that early docs implied.
- [ ] Discover features from [1code](https://github.com/21st-dev/1code) and implement any relevant functionality or patterns into our stack (we're primarily focused on local models but want to see if there are useful patterns / approaches we can adopt from 1code to our design as well or include outright)

## 2025 Q2 - Persistence and Agent Control

- [ ] Implement persistence for agent history, logs, and state snapshots.
- [ ] Ship the agent command interface for start, stop, and restart actions.
- [x] Add task queue visibility and routing.
- [x] Add webhook trigger ingestion and task creation path.
- [ ] Add heartbeat and resource monitoring.

## 2026 Q1 - Quality Reset

- [x] P0: Restore coverage reporting and publish a trustworthy baseline.
- [x] P1: Audit FEATURES.md and mark shipped versus planned capabilities.
- [ ] P1: Validate safety-layer behavior with tests and examples.
- [ ] P2: Finish API documentation for lifecycle and security flows.
- [ ] P2: Define a validated production deployment path.

## 2026 Q2 - Extensibility and Team Readiness

- [ ] Add multi-tenancy and RBAC planning.
- [ ] Define custom agent plugin boundaries.
- [ ] Expand audit logging and compliance support.
- [ ] Improve analytics and operational observability.

## Notes

- The stack is still local-first and Docker-native.
- The immediate gap is quality and validation, not feature volume.
- GPU enablement and broader model orchestration stay behind the Q1 quality reset.

<!--
AGENT INSTRUCTIONS:
1. Keep the roadmap quarter-first.
2. Use short checkpoint bullets, not narrative paragraphs.
3. Keep task-level detail in TASKS.md.
-->