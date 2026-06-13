# Features

## Core Functionality

- **Agent Lifecycle Management** - Start, stop, and restart individual agents directly from the dashboard.
- **Real-time Status Monitoring** - Live tracking of agent availability, current task, and heartbeats.
- **Task Queue Visualization** - View pending, active, blocked, and completed tasks from the dashboard sidebar.
- **Multi-Agent Coordination** - Manage and broadcast commands to multiple agents simultaneously.
- **Persistent Agent History** - Persistence is implemented and validated by integration tests.
- **Dynamic Task Assignment** - Manually or programmatically route specific tasks to available agents.

## Integrations

- **Webhook Triggers** - Initiate agent actions via incoming external HTTP requests.
- **RESTful API** - Core API endpoints are implemented and validated by integration tests.
- `[planned]` **Custom Agent Scripts** - Support for loading and executing user-defined JavaScript logic within the agent runtime.
- **Event Bus Integration** - Internal event emitter system for handling cross-agent communication.

## UI/UX

- `[planned]` **Real-time Log Streaming** - WebSocket-based terminal view for watching agent console output in real time.
- `[planned]` **Visual Connection Graph** - Graphical representation of agent relationships and data flow.
- `[planned]` **Interactive Command Terminal** - Direct CLI-style interface to send manual overrides to active agents.
- **Responsive Dashboard** - Mobile-friendly interface optimized for monitoring agents on various screen sizes.
- **Dark/Light Mode Support** - Toggleable UI themes for different working environments.

## DevOps & Infrastructure

- **Dockerized Deployment** - Pre-configured Dockerfile and Compose setups for containerized environments.
- **Environment Variable Configuration** - Flexible setup using `.env` files for secrets and system paths.
- `[planned]` **Resource Usage Monitoring** - Visual tracking of CPU and memory consumption per agent process.
- **Health Check Endpoints** - Built-in diagnostic routes for integration with uptime monitors and orchestrators.
- **Service Discovery and Panel Control** - Backend resolves primary LLM URL from a candidate list; exposes controllability metadata and gated start/stop/restart service actions; system panel surfaces discovery data and live controls.
- **bb-mcp Opt-In Integration** - `BB_MCP_ENABLED` compose profile flag gates the bb-mcp service; dashboard API hides Blackboard connectors and proxy routes when disabled, keeping the default footprint minimal.
- **OpenLLM Opt-In Endpoint** - `openllm` compose profile adds a second OpenAI-compatible endpoint (port 8082) for custom/fine-tuned HuggingFace models via BentoML, registered alongside Ollama and Docker Model Runner; gated by `OPENLLM_ENABLED`.

## Security

- `[planned]` **Secure API Key Management** - Encrypted storage and masking of sensitive credentials used by agents.
- `[planned]` **JWT Authentication** - Secure dashboard access using JSON Web Tokens for session management.
- `[planned]` **Role-Based Access Control (RBAC)** - Define permissions for viewing logs versus controlling agent states.

## Developer Experience

- `[planned]` **Modular Plugin Architecture** - Extend board functionality with custom middleware and UI components.
- `[planned]` **Hot Reloading for Scripts** - Automatically refresh agent logic when source files are modified during development.
- **Comprehensive Event Logging** - Structured JSON logging for easier debugging and integration with ELK stacks.
