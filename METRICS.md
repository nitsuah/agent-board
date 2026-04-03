# Project Metrics: agent-board

This document tracks the health, performance, and quality metrics of the `agent-board` project.

## Core Metrics

| Metric | Current | Target | Status |
| :--- | :--- | :--- | :--- |
| **Unit Test Coverage** | 63.41% statements / 57.05% branches / 74.07% functions / 63.41% lines | >80% | 🟡 |
| **Total Test Count** | 12 test files (9 unit + 3 integration/e2e) | >50 | 🟡 |
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
docker exec agent-dashboard sh -c "cd /app; npm run test:coverage"
```

Current coverage baseline (2026-04-03):
- `persistence.js`: 83.24% statements
- `server.js`: 62.65% statements
- `tracing.js`: 54.45% statements

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
*Last Updated: 2026-04-03*