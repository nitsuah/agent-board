# GitHub Copilot Instructions

This file provides custom instructions to GitHub Copilot when working in this repository.

## Project Context

**Project Name:** agent-board
**Description:** A local-first control room for multi-model AI workflows — chat surface, safety rails, and live observability in one place.
**Tech Stack:** React, Vite, Express, JavaScript (ES modules), Node.js, PostgreSQL, WebSockets, OpenTelemetry, Docker

## Code Style & Conventions

### General Guidelines

- Follow existing code patterns and file structure
- Maintain consistent naming conventions across the codebase
- Write self-documenting code with clear variable and function names
- Add comments only when the code's intent is not immediately clear

### Language-Specific Guidelines

- **JavaScript**: Use ES modules (`import`/`export`), prefer `async`/`await` over raw promise chains
- **React**: Use functional components with hooks, avoid class components
- **Database**: Use parameterized queries, never string concatenation for SQL
- **Testing**: Write tests for all new features, aim for >80% coverage

### File Organization

- Keep files focused on a single responsibility
- Group related functionality in feature-specific directories
- Place server-side code in `dashboard/` alongside `server.js`
- Place frontend React components under `dashboard/src/`

## Architecture Patterns

### Component Structure

- Keep React components small and composable
- Extract shared logic into custom hooks
- Use composition over prop drilling

### Data Flow

- Server-side endpoints are Express REST routes
- Frontend communicates with the backend via `fetch` and WebSocket (`ws`)
- Implement proper error boundaries in React
- Handle loading states consistently

### API Design

- RESTful endpoints with consistent naming
- Validate all inputs at the API boundary
- Return appropriate HTTP status codes
- Include proper error messages and context

## Testing Strategy

- Write unit tests for utility functions and helpers
- Write integration tests for API endpoints
- Run tests with `npm test` inside the `dashboard/` directory
- Run coverage with `npm run test:coverage`
- Mock external dependencies in tests

## Security Considerations

- Never commit secrets, API keys, or credentials
- Validate and sanitize all user inputs
- Use environment variables for configuration (see `.env.example`)
- Follow OWASP security best practices

## Performance Guidelines

- Optimize database queries (use indexes, avoid N+1 queries)
- Use WebSocket events for real-time updates instead of polling
- Monitor bundle size with `npm run build`

## Documentation Requirements

- Update README.md when adding new features or changing setup
- Document complex algorithms or business logic
- Keep API documentation in sync with implementation
- Update CHANGELOG.md for notable changes

## Common Pitfalls to Avoid

- Don't use TypeScript — this project is plain JavaScript
- Don't commit `console.log` statements
- Don't hardcode configuration values — use environment variables
- Don't skip error handling
- Don't mix `async`/`await` with raw `.then()` chains

## Preferred Libraries & Tools

- **HTTP server**: Express
- **WebSockets**: `ws`
- **HTTP client (server-side)**: axios
- **Bundler**: Vite
- **Observability**: OpenTelemetry SDK + Jaeger
- **Database**: PostgreSQL via `pg`

## Closing tracked work

week-sotu and vigil read `docs/TASKS.md` from `master`, so an item left unmarked keeps showing as open work. A PR that finishes a tracked item closes it in the same PR, in this order:

1. Finish the code and tests.
2. Before the **last** push, update the docs in the same branch: mark the `docs/TASKS.md` item `- [x]` with a one-line `Done <date>: <what>` note (or record partial progress; to cite the PR number, open the PR as a draft first and add it in this commit). If the `docs/TASKS.md` footer says finished items are removed rather than ticked, remove it and condense it into `docs/CHANGELOG.md` / `docs/FEATURES.md` instead. Tick or condense the matching `docs/ROADMAP.md` line, add a `docs/CHANGELOG.md` Unreleased line, and fix `README.md` / `docs/FEATURES.md` if the change alters what they claim.
3. Commit and push, then open the PR. Say in its description which items it closes (the PR template has a slot for it).
4. **Pre-merge check**, next to CI and review threads: `git diff origin/master...HEAD --stat` must include the tracking docs whenever the PR completes a tracked item. If it doesn't, add the docs commit before merging. Never merge first and "follow up with a docs PR"; that's how stash#158/#159 and avatar#35 left finished work open (2026-09-30).

**A docs-only status PR changes status, nothing else.** When you do have to close items after the fact, touch only the lines for the items you cite (tick, `Done` note, PR link). Don't add, reword, reorder or delete other items, and don't regenerate the file from a template.

---

**Note:** These instructions help GitHub Copilot provide more relevant and consistent suggestions. Update this file as project conventions evolve.
