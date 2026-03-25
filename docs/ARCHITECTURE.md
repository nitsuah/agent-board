# Architecture Overview

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Browser                              │
│                  (http://localhost:3000)                    │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│           agent-dashboard (Docker Container)                │
│                   Port: 3000                                │
│         (Express.js Backend + React/Vite Frontend)          │
├─────────────────────────────────────────────────────────────┤
│  - Session management (in-memory)                           │
│  - Multi-endpoint LLM routing                               │
│  - Docker container status                                  │
│  - Safe mode integration (NemoClaw)                         │
└─┬────────────────┬────────────────────────────────────────┘
  │                │
  │           ┌────▼──────────────────────────────────────────┐
  │           │   NemoClaw (nemoclaw container)               │
  │           │   Host: 9000 → Container: 8080                │
  │           │   Policy-enforced safe mode                   │
  │           └───────────────────────────────────────────────┘
  │
  └─┬──────────────────────────────────────────────────────────┐
    │   Ollama (llm_qwen_coder container)                      │
    │   Host: 8081 → Container: 8080                           │
    │   Models: llama2:latest (default), qwen3-coder, qwen3    │
    └──────────────────────────────────────────────────────────┘

[Optional] Docker Model Runner (Docker Desktop feature)
   model-runner.docker.internal/engines/llama.cpp/v1
   OpenAI-compatible API — ai/qwen3-coder, ai/glm-4.7-flash, etc.
```

## Directory Organization

### `/dashboard/`
**Purpose:** Web UI and API server
- `Dockerfile` - Node 22 slim image with Vite build
- `server.js` - Express.js multi-endpoint API
- `package.json` - Dependencies (Express, Axios, React, Vite)
- `index.html` - HTML entry point
- `vite.config.js` - Build configuration
- `src/` - React components (frontend)
- `tests/` - Integration tests

**Responsibilities:**
- HTTP server on port 3000
- Session management (in-memory Map, CRUD operations)
- Multi-endpoint LLM routing (Ollama API + OpenAI-compatible API)
- Docker container status (`/api/docker/status`)
- Static file serving (Vite `dist/`)

### `/config/`
**Purpose:** Configuration profiles (future expansion)

### `/llm/`
**Purpose:** Ollama Modelfiles and model configs

### `/services/`
**Purpose:** Additional microservices (future expansion)

### `/scripts/`
**Purpose:** Setup and management scripts
- `setup-docker-stack.ps1` - Initial stack setup
- `stack-manager.ps1` - start/stop/restart/logs/status

### Root-level files
- `docker-compose.yml` - Stack definition
- `README.md` - Getting started
- `docs/` - Documentation

## Data Flow

### 1. User Request
```
Browser → Dashboard UI → server.js API endpoint
```

### 2. Session Creation
```
POST /api/sessions
→ Store session in memory (sessions Map)
→ Link to specific LLM endpoint
→ Return session ID
```

### 3. Message Processing
```
POST /api/sessions/:id/message
→ Retrieve session
→ Append user message to history
→ Route to Primary LLM (or NemoClaw if safe mode)
→ Append assistant response
→ return to client
```

### 4. Model Switching
```
PUT /api/sessions/:id/model
→ Update session endpoint assignment
→ Next message goes to new endpoint
→ Conversation history preserved
```

## Container Configuration

### docker-compose.yml
```
llm_qwen_coder:8080  ──→ Dashboard:3000  (host: 8081:8080)
agent-dashboard:3000              (host: 3000:3000)
nemoclaw:8080                (host: 9000:8080)
```

Note: Model switching is done by swapping the `model` field in API requests — all models run inside the single Ollama container (`llm_qwen_coder`).

## Container Networking

### Docker Network: `agent-network`
All containers on same isolated network:
- Service discovery via container names
- No external port exposure required for LLM (dashboard proxies all requests)

### Port Mapping
```
3000:3000    ← agent-dashboard (web + API)
8081:8080    ← llm_qwen_coder / Ollama (direct API access)
9000:8080    ← nemoclaw / NemoClaw (safe mode)
```

## Session Management Architecture

### In-Memory Storage
```typescript
sessions = Map<sessionId, SessionData>

SessionData {
  id: string,
  name: string,
  model: string,
  endpoint: string,
  llmUrl: string,
  messages: Array<{role, content, timestamp}>,
  createdAt: Date,
  updatedAt: Date
}
```

**Current Implementation:** In-memory Map
- Fast access
- Lost on container restart
- Suitable for development

**Future:** Persistent storage
- Database (PostgreSQL, MongoDB)
- Redis for caching
- File-based persistence

## Multi-Model Endpoint Design

### Endpoint Registry (`server.js` `LLM_CONFIG`)
```javascript
LLM_CONFIG = {
  primary:        { url: 'http://llm_qwen_coder:8080', apiStyle: 'ollama', defaultModel: 'llama2:latest' },
  qwen_coder:     { url: 'http://llm_qwen_coder:8080', apiStyle: 'ollama', defaultModel: 'qwen3-coder:latest' },
  docker_runner:  { url: 'http://model-runner.docker.internal/engines/llama.cpp/v1', apiStyle: 'openai', defaultModel: 'ai/qwen3-coder:latest' },
  glm_flash:      { url: 'http://model-runner.docker.internal/engines/llama.cpp/v1', apiStyle: 'openai', defaultModel: 'ai/glm-4.7-flash:latest' }
}
```

### API Styles
- **ollama** — `POST /api/chat`, response: `message.content`
- **openai** — `POST /v1/chat/completions`, response: `choices[0].message.content`

Both are routed transparently by server.js based on the `apiStyle` field. Sessions store which endpoint they're using, so switching mid-conversation preserves history.

## Health & Monitoring

### Health Check Endpoints
```
Dashboard    → GET http://llm_qwen_coder:8080/api/tags
Dashboard    → GET http://nemoclaw:8080/health
Docker       → healthcheck in compose file
```

### Status Endpoints
- `GET /api/health` — LLM + NemoClaw reachability
- `GET /api/docker/status` — container names and run states

## Scaling Considerations

### Horizontal Scaling
- Multiple Dashboard instances with load balancer
- Shared session store (Redis/Database)
- Multiple LLM endpoints per type

### Vertical Scaling
- Increase node memory for LLM containers
- GPU acceleration for inference
- Model quantization (GGUF format)

### Cost Optimization
- Use smaller models (GLM Flash)
- Model batching across requests
- Caching common responses

## Security Architecture

### NemoClaw Integration
- Policy-enforced execution
- OpenShell sandboxing
- Message routing for safe mode

### Network Security
- Internal Docker network isolated from host
- No direct LLM access from host (only via Dashboard)
- Cap drop & security options in compose file

### Future Improvements
- API authentication tokens
- Rate limiting per session
- Audit logging
- Input sanitization

## Performance Characteristics

### Model Latency (Approximate)
- **Qwen 3.5**: 1-3s (32B model)
- **Qwen Coder**: 2-4s (32B, code-specific)
- **GLM Flash**: 0.5-1.5s (4B, lightweight)
- **NemoClaw**: +0.5-2s overhead (policy enforcement)

### Container Resource Usage
- Dashboard: ~100MB RAM
- Qwen models: ~64GB VRAM each (A100 GPU) or ~16GB RAM (CPU)
- NemoClaw: ~200MB RAM
- Network overhead: <1% of total

### Startup Times
- Docker Hub models: ~30-60s (image pull + start)
- Legacy Ollama: 2-5min (build + model pull)
- Dashboard: ~5-10s

## Deployment Scenarios

### Development (Linux/macOS/Windows)
```
docker-compose up -d
→ All services in one compose file
→ In-memory sessions
→ Quick iteration
```

### Production (Cloud)
```
- Kubernetes orchestration
- Persistent volume for models
- Redis for session storage
- Load balancer for dashboard
- Monitoring & alerting
```

### CI/CD Integration
```
- docker-compose.test.yml for unit tests
- Docker image registry for artifacts
- Automated health checks
- Rollback procedures
```
