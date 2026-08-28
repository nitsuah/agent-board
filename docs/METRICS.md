# Project Metrics: agent-board

This document tracks the health, performance, and quality metrics of the `agent-board` project.

## Core Metrics

| Metric | Current | Target | Status |
| :--- | :--- | :--- | :--- |
| **Unit Test Coverage** | 81.03% statements / 71.85% branches / 89.59% functions (Docker run 2026-08-27, `npm run test:unit` with NODE_V8_COVERAGE + c8; 66/66 unit tests pass, 0 failures) | >80% | 🟢 |
| **Total Test Count** | 70 test files (66 unit + 4 e2e requiring a live LLM/Docker stack); 66/66 unit tests pass in Docker headless (2026-08-27) | >50 | 🟢 |
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
*   **Total Test Count:** Total number of individual test cases (Jest/Mocha/Vitest).
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

Current coverage baseline (Docker run 2026-08-27, c8 v8 report over a clean
66/66 unit run). Measured, not estimated — the previous figures in this file
were not reproducible.

**All files: 81.03% statements / 71.85% branches / 89.59% functions.**

Two changes account for most of the movement from the 64.27% measured baseline:

1. Twelve suites that already started the app in-process were excluded from
   `test:unit` by `scripts/run-unit-tests.mjs`, so their coverage was never
   counted. Only the four suites that genuinely need a live LLM or Docker stack
   (`e2e-chat`, `e2e-agents`, `e2e-services`, `test-chat`) are excluded now.
2. Six suites hardcoded `http://localhost:3000` without starting a server and so
   always failed. They now use `tests/helpers/test-server.js`, which starts the
   app on an ephemeral port (still honoring `TEST_BASE_URL`).

Strongest:
- `safety.js` 99%, `mcp-helpers.js` 100%, `logger.js` 100%
- `plugins.js` 99%, `sessions.js` 95%, `worktrees.js` 95%, `channels.js` 96%
- `plugin-loader.js` 96%, `endpoints.js` 95%, `metrics.js` 92%, `webhooks.js` 92%

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
*Last Updated: 2026-08-27*
