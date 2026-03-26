# Agent Board - Local AI Agent Ecosystem

Local-first AI dashboard for running multiple model experiences with session identity, safety controls, and observability built around the agent layer.

## Features

- **Multi-Model Support** - Llama2, Qwen3-Coder (Ollama), Docker Model Runner, GLM-Flash
- **Agent Sessions** - Persistent session management with full message history
- **Safety Sandbox** - NemoClaw integration for policy-enforced safe mode
- **Experience Modes** - Developer Assistant, Research Mode, and Safe Chat with server-enforced endpoint and safety rules
- **Safety Layer** - Input classification, prompt wrapping, blocked-input handling, and output sanitization for harmful or PII-bearing responses
- **Metrics Dashboard** - Summary, safety, feedback, and error telemetry with in-memory event collection
- **Web Dashboard** - React UI with live Docker status monitoring
- **Local-First** - Everything runs on your machine, no external APIs required
- **Instant Model Switching** - Switch endpoints mid-conversation per session

## Directory Structure

```
dashboard/                    # Web UI & API server (React + Express)
  src/                        # React frontend
  tests/                      # Integration tests
  Dockerfile
config/                       # Configuration (future)
llm/                          # Model configs / Modelfiles (future)
services/                     # Additional microservices (future)
scripts/                      # Setup & management scripts
docker-compose.yml            # Stack definition
```

## Quick Start

```powershell
cd C:\Users\$env:USERNAME\code\agent-board
docker compose up -d
```

**Endpoints:**
- Dashboard: http://localhost:3000
- Ollama API: http://localhost:8081
- NemoClaw: http://localhost:9000

## Models

Models are pulled into the `llm_qwen_coder` Ollama container. Currently available:

| Model | Size | Use |
|---|---|---|
| `llama2:latest` | 3.8 GB | Default — general chat, fits in RAM |
| `qwen3-coder:latest` | 18 GB | Code generation (requires ~18 GB free RAM) |
| `qwen3:latest` | 5.2 GB | General (MoE, loads as 17.7 GB at runtime) |

Pull additional models:
```powershell
docker exec llm_qwen_coder ollama pull llama3.2:latest   # 2 GB, good general model
docker exec llm_qwen_coder ollama pull qwen3:1.7b        # 1.4 GB, small but capable
```

### Docker Model Runner (optional)

Docker Desktop's built-in model runner is also wired up as an endpoint (`docker_runner`). To enable it:
1. Docker Desktop → Settings → Features in development → **Enable Docker Model Runner** + **Host-side TCP support**
2. Select "Docker Runner" in the dashboard sidebar

## API

### Sessions
- `POST /api/sessions` — Create session (`{ endpoint, model, name, userId, userRole, experience, safetyMode }`)
- `GET /api/sessions` — List all sessions
- `GET /api/sessions/:id` — Get session with messages
- `DELETE /api/sessions/:id` — Delete session
- `PUT /api/sessions/:id/model` — Switch model/endpoint (`{ endpoint, model }`)
- `POST /api/sessions/:id/feedback` — Record thumbs up/down on an assistant message (`{ messageIndex, positive }`)

### Messages
- `POST /api/sessions/:id/message` — Send message (`{ message, useSafeMode }`)

### Product Surface
- `GET /api/experiences` — List available experience configs
- `GET /api/metrics/summary` — Session/message totals, model distribution, experience distribution
- `GET /api/metrics/safety` — Input classifications, blocked prompts, filtered outputs
- `GET /api/metrics/feedback` — Positive/negative feedback by model and experience
- `GET /api/metrics/errors` — Error rate and recent failures

### System
- `GET /api/health` — Health check (LLM endpoints + Docker status)
- `GET /api/models` — Available models from all endpoints
- `GET /api/docker/status` — Container status
- `GET /api/persistence/status` — Postgres persistence status (configured/enabled)

## Architecture

```
dashboard/
├── server.js         # Express API — session mgmt, LLM proxy, Docker status
├── src/
│   ├── App.jsx       # React frontend
│   ├── App.css       # Styles
│   └── main.jsx      # Entry point
├── tests/
│   ├── test-chat.js  # Integration test (session → message → delete)
│   └── e2e-chat.js
└── Dockerfile
```

## Management Scripts

```powershell
.\scripts\stack-manager.ps1 -Action start    # Start all containers
.\scripts\stack-manager.ps1 -Action stop     # Stop all
.\scripts\stack-manager.ps1 -Action restart  # Restart all
.\scripts\stack-manager.ps1 -Action status   # Show status
.\scripts\stack-manager.ps1 -Action logs     # Tail logs
```

## Troubleshooting

**Chat returns error / LLM not responding**
- Check Ollama has models: `docker exec llm_qwen_coder ollama list`
- Check memory — large models (qwen3-coder 18 GB) need enough free RAM
- Default model is `llama2:latest` which is safe for ~8 GB+ systems

**Container unhealthy**
- `docker logs agent-dashboard` — server errors
- `docker logs llm_qwen_coder` — Ollama errors (OOM will show here)

**Port conflicts**
- Ollama: `8081` (host) → `8080` (container)
- NemoClaw: `9000` → `8080`
- Dashboard: `3000` → `3000`

## Safety & Security

- All traffic is local — no external API calls
- NemoClaw sandboxes agent execution with `--cap-drop=all`
- Capability allowlist: `NET_BIND_SERVICE` only
- `no-new-privileges` enforced on sandbox container
- Safe Chat sessions are server-restricted to the primary endpoint and strict safety mode
- Output filtering redacts detected PII and replaces blocked harmful responses before they reach the UI

## License

MIT
