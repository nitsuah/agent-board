# GitHub Copilot Instructions

This file provides custom instructions to GitHub Copilot when working in this repository.

## Project Context

**Project Name:** [Your Project Name]  
**Description:** [Brief description of what this project does]  
**Tech Stack:** [e.g., Next.js, TypeScript, PostgreSQL, etc.]

## Code Style & Conventions

### General Guidelines

- Follow existing code patterns and file structure
- Maintain consistent naming conventions across the codebase
- Write self-documenting code with clear variable and function names
- Add comments only when the code's intent is not immediately clear

### Language-Specific Guidelines

- **TypeScript**: Use strict mode, prefer interfaces over types for object shapes
- **React**: Use functional components with hooks, avoid class components
- **Database**: Use parameterized queries, never string concatenation for SQL
- **Testing**: Write tests for all new features, aim for >80% coverage

### File Organization

- Keep files focused on a single responsibility
- Use index files for barrel exports where appropriate
- Place types in dedicated `types/` directory or co-located with implementation
- Group related functionality in feature-specific directories

## Architecture Patterns

### Component Structure

- Follow atomic design principles (atoms, molecules, organisms)
- Keep components small and composable
- Extract shared logic into custom hooks
- Use composition over prop drilling

### Data Flow

- Use server components for data fetching when possible
- Implement proper error boundaries
- Handle loading states consistently
- Use optimistic updates for better UX

### API Design

- RESTful endpoints with consistent naming
- Validate all inputs at the API boundary
- Return appropriate HTTP status codes
- Include proper error messages and context

## Testing Strategy

- Write unit tests for utility functions and helpers
- Write integration tests for API endpoints
- Write E2E tests for critical user flows
- Mock external dependencies in tests

## Security Considerations

- Never commit secrets, API keys, or credentials
- Validate and sanitize all user inputs
- Use environment variables for configuration
- Implement proper authentication and authorization
- Follow OWASP security best practices

## Performance Guidelines

- Optimize database queries (use indexes, avoid N+1 queries)
- Implement proper caching strategies
- Use code splitting and lazy loading
- Optimize images and assets
- Monitor bundle size and runtime performance

## Documentation Requirements

- Update README.md when adding new features or changing setup
- Document complex algorithms or business logic
- Keep API documentation in sync with implementation
- Update CHANGELOG.md for notable changes

## Common Pitfalls to Avoid

- Don't use `any` type in TypeScript
- Don't bypass TypeScript errors with `@ts-ignore`
- Don't commit console.log statements
- Don't hardcode configuration values
- Don't skip error handling
- Don't mix async/await with promise chains

## Preferred Libraries & Tools

- [List your preferred libraries for common tasks]
- [Include reasoning for why certain libraries are preferred]

## Additional Context

- [Any project-specific quirks or special considerations]
- [Links to relevant documentation or ADRs]
- [Team conventions or preferences]

---

**Note:** These instructions help GitHub Copilot provide more relevant and consistent suggestions. Update this file as project conventions evolve.
