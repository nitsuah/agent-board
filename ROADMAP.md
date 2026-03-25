# Roadmap

## Q1 2025 (Near Term)

- [x] Project setup and architecture
  * **Goal**: Establish a scalable foundation for the agent-board ecosystem.
  * **Rationale**: Ensure long-term maintainability and modularity.
  * **Scope**: Repository initialization, linting, and base directory structure.
  * **Success**: Clean builds and structured folder hierarchy.
  * **Risks**: Over-engineering early abstractions.
- [/] Core Dashboard UI: Build a responsive grid for agent visualization.
  * **Goal**: Provide a central interface to monitor multiple agents simultaneously.
  * **Rationale**: Users need a single pane of glass for agent status.
  * **Scope**: JavaScript-based frontend (React/Vue) with card-based layouts.
  * **Success**: Rendering 10+ agents with real-time status indicators.
  * **Risks**: UI performance bottlenecks with high update frequencies.
- [ ] Real-time Communication Bridge: Implement WebSocket connectivity.
  * **Goal**: Enable low-latency updates from agents to the board.
  * **Rationale**: Polling is inefficient for dynamic agent behavior.
  * **Scope**: Node.js WebSocket server and client-side listeners.
  * **Success**: Message delivery latency under 100ms.
  * **Risks**: Handling socket reconnections and state synchronization.

## Q2 2025 (Mid Term)

- [ ] Persistence Layer: Integrate database storage for agent history.
  * **Goal**: Save agent states, logs, and configurations across sessions.
  * **Rationale**: Prevent data loss on page refresh or server restart.
  * **Scope**: Integration with a lightweight DB (e.g., SQLite or MongoDB).
  * **Success**: Successful retrieval of agent history after a full reboot.
  * **Risks**: Database schema migrations as agent data structures evolve.
- [ ] Agent Command Interface: Enable bi-directional interaction.
  * **Goal**: Allow users to send instructions (Start/Stop/Configure) to agents.
  * **Rationale**: Moving from passive monitoring to active management.
  * **Scope**: Command API endpoints and UI action buttons.
  * **Success**: Commands executed by agents within 500ms of UI click.
  * **Risks**: Security