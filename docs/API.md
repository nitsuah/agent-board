# API Documentation

Complete REST API reference for the Agent Dashboard.

## Base URL

```
http://localhost:3000/api
```

## Authentication

Currently no authentication required. Future: API keys/JWT tokens.

## Common Response Format

### Success Response
```json
{
  "success": true,
  "data": { /* endpoint-specific */ }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message"
}
```

## Endpoints

---

## 🤖 Models

### Get All Models

Aggregates models from all available LLM endpoints.

**Request:**
```
GET /api/models
```

**Response:**
```json
{
  "success": true,
  "models": [
    {
      "id": "primary",
      "endpoint": "Ollama (llama2)",
      "endpointUrl": "http://llm_qwen_coder:8080",
      "type": "default",
      "name": "llama2:latest"
    },
    {
      "id": "qwen_coder",
      "endpoint": "Ollama (qwen3-coder)",
      "endpointUrl": "http://llm_qwen_coder:8080",
      "type": "coding",
      "name": "qwen3-coder:latest"
    },
    {
      "id": "docker_runner",
      "endpoint": "Docker Model Runner",
      "endpointUrl": "http://model-runner.docker.internal/engines/llama.cpp/v1",
      "type": "openai",
      "name": "ai/qwen3-coder:latest"
    },
    {
      "id": "glm_flash",
      "endpoint": "Docker Model Runner (GLM)",
      "endpointUrl": "http://model-runner.docker.internal/engines/llama.cpp/v1",
      "type": "openai",
      "name": "ai/glm-4.7-flash:latest"
    }
  ],
  "endpoints": ["primary", "qwen_coder", "docker_runner", "glm_flash"]
}
```

**Errors:**
- Server error → Returns fallback models
- All endpoints down → Empty models array

**Usage:**
```javascript
// Get available models
const response = await fetch('/api/models');
const { models } = await response.json();
models.forEach(m => console.log(`${m.endpoint}: ${m.name}`));
```

---

## 💬 Sessions

### Create Session

Create a new agent session linked to a specific LLM endpoint.

**Request:**
```
POST /api/sessions
Content-Type: application/json

{
  "model": "llama2:latest",
  "endpoint": "primary",
  "name": "My First Chat"
}
```

**Response:**
```json
{
  "success": true,
  "session": {
    "id": "sess_1710864000000_abc123xyz",
    "name": "My First Chat",
    "model": "llama2:latest",
    "endpoint": "primary",
    "createdAt": "2026-03-19T10:00:00.000Z"
  }
}
```

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| model | string | ❌ | `llama2:latest` | Model name |
| endpoint | string | ❌ | `"primary"` | Endpoint ID (`primary`, `qwen_coder`, `docker_runner`, `glm_flash`) |
| name | string | ❌ | Generated | Human-readable session name |

**Errors:**
- 400: Invalid endpoint
- 500: Server error

**Usage:**
```javascript
const response = await fetch('/api/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'qwen3-coder:latest',
    endpoint: 'qwen_coder',
    name: 'Coding Session'
  })
});
const { session } = await response.json();
console.log(`Created session: ${session.id}`);
```

---

### List All Sessions

**Request:**
```
GET /api/sessions
```

**Response:**
```json
{
  "success": true,
  "sessions": [
    {
      "id": "sess_1710864000000_abc123xyz",
      "name": "My First Chat",
      "model": "qwen",
      "endpoint": "primary",
      "messageCount": 5,
      "createdAt": "2026-03-19T10:00:00.000Z",
      "updatedAt": "2026-03-19T10:05:00.000Z"
    },
    {
      "id": "sess_1710864100000_def456uvw",
      "name": "Coding Session",
      "model": "qwen-coder",
      "endpoint": "qwen_coder",
      "messageCount": 12,
      "createdAt": "2026-03-19T10:02:00.000Z",
      "updatedAt": "2026-03-19T10:15:00.000Z"
    }
  ]
}
```

**Usage:**
```javascript
const response = await fetch('/api/sessions');
const { sessions } = await response.json();
sessions.forEach(s => {
  console.log(`${s.name} (${s.messageCount} messages)`);
});
```

---

### Get Session Details

Retrieve full session data including message history.

**Request:**
```
GET /api/sessions/:id
```

**Response:**
```json
{
  "success": true,
  "session": {
    "id": "sess_1710864000000_abc123xyz",
    "name": "My First Chat",
    "model": "qwen",
    "endpoint": "primary",
    "llmUrl": "http://llm_qwen3:8080",
    "messages": [
      {
        "role": "user",
        "content": "What is 2+2?",
        "timestamp": "2026-03-19T10:00:05.000Z"
      },
      {
        "role": "assistant",
        "content": "2 + 2 = 4",
        "timestamp": "2026-03-19T10:00:06.000Z"
      }
    ],
    "createdAt": "2026-03-19T10:00:00.000Z"
  }
}
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | ✅ | Session ID from create or list |

**Errors:**
- 404: Session not found

**Usage:**
```javascript
const sessionId = 'sess_1710864000000_abc123xyz';
const response = await fetch(`/api/sessions/${sessionId}`);
const { session } = await response.json();
console.log(`Session has ${session.messages.length} messages`);
```

---

### Send Message

Send a message to the LLM and get a response.

**Request:**
```
POST /api/sessions/:id/message
Content-Type: application/json

{
  "message": "What is artificial intelligence?",
  "useSafeMode": false
}
```

**Response:**
```json
{
  "success": true,
  "response": "Artificial intelligence (AI) is the simulation of human intelligence by machines...",
  "endpoint": "Qwen 3.5",
  "messageCount": 6
}
```

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| message | string | ✅ | - | User message |
| useSafeMode | boolean | ❌ | false | Route through NemoClaw for safe execution |

**Errors:**
- 400: Missing message
- 404: Session not found
- 500: LLM service unavailable

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Request succeeded |
| response | string | LLM response |
| endpoint | string | Which endpoint handled the request |
| messageCount | number | Total messages in session (including new) |

**Usage:**
```javascript
const sessionId = 'sess_1710864000000_abc123xyz';
const response = await fetch(`/api/sessions/${sessionId}/message`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Tell me a joke',
    useSafeMode: false
  })
});
const { response: aiResponse } = await response.json();
console.log(`AI: ${aiResponse}`);
```

**Safe Mode Example:**
```javascript
// Route message through NemoClaw
const response = await fetch(`/api/sessions/${sessionId}/message`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Run a command',
    useSafeMode: true  // Routes to NemoClaw instead
  })
});
```

---

### Switch Model/Endpoint

Change the LLM endpoint for a session.

**Request:**
```
PUT /api/sessions/:id/model
Content-Type: application/json

{
  "endpoint": "qwen_coder",
  "model": "qwen-coder"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Switched to Qwen 3.5-Coder",
  "session": {
    "endpoint": "qwen_coder",
    "model": "qwen-coder",
    "llmUrl": "http://llm_qwen_coder:8080"
  }
}
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| endpoint | string | ✅ | Endpoint ID (`primary`, `qwen_coder`, `docker_runner`, `glm_flash`) |
| model | string | ❌ | Model name (auto-selected from endpoint default if omitted) |

**Notes:**
- Conversation history is preserved
- Next message will use new endpoint
- Invalid endpoint returns 400 error

**Usage:**
```javascript
const sessionId = 'sess_1710864000000_abc123xyz';
const response = await fetch(`/api/sessions/${sessionId}/model`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    endpoint: 'docker_runner',
    model: 'ai/glm-4.7-flash:latest'
  })
});
const { message } = await response.json();
console.log(message);
```

---

### Delete Session

Remove a session and all its data.

**Request:**
```
DELETE /api/sessions/:id
```

**Response:**
```json
{
  "success": true,
  "deleted": true
}
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | ✅ | Session ID |

**Notes:**
- Returns `deleted: false` if session doesn't exist
- Messages are lost (not persisted)
- Operation is immediate

**Usage:**
```javascript
const sessionId = 'sess_1710864000000_abc123xyz';
const response = await fetch(`/api/sessions/${sessionId}`, {
  method: 'DELETE'
});
const { deleted } = await response.json();
if (deleted) console.log('Session deleted');
```

---

## 🏥 Health & Status

### Health Check

Check health of dashboard and all LLM endpoints.

**Request:**
```
GET /api/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-19T10:30:00.000Z",
  "endpoints": {
    "primary": "healthy",
    "qwen_coder": "healthy",
    "docker_runner": "unavailable",
    "glm_flash": "unavailable"
  }
}
```

**Endpoint Status Values:**
- `healthy` - Available and responding
- `unavailable` - Cannot reach or timed out

**Usage:**
```javascript
// Check if services are ready
const response = await fetch('/api/health');
const { endpoints } = await response.json();
const allHealthy = Object.values(endpoints).every(s => s === 'healthy');
if (allHealthy) {
  console.log('All services are ready');
} else {
  console.log('Some services are unavailable');
}
```

---

## 📝 Complete Example: Multi-Turn Conversation

```javascript
// 1. Get available models
const modelsRes = await fetch('/api/models');
const { models } = await modelsRes.json();
console.log(`Available models: ${models.length}`);

// 2. Create a session with Qwen Coder for programming
const createRes = await fetch('/api/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'qwen3-coder:latest',
    endpoint: 'qwen_coder',
    name: 'Code Review Session'
  })
});
const { session } = await createRes.json();
const sessionId = session.id;
console.log(`Created session: ${sessionId}`);

// 3. Send first message
let msgRes = await fetch(`/api/sessions/${sessionId}/message`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Write a function that reverses a string in JavaScript'
  })
});
let { response } = await msgRes.json();
console.log(`AI: ${response}`);

// 4. Continue conversation
msgRes = await fetch(`/api/sessions/${sessionId}/message`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Can you add error handling?'
  })
});
response = (await msgRes.json()).response;
console.log(`AI: ${response}`);

// 5. Switch to fast model for quick inference
await fetch(`/api/sessions/${sessionId}/model`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    endpoint: 'glm_flash'
  })
});

// 6. Get session history
const detailRes = await fetch(`/api/sessions/${sessionId}`);
const { session: fullSession } = await detailRes.json();
console.log(`Session has ${fullSession.messages.length} messages`);

// 7. Clean up
await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
console.log('Session deleted');
```

---

## Error Handling

### Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success | Request processed |
| 400 | Bad Request | Invalid parameters |
| 404 | Not Found | Session/endpoint not found |
| 500 | Server Error | LLM service unavailable |

### Error Example

**Request:**
```
GET /api/sessions/invalid-id
```

**Response:**
```json
{
  "success": false,
  "error": "Session not found"
}
```

### Handling Unavailable LLM

If primary endpoint is unavailable but others work:

**Response to message request:**
```json
{
  "success": false,
  "response": "Error: connect ECONNREFUSED 127.0.0.1:8080. Make sure the LLM service is running at http://llm_qwen_coder:8080"
}
```

**Solution:**
```javascript
// Switch to available endpoint
await fetch(`/api/sessions/${sessionId}/model`, {
  method: 'PUT',
  body: JSON.stringify({ endpoint: 'glm_flash' })
});
```

---

## Rate Limiting

⚠️ **Not currently implemented**

**Future:** 
- Rate limit: 100 requests/minute per session
- Burst limit: 10 requests/second
- Queue management for model requests

---

## WebSocket Support

⚠️ **Not currently implemented**

**Future:**
- Real-time message streaming
- Live model switching
- Connection persistence

---

## Version & Compatibility

| Version | Date | Notes |
|---------|------|-------|
| 1.0.0 | 2026-03-19 | Multi-endpoint support, docker-compose.yml |
| 0.3.0 | Legacy | Original single-endpoint version |

---

## Troubleshooting API Issues

### Request Timeout

**Problem:** Requests hang without response
**Solution:** 
- Check LLM container: `docker ps`
- Increase timeout: 30s → 60s
- Check network: `docker network inspect agent-network`

### 404 on Valid Session ID

**Problem:** Session exists but returns 404
**Solution:**
- Sessions are in-memory, lost on restart
- Recreate session after restart

### Endpoint Unavailable

**Problem:** "Can't reach endpoint" errors
**Solution:**
```powershell
# Check container status
docker ps | grep llm_

# Check if service is responding
curl http://localhost:8080/api/tags

# Restart if needed
docker-compose restart llm_qwen_coder
```

---

## SDK Examples

### JavaScript/Node.js

See examples above. Use `fetch` or `axios`:

```javascript
const axios = require('axios');
const api = axios.create({ baseURL: 'http://localhost:3000/api' });

const session = await api.post('/sessions', {
  model: 'qwen',
  endpoint: 'primary'
});
```

### Python

```python
import requests

api = requests.Session()
api.base_url = 'http://localhost:3000/api'

response = api.post('/sessions', json={
    'model': 'qwen',
    'endpoint': 'primary'
})
session = response.json()['session']
```

### cURL

```bash
# Create session
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen","endpoint":"primary"}'

# Send message
curl -X POST http://localhost:3000/api/sessions/sess_xxx/message \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello!"}'
```

---

## Support

- 📖 [README.md](../README.md) - Getting started
- 📐 [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
- 🔄 [MIGRATION.md](./MIGRATION.md) - Upgrading from v0.3
