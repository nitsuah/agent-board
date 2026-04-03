# Features

Status guide: `[shipped]` is working in the current local-first dashboard, `[in-progress]` needs further implementation or validation, and `[planned]` remains roadmap work.

> **Note:** Features marked `[shipped]` have passing integration/unit tests as of 2026-04-03.

## Core Functionality
- `[shipped]` **Agent Lifecycle Management** - Start, stop, and restart individual agents directly from the dashboard.
- `[shipped]` **Real-time Status Monitoring** - Live tracking of agent availability, current task, and heartbeats.
- `[shipped]` **Task Queue Visualization** - View pending, active, blocked, and completed tasks from the dashboard sidebar.
- `[shipped]` **Multi-Agent Coordination** - Manage and broadcast commands to multiple agents simultaneously.
- `[shipped]` **Persistent Agent History** - Persistence is implemented and validated by integration tests.
- `[shipped]` **Dynamic Task Assignment** - Manually or programmatically route specific tasks to available agents.

## Integrations
- `[shipped]` **Webhook Triggers** - Initiate agent actions via incoming external HTTP requests.
- `[shipped]` **RESTful API** - Core API endpoints are implemented and validated by integration tests.
- `[planned]` **Custom Agent Scripts** - Support for loading and executing user-defined JavaScript logic within the agent runtime.
- `[shipped]` **Event Bus Integration** - Internal event emitter system for handling cross-agent communication.

## UI/UX
- `[planned]` **Real-time Log Streaming** - WebSocket-based terminal view for watching agent console output in real time.
- `[planned]` **Visual Connection Graph** - Graphical representation of agent relationships and data flow.
- `[planned]` **Interactive Command Terminal** - Direct CLI-style interface to send manual overrides to active agents.
- `[shipped]` **Responsive Dashboard** - Mobile-friendly interface optimized for monitoring agents on various screen sizes.
- `[shipped]` **Dark/Light Mode Support** - Toggleable UI themes for different working environments.

## DevOps & Infrastructure
- `[shipped]` **Dockerized Deployment** - Pre-configured Dockerfile and Compose setups for containerized environments.
- `[shipped]` **Environment Variable Configuration** - Flexible setup using `.env` files for secrets and system paths.
- `[planned]` **Resource Usage Monitoring** - Visual tracking of CPU and memory consumption per agent process.
- `[shipped]` **Health Check Endpoints** - Built-in diagnostic routes for integration with uptime monitors and orchestrators.

## Security
- `[planned]` **Secure API Key Management** - Encrypted storage and masking of sensitive credentials used by agents.
- `[planned]` **JWT Authentication** - Secure dashboard access using JSON Web Tokens for session management.
- `[planned]` **Role-Based Access Control (RBAC)** - Define permissions for viewing logs versus controlling agent states.

## Developer Experience
- `[planned]` **Modular Plugin Architecture** - Extend board functionality with custom middleware and UI components.
- `[planned]` **Hot Reloading for Scripts** - Automatically refresh agent logic when source files are modified during development.
- `[shipped]` **Comprehensive Event Logging** - Structured JSON logging for easier debugging and integration with ELK stacks.