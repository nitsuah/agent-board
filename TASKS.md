# Tasks

## Todo

- [ ] Implement persistent storage for agent session history (P2, L)
- [ ] Add support for multiple agent profiles and configurations (P2, M)
- [ ] Integrate OpenAI/Anthropic API for basic agent interactions (P1, M)
- [ ] Create a settings panel for managing environment variables and API keys (P2, S)
- [ ] Add unit tests for core agent communication logic (P3, M)
- [ ] Develop a CLI tool to launch the board from the terminal (P3, S)
- [ ] Implement user authentication for multi-user access (P2, L)
- [ ] Add dark mode support to the dashboard UI (P3, S)

## In Progress

## Done

- [x] Initialize project with basic Express server and React frontend (P1, M)
- [x] Define basic project directory structure and linting rules (P1, S)
- [x] Implement SSE streaming for real-time LLM response token streaming (P1, L)
- [x] Design and build agent status card component (P2, S)
- [x] Fix undefined execAsync reference in /api/system/info endpoint (P1, S)

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