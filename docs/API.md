# API Documentation

Complete REST API reference for the Agent Dashboard.

## Base URL

```
http://localhost:3000/api
```

## Authentication

No authentication required in the current release.

## Common Response Format

### Success
```json
{ "success": true, "data": { } }
```

### Error
```json
{ "success": false, "error": "Error message" }
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 202 | Accepted (async operation started) |
| 400 | Bad request / invalid parameters |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate feedback) |
| 501 | Feature disabled (e.g. Docker control off) |
| 502 | Upstream service error |
| 500 | Internal server error |

---

## Sessions

### Create Session

```
POST /api/sessions
Content-Type: application/json
```

**Body**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `endpoint` | string | | `"primary"` | LLM endpoint key (`primary`, `docker_runner`, `glm_flash`, `openllm`) |
| `model` | string | | endpoint default | Model name; coerced to a valid model for the endpoint if needed |
| `name` | string | | `"session-N"` | Human-readable label |
| `userId` | string | | `"anonymous"` | Caller identity |
| `userRole` | string | | `null` | Caller role (passed to safety layer) |
| `experience` | string | | `"developer"` | Experience key — see `GET /api/experiences` |
| `safetyMode` | string | | experience default | Safety policy override (`strict`, `standard`, `off`) |

**Response**
```json
{
  "success": true,
  "session": {
    "id": "sess_1710864000000_abc123xyz",
    "name": "session-1",
    "model": "llama3.2:3b",
    "endpoint": "primary",
    "experience": "developer",
    "safetyMode": "standard",
    "endpointAdjusted": false,
    "createdAt": "2026-03-19T10:00:00.000Z"
  }
}
```

`endpointAdjusted: true` means the requested endpoint was overridden by the experience's policy (e.g. `safe_chat` always uses `primary`).

**Errors:** 400 invalid experience, 400 invalid safetyMode

---

### List Sessions

```
GET /api/sessions
```

```json
{
  "success": true,
  "sessions": [
    {
      "id": "sess_1710864000000_abc123xyz",
      "name": "session-1",
      "model": "llama3.2:3b",
      "endpoint": "primary",
      "messageCount": 5,
      "experience": "developer",
      "safetyMode": "standard",
      "userId": "anonymous",
      "createdAt": "2026-03-19T10:00:00.000Z",
      "updatedAt": "2026-03-19T10:05:00.000Z"
    }
  ]
}
```

---

### Get Session

```
GET /api/sessions/:id
```

Returns the session object plus full `messages` array. Each message:

```json
{
  "role": "user",
  "content": "What is 2+2?",
  "timestamp": "2026-03-19T10:00:05.000Z"
}
```

Assistant messages may also have `feedback: "up" | "down"` and `feedbackAt`.

**Errors:** 404 session not found

---

### Send Message

```
POST /api/sessions/:id/message
Content-Type: application/json
```

**Body**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `message` | string | ✅ | | User message |
| `useSafeMode` | boolean | | `false` | Route through NemoClaw sandbox (requires `sandbox` profile) |

**Response**
```json
{
  "success": true,
  "response": "AI response text",
  "endpoint": "primary",
  "messageCount": 2
}
```

**Errors:** 400 missing message, 404 session not found, 500 LLM unavailable

---

### Stream Message

```
POST /api/sessions/:id/stream
Content-Type: application/json
```

Same body as Send Message. Response is `text/event-stream` (SSE); each `data:` line is a token chunk. Final event is `data: [DONE]`.

---

### Switch Endpoint / Model

```
PUT /api/sessions/:id/model
Content-Type: application/json
```

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endpoint` | string | ✅ | Endpoint key |
| `model` | string | | Model name (defaults to endpoint's configured model) |

**Response**
```json
{
  "success": true,
  "message": "Switched to primary",
  "session": {
    "endpoint": "primary",
    "model": "llama3.2:3b",
    "llmUrl": "http://ollama:8080"
  }
}
```

Conversation history is preserved. **Errors:** 400 invalid endpoint

---

### Record Feedback

```
POST /api/sessions/:id/feedback
Content-Type: application/json
```

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messageIndex` | integer | ✅ | Zero-based index into the session's messages array |
| `positive` | boolean | ✅ | `true` = thumbs up, `false` = thumbs down |

**Response**
```json
{ "success": true, "recorded": "feedback_positive" }
```

**Errors:** 400 missing/invalid fields, 404 session not found, 409 feedback already recorded

---

### Delete Session

```
DELETE /api/sessions/:id
```

```json
{ "success": true, "deleted": true }
```

Sessions are in-memory; they are lost on server restart. `deleted: false` if the session didn't exist.

---

## System & Service Lifecycle

### List Services

```
GET /api/system/services
```

Returns the service registry with live health probes for each service.

```json
{
  "success": true,
  "dockerControlEnabled": false,
  "inDocker": true,
  "services": {
    "ollama": {
      "key": "ollama",
      "name": "Ollama",
      "running": true,
      "status": "healthy",
      "resolvedUrl": "http://ollama:8080",
      "controllable": true,
      "composeService": "ollama"
    },
    "bb_mcp": {
      "key": "bb_mcp",
      "name": "Blackboard MCP",
      "running": false,
      "status": "disabled",
      "resolvedUrl": null,
      "controllable": false,
      "disabledReason": "BB_MCP_ENABLED is false"
    }
  },
  "primaryLlm": {
    "resolvedUrl": "http://ollama:8080",
    "discovered": false,
    "candidates": ["http://ollama:8080", "http://host.docker.internal:8081"]
  }
}
```

`status` is one of `healthy`, `unavailable`, or `disabled`.

`controllable: true` means the service responds to start/stop/restart (also requires `dockerControlEnabled`).

---

### Service Action (start / stop / restart)

```
POST /api/system/services/:serviceKey/:action
```

`:action` must be `start`, `stop`, or `restart`.

Requires `AGENT_BOARD_ENABLE_DOCKER_CONTROL=true` — see [docker-control overlay](../README.md#docker-control--model-pulls-opt-in).

**Response**
```json
{
  "success": true,
  "serviceKey": "ollama",
  "action": "restart",
  "result": "Container agent-ollama restarting..."
}
```

**Errors:** 400 invalid action, 400 service not controllable, 404 unknown serviceKey, 501 Docker control disabled

---

### System Info

```
GET /api/system/info
```

```json
{
  "success": true,
  "system": {
    "platform": "linux",
    "nodeVersion": "v22.0.0",
    "uptime": 3600,
    "memory": { "rss": 12345678, "heapUsed": 9876543 },
    "inDocker": true,
    "environment": {
      "port": 3000,
      "llmEndpoints": ["primary", "docker_runner", "glm_flash"],
      "dockerControlEnabled": false,
      "persistence": { "configured": true, "enabled": true },
      "tracing": { "enabled": false }
    }
  }
}
```

---

## Models

### List Models

```
GET /api/models
```

Aggregates available models from all configured LLM endpoints.

```json
{
  "success": true,
  "models": [
    {
      "id": "primary",
      "endpoint": "Ollama (primary)",
      "endpointUrl": "http://ollama:8080",
      "type": "ollama",
      "name": "llama3.2:3b"
    },
    {
      "id": "docker_runner",
      "endpoint": "Docker Model Runner",
      "endpointUrl": "http://model-runner.docker.internal/engines/llama.cpp/v1",
      "type": "openai",
      "name": "ai/qwen3-coder:latest"
    }
  ]
}
```

---

### Pull a Model

```
POST /api/models/pull
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endpoint` | string | ✅ | Endpoint key (`primary`, `docker_runner`, `glm_flash`) |
| `model` | string | | Model name — defaults to the endpoint's configured model |

**Response** (202 Accepted — pull is async)
```json
{
  "success": true,
  "pullKey": "primary:llama3.2:3b",
  "endpoint": "primary",
  "model": "llama3.2:3b",
  "status": "pulling"
}
```

Progress events are emitted on the `/ws/events` WebSocket as `model_pull_progress`.

Docker Model Runner pulls (`docker_runner`, `glm_flash`) require `AGENT_BOARD_ENABLE_DOCKER_CONTROL=true`.

**Errors:** 400 unknown endpoint, 400 no model specified, 501 Docker control required but disabled

---

### Pull Status

```
GET /api/models/pull-status
```

```json
{
  "success": true,
  "pulls": {
    "primary:llama3.2:3b": {
      "status": "done",
      "endpoint": "primary",
      "model": "llama3.2:3b"
    }
  }
}
```

`status` is one of `pulling`, `done`, or `error`.

---

## Status

### Persistence Status

```
GET /api/persistence/status
```

```json
{
  "success": true,
  "persistence": {
    "configured": true,
    "enabled": true,
    "url": "postgresql://agent:***@agent-db:5432/agent_board"
  }
}
```

`configured` — `DATABASE_URL` is set. `enabled` — the Postgres connection is live and sessions are being persisted.

---

### Tracing Status

```
GET /api/tracing/status
```

```json
{
  "success": true,
  "tracing": {
    "enabled": false,
    "initialized": false,
    "endpoint": null
  }
}
```

Enable tracing with `OTEL_ENABLED=true` and `--profile observability` — see [.env.example](../.env.example).

---

## Metrics

All metrics are derived from the in-memory event bus and reset on server restart.

### Summary

```
GET /api/metrics/summary
```

```json
{
  "success": true,
  "summary": {
    "totalSessions": 12,
    "activeSessions": 3,
    "totalMessages": 47,
    "avgMessagesPerSession": 3.9,
    "modelDistribution": { "llama3.2:3b": 30, "ai/qwen3-coder:latest": 17 },
    "experienceDistribution": { "developer": 8, "research": 3, "safe_chat": 1 }
  }
}
```

---

### Safety

```
GET /api/metrics/safety
```

```json
{
  "success": true,
  "safety": {
    "totalClassified": 47,
    "classificationBreakdown": { "safe": 42, "sensitive": 3, "blocked": 2 },
    "totalBlocked": 2,
    "blockReasons": { "harmful_content": 1, "prompt_injection": 1 },
    "totalOutputsFiltered": 1,
    "filterTypes": { "pii": 1 },
    "recentBlocked": [
      { "timestamp": "2026-03-19T10:30:00.000Z", "session_id": "sess_...", "reason": "harmful_content" }
    ]
  }
}
```

---

### Feedback

```
GET /api/metrics/feedback
```

```json
{
  "success": true,
  "feedback": {
    "totalPositive": 8,
    "totalNegative": 2,
    "byModel": {
      "llama3.2:3b": { "positive": 6, "negative": 1 }
    },
    "byExperience": {
      "developer": { "positive": 5, "negative": 2 }
    }
  }
}
```

---

### Errors

```
GET /api/metrics/errors
```

```json
{
  "success": true,
  "errors": {
    "total": 3,
    "errorRatePercent": 6.4,
    "byModel": { "llama3.2:3b": 3 },
    "recentCount": 1,
    "recent": [
      {
        "timestamp": "2026-03-19T10:30:00.000Z",
        "session_id": "sess_...",
        "model": "llama3.2:3b",
        "error": "connect ECONNREFUSED"
      }
    ]
  }
}
```

---

## Experiences

### List Experiences

```
GET /api/experiences
```

```json
{
  "success": true,
  "experiences": [
    {
      "key": "developer",
      "name": "Developer Assistant",
      "description": "Unrestricted coding and research mode",
      "allowedEndpoints": ["primary", "docker_runner", "glm_flash", "openllm"],
      "defaultSafetyMode": "standard"
    },
    {
      "key": "research",
      "name": "Research Mode",
      "description": "Extended reasoning, web-aware prompts",
      "allowedEndpoints": ["primary", "docker_runner"],
      "defaultSafetyMode": "standard"
    },
    {
      "key": "safe_chat",
      "name": "Safe Chat",
      "description": "Strict safety policy, primary endpoint only",
      "allowedEndpoints": ["primary"],
      "defaultSafetyMode": "strict"
    }
  ],
  "demoMode": { "enabled": false, "enforcedExperience": null }
}
```

When `demoMode.enabled` is `true`, all sessions are forced into `enforcedExperience`.

---

## MCP Tool Servers

### Tool Server Status

```
GET /api/tools
```

```json
{
  "success": true,
  "dockerControlEnabled": false,
  "tools": [
    {
      "key": "content_gen",
      "name": "Content Studio",
      "description": "AI short-video generation via MoneyPrinterTurbo",
      "url": "http://tool-content-gen:3200",
      "serviceKey": "tool_content_gen",
      "composeService": "tool-content-gen",
      "ports": [3200],
      "running": false,
      "status": "unavailable",
      "health": null
    }
  ]
}
```

Start tool servers with `--profile tools`: `docker compose --profile tools up -d tool-content-gen tool-website`.

---

### List Tools for a Server

```
GET /api/tools/:toolKey/tools
```

`:toolKey` is `content_gen` or `website`.

```json
{
  "success": true,
  "tools": [
    {
      "name": "generate_video",
      "description": "Generate an AI short video from a topic",
      "inputSchema": { "type": "object", "properties": { "topic": { "type": "string" } } }
    }
  ]
}
```

**Errors:** 404 unknown toolKey, 502 tool server unreachable

---

### Call a Tool

```
POST /api/tools/:toolKey/call
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | MCP tool name (from the tools list above) |
| `arguments` | object | | Tool input arguments matching the tool's `inputSchema` |

**Response**
```json
{
  "success": true,
  "tool": "generate_video",
  "isError": false,
  "content": "Video job started. ID: job_abc123",
  "raw": { "content": [{ "type": "text", "text": "..." }] }
}
```

`isError: true` means the MCP server returned an error result (as opposed to a transport failure). The HTTP status is still 200 in this case; check `isError`.

**Errors:** 404 unknown toolKey, 400 missing tool name, 502 tool server unreachable or timed out

---

## Workspace File I/O

The workspace routes require `WORKSPACE_PATH` to be set in `.env` and the `docker-compose.workspace.yml` overlay to be applied. Paths are sandboxed to `WORKSPACE_ROOT` — attempts to escape via `..` are rejected.

### Status

```
GET /api/workspace/status
```

```json
{
  "configured": true,
  "root": "/workspace-root/my-project",
  "git": { "repo": true, "branch": "main", "dirty": false, "ahead": 0 }
}
```

`configured: false` when `WORKSPACE_PATH` is unset or the path doesn't exist.

---

### List Directory

```
GET /api/workspace/ls?path=src/components
```

```json
{
  "path": "src/components",
  "entries": [
    { "name": "App.jsx", "type": "file", "size": 4096, "modified": "2026-03-19T10:00:00.000Z" },
    { "name": "shared", "type": "dir" }
  ]
}
```

---

### Read File

```
GET /api/workspace/read?path=src/App.jsx
```

```json
{ "path": "src/App.jsx", "content": "import React from 'react';\n..." }
```

Files > 1 MB are rejected (413).

---

### Write File

```
POST /api/workspace/write
Content-Type: application/json
```

```json
{ "path": "src/App.jsx", "content": "import React from 'react';\n..." }
```

**Response**
```json
{ "path": "src/App.jsx", "bytes": 1234 }
```

Parent directories are created automatically.

---

### Git Status

```
GET /api/workspace/git/status
```

```json
{
  "branch": "main",
  "files": [
    { "status": "M", "file": "src/App.jsx" }
  ]
}
```

---

### Git Commit

```
POST /api/workspace/git/commit
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | ✅ | Commit message |
| `files` | string[] | | Files to stage; if omitted, `git add -A` is used |

**Response**
```json
{ "sha": "a1b2c3d", "branch": "main", "message": "feat: update app" }
```

---

### Git Push

```
POST /api/workspace/git/push
```

```json
{ "branch": "main" }
```

---

## Health

### Health Check

```
GET /api/health
```

```json
{
  "status": "ok",
  "timestamp": "2026-03-19T10:30:00.000Z",
  "endpoints": {
    "primary": "healthy",
    "docker_runner": "unavailable"
  }
}
```

---

## Task Queue

Lightweight in-memory task queue for cross-session coordination.

### List Tasks

```
GET /api/tasks?status=pending&sessionId=sess_...
```

```json
{
  "success": true,
  "tasks": [
    {
      "id": "task_abc",
      "title": "Investigate latency spike",
      "status": "pending",
      "priority": "high",
      "sessionId": "sess_...",
      "createdAt": "2026-03-19T10:00:00.000Z"
    }
  ],
  "summary": { "total": 1, "byStatus": { "pending": 1, "in_progress": 0, "blocked": 0, "completed": 0 } }
}
```

Valid `status` values: `pending`, `in_progress`, `blocked`, `completed`.

---

### Create Task

```
POST /api/tasks
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Short task description |
| `description` | string | | Longer detail |
| `priority` | string | | `low`, `medium`, `high`, `urgent` (default `medium`) |
| `sessionId` | string | | Session to assign the task to |

**Errors:** 400 missing title, 400 invalid priority, 400 sessionId not found

---

### Update Task

```
PUT /api/tasks/:id
Content-Type: application/json
```

Any subset of `{ status, priority, sessionId }`.

---

### Delete Task

```
DELETE /api/tasks/:id
```

---

### Tasks for a Session

```
GET /api/sessions/:id/tasks
```

---

## Webhooks

### Trigger Event

```
POST /api/webhooks/trigger
Content-Type: application/json
```

```json
{
  "event": "ci_fail",
  "source": "github-actions",
  "payload": { "runId": 1422, "branch": "main" },
  "createTask": {
    "title": "Fix failing CI run",
    "priority": "high",
    "sessionId": "sess_..."
  }
}
```

Valid `event` values: `ci_pass`, `ci_fail`, `deploy`, `deploy_fail`, `alert`, `review_requested`, `pr_merged`, `custom`.

`createTask` is optional. **Errors:** 400 missing/invalid event, 400 invalid source, 400 sessionId not found.

---

## Quick Reference

| Verb | Path | Description |
|------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/models` | All available models |
| POST | `/api/models/pull` | Pull a model (async) |
| GET | `/api/models/pull-status` | Pull progress |
| GET | `/api/system/services` | Service registry + live health |
| POST | `/api/system/services/:key/:action` | start / stop / restart a service |
| GET | `/api/system/info` | Node/platform/environment info |
| GET | `/api/experiences` | Available experience configs |
| GET | `/api/tools` | MCP tool server status |
| GET | `/api/tools/:key/tools` | List a server's MCP tools |
| POST | `/api/tools/:key/call` | Execute an MCP tool |
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions` | List sessions |
| GET | `/api/sessions/:id` | Get session + messages |
| POST | `/api/sessions/:id/message` | Send message |
| POST | `/api/sessions/:id/stream` | Stream message (SSE) |
| PUT | `/api/sessions/:id/model` | Switch endpoint/model |
| POST | `/api/sessions/:id/feedback` | Record thumbs up/down |
| DELETE | `/api/sessions/:id` | Delete session |
| GET | `/api/sessions/:id/tasks` | Tasks for a session |
| GET | `/api/tasks` | List all tasks |
| POST | `/api/tasks` | Create task |
| PUT | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |
| POST | `/api/webhooks/trigger` | Ingest an external event |
| GET | `/api/metrics/summary` | Session + message totals |
| GET | `/api/metrics/safety` | Safety classification + block metrics |
| GET | `/api/metrics/feedback` | Thumbs up/down by model + experience |
| GET | `/api/metrics/errors` | Error rate + recent failures |
| GET | `/api/persistence/status` | Postgres persistence status |
| GET | `/api/tracing/status` | OpenTelemetry tracing status |
| GET | `/api/workspace/status` | Workspace mount status + git info |
| GET | `/api/workspace/ls` | List workspace directory |
| GET | `/api/workspace/read` | Read workspace file |
| POST | `/api/workspace/write` | Write workspace file |
| GET | `/api/workspace/git/status` | Workspace git status |
| POST | `/api/workspace/git/commit` | Commit workspace changes |
| POST | `/api/workspace/git/push` | Push workspace branch |

---

## See Also

- [README.md](../README.md) — Quick start, profiles, Docker control
- [ARCHITECTURE.md](./ARCHITECTURE.md) — System design
- [MIGRATION.md](./MIGRATION.md) — Upgrading from v0.3
