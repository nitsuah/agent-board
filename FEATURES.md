# Features

## Core Functionality

- **Agent Lifecycle Management** - Start, stop, and restart individual agents, tool servers, and services directly from the dashboard via live Docker Compose CLI control.
- **Real-time Status Monitoring** - Live tracking of agent availability, current task, and heartbeats.
- **Task Queue Visualization** - View pending, active, blocked, and completed tasks from the dashboard sidebar.
- **Multi-Agent Coordination** - Manage and broadcast commands to multiple agents simultaneously.
- **Persistent Agent History** - Persistence is implemented and validated by integration tests.
- **Dynamic Task Assignment** - Manually or programmatically route specific tasks to available agents.
- **Workspace File Engine** - Host-mounted codebase access (`WORKSPACE_ROOT`) providing sandboxed file I/O browsing, editing, and staging/committing/pushing via Git controls.

## Integrations & AI Runtimes

- **Content Studio & Website Agent** - Native proxying and schema-generated UI workbench panels for local HTTP MCP tool servers.
- **Kryptos RAG Service** - Embedded Fastapi layer utilizing TurboVec semantic vector search over localized document repositories.
- **Multi-Tier Model Provisioning** - Automated hardware profile matching (`minimal`, `laptop`, `desktop`) with JIT model orchestration and custom model-runner registries.
- **Webhook Triggers** - Initiate agent actions via incoming external HTTP requests.
- **RESTful API** - Core API endpoints are implemented and validated by integration tests.
- `[planned]` **Custom Agent Scripts** - Support for loading and executing user-defined JavaScript logic within the agent runtime.
- **Event Bus Integration** - Internal event emitter system for handling cross-agent communication.

## UI/UX

- **Live Model Pull Status** - Frontend Models panel to pull, install, and stream the down-the-wire progress of Ollama and runner images over WebSockets.
- `[planned]` **Real-time Log Streaming** - WebSocket-based terminal view for watching agent console output in real time.
- `[planned]` **Visual Connection Graph** - Graphical representation of agent relationships and data flow.
- `[planned]` **Interactive Command Terminal** - Direct CLI-style interface to send manual overrides to active agents.
- **Responsive Dashboard** - Mobile-friendly interface optimized for monitoring agents on various screen sizes.
- **Dark/Light Mode Support** - Toggleable UI themes for different working environments.

## DevOps & Infrastructure

- **Dockerized Deployment** - Pre-configured Dockerfile and Compose setups for containerized environments, utilizing optimized threadpool scaling (`UV_THREADPOOL_SIZE=16`).
- **GPU Acceleration via CUDA** - Opt-in Docker Compose hardware passthrough supporting localized runtime acceleration on NVIDIA systems.
- **Ollama Startup Warmup** - Dedicated compose-level warmup orchestration layer shifting model cold-load latency overhead to stack initialization time.
- **Environment Variable Configuration** - Flexible setup using `.env` files for secrets and system paths.
- `[planned]` **Resource Usage Monitoring** - Visual tracking of CPU and memory consumption per agent process.
- **Health Check Endpoints** - Built-in diagnostic routes for integration with uptime monitors and orchestrators.
- **Service Discovery and Panel Control** - Backend resolves primary LLM URL from a candidate list; exposes controllability metadata and gated start/stop/restart service actions; system panel surfaces discovery data and live controls.
- **Live Service Lifecycle Control** - Start/Stop/Restart on the Services panel invoke live `docker compose` CLI commands (gated by `AGENT_BOARD_ENABLE_DOCKER_CONTROL` via `config/docker-compose.docker-control.yml`); inline error feedback shown per service; all tool containers (`tool-content-gen`, `tool-website`, `bb-mcp`) and core services share uniform controls.
- **Model Management** - Dashboard Models panel shows pull status and streams live progress for each configured LLM endpoint (`ollama pull` streamed over `/ws/events`, `docker model pull` for Docker Model Runner); primary Ollama model is env-configurable via `PRIMARY_LLM_MODEL` (default: `llama3.2:3b`); opt-in `ollama-warmup` service (profile `warmup`) pre-loads the model at `docker compose up` time to eliminate cold-start latency.
- **Device Profile System** - Auto-detects host hardware (GPU VRAM + total RAM) at startup and selects a model tier: `minimal` (CPU-only), `laptop` (RTX 3070 / 8 GB VRAM), or `desktop` (RTX 4080 / 24 GB VRAM); profiles defined in `config/device-profiles.json`; overridable via `DEVICE_PROFILE`; active profile and GPU status shown in the System panel.
- **bb-mcp Opt-In Integration** - `BB_MCP_ENABLED` compose profile flag gates the bb-mcp service; dashboard API hides Blackboard connectors and proxy routes when disabled, keeping the default footprint minimal.
- **OpenLLM Opt-In Endpoint** - `openllm` compose profile adds a second OpenAI-compatible endpoint (port 8082) for custom/fine-tuned HuggingFace models via BentoML, registered alongside Ollama and Docker Model Runner; gated by `OPENLLM_ENABLED`.

## Security & Verification

- **Sanitized Gateway Proxy** - Pre-flight interceptor normalization layer (`normalizeForMatching`) stripping zero-width evasions and formatting manipulation to sanitize multi-type PII and prompt injections.
- `[planned]` **Secure API Key Management** - Encrypted storage and masking of sensitive credentials used by agents.
- `[planned]` **JWT Authentication** - Secure dashboard access using JSON Web Tokens for session management.
- `[planned]` **Role-Based Access Control (RBAC)** - Define permissions for viewing logs versus controlling agent states.

## Developer Experience

- `[planned]` **Modular Plugin Architecture** - Extend board functionality with custom middleware and UI components.
- `[planned]` **Hot Reloading for Scripts** - Automatically refresh agent logic when source files are modified during development.
- **Comprehensive Event Logging** - Structured JSON logging for easier debugging and integration with ELK stacks.