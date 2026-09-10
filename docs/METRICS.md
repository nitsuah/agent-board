# Project Metrics: agent-board

This document tracks the health, performance, and quality metrics of the `agent-board` project.

## Core Metrics

| Metric | Current | Target | Status |
| :--- | :--- | :--- | :--- |
| **Unit Test Coverage** | 81.53% statements / 72.68% branches / 90.39% functions (Docker run 2026-09-04, `npm run test:coverage` with NODE_V8_COVERAGE + c8; 66/66 unit tests pass, 0 failures) | >80% | 🟢 |
| **Test File Count** | 70 test files (66 unit + 4 e2e requiring a live LLM/Docker stack); 66/66 unit tests pass in Docker headless (2026-09-04) | >50 | 🟢 |
| **Critical Vulnerabilities** | 0 | 0 | 🟢 |
| **ESLint Errors** | 0 | 0 | 🟢 |
| **Avg. Cyclomatic Complexity** | TBD | <10 | ⚪ |
| **Production Bundle Size** | TBD | <500KB | ⚪ |
| **CI Build Time** | TBD | <3 mins | ⚪ |
| **CI Pipeline Success Rate** | TBD | 100% | ⚪ |
| **Outdated Dependencies** | TBD | 0 | ⚪ |
| **Lines of Code (LOC)** | TBD | N/A | ⚪ |

## Metric Definitions

*   **Unit Test Coverage:** Percentage of code branches and lines executed during test suites.
*   **Test File Count:** Number of test files run by the suite (not individual test cases/assertions within them).
*   **Critical Vulnerabilities:** High or Critical security issues reported by `npm audit`.
*   **ESLint Errors:** Number of breaking linting violations based on the local configuration.
*   **Avg. Cyclomatic Complexity:** The average number of linearly independent paths through the source code.
*   **Production Bundle Size:** The minified and gzipped size of the final JavaScript distribution.
*   **CI Build Time:** The wall-clock time from commit trigger to successful deployment/artifact.
*   **Outdated Dependencies:** Number of packages with available major updates.

## How to Update

Run the following commands to generate current values for this table:

### 1. Test Count
```bash
# Unit + integration/e2e test run inside Docker
docker compose run --rm agent-dashboard npm run test
```

### 2. Coverage
```bash
# Coverage baseline from the dashboard image
docker compose run --rm agent-dashboard npm run test:coverage
```

Current coverage baseline (Docker run 2026-09-04, `docker compose -f
config/docker-compose.yml --profile test run --rm test npm run test:coverage`,
c8 v8 report over a clean 66/66 unit run). Measured, not estimated.

**All files: 81.53% statements / 72.68% branches / 90.39% functions.**

Essentially flat versus the 2026-08-27 baseline (81.03% / 71.85% / 89.59%) —
the small gain is real test coverage added for the new plugin-tool wiring in
`agent-tools.js` (`dashboard/tests/agent-tools-unit.js`: a stub plugin
registry + a real HTTP backend exercising `getExperienceTools`'s plugin merge,
the `<plugin>__<tool>` call path, and the unknown-plugin-tool error path),
which took that file from 75.48% to 84.46% statements. No other production
code changed shape this cycle.

Strongest:
- `safety.js` 99%, `mcp-helpers.js` 100%, `logger.js` 100%
- `plugins.js` 99%, `sessions.js` 95%, `worktrees.js` 95%, `channels.js` 96%
- `plugin-loader.js` 96%, `endpoints.js` 95%, `metrics.js` 92%, `webhooks.js` 92%
- `agent-tools.js` 84% (was 75%, see above)

Remaining gaps, and why:
- `persistence.js` 46% — the uncovered half is live Postgres I/O; the no-op
  path when `DATABASE_URL` is unset is covered. Needs a database to go higher.
- `tracing.js` 56% — uncovered code is OpenTelemetry SDK wiring that only runs
  with `OTEL_ENABLED=true` and a collector endpoint.
- `docker.js` 64% — uncovered branches shell out to the Docker CLI/daemon.
- `content.js` 37% — reads generated client/artifact output directories that do
  not exist in a test container.
- `session-message.js` 43% and `session-stream.js` 69% — the remainder is
  long-running streaming and stall-timeout behavior (30s timers).
- `workspace.js` 71% — the rest is `/workspace/exec` and git push/remote paths.

These are integration-shaped rather than untested logic; raising them further
means standing up Postgres, a collector, and a Docker daemon in CI rather than
writing more unit tests.

### 3. Security Audit
```bash
npm audit
```

### 4. Code Quality & Linting
```bash
# Linting
npm run lint

# Complexity (using plato or eslint-plugin-complexity)
npx eslint . --format json
```

### 5. Bundle Size
```bash
# After build
npm run build
du -sh ./dist # or ./build
```

### 6. Dependency Freshness
```bash
npm outdated
```

### 7. Lines of Code
```bash
# Requires cloc installed
cloc . --exclude-dir=node_modules,dist
```

----
*Last Updated: 2026-09-04*
