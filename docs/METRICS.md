# Project Metrics: agent-board

This document tracks the health, performance, and quality metrics of the `agent-board` project.

## Core Metrics

| Metric | Current | Target | Status |
| :--- | :--- | :--- | :--- |
| **Unit Test Coverage** | 59% statements / 69% branches / 72% functions (Docker run 2026-08-23: 42/48 unit tests pass; 6 fail due to external service dependencies — discover-endpoints.js, models-byok.js, session-commands.js, session-health.js, session-replay.js require a live server at localhost:3000) | >80% | 🟡 |
| **Total Test Count** | 64 test files (48 unit + 16 integration/e2e); 42 unit tests pass in Docker headless (2026-08-23) | >50 | 🟢 |
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

Current coverage baseline (Docker run 2026-08-23, c8 v8 report on 42-test partial run):
- `safety.js`: 98% statements (strongest coverage)
- `task-runner.js`: 87% statements
- `endpoint-store.js`: 90% statements
- `persistence.js`: 46% statements (down from 2026-04-03 baseline of 83% — coverage data limited by test failures)
- `server.js`: 62% statements
- `tracing.js`: 56% statements
- `session-stream.js`: 2% statements (not exercised by passing tests)
- `metrics.js`: 21% statements, `webhooks.js`: 17% statements (route modules added post-April, not yet covered)

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
*Last Updated: 2026-08-23*
