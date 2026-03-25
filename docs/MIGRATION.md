# Migration Notes

This document captures what changed when the project was reorganized from a flat structure into the current layout.

## Current Structure (post-migration)

```
agent-board/
├── docker-compose.yml
├── dashboard/
│   ├── Dockerfile
│   ├── server.js
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   ├── src/
│   └── tests/
├── scripts/
│   ├── setup-docker-stack.ps1
│   └── stack-manager.ps1
├── config/
├── llm/
├── services/
└── docs/
```

**Migration is complete.** Use `docker compose up -d` and open http://localhost:3000.

## What Changed from Original Flat Layout

| Before | After |
|--------|-------|
| `server.js` at root | `dashboard/server.js` |
| `src/` at root | `dashboard/src/` |
| Single Dockerfile at root | `dashboard/Dockerfile` |
| `stack-manager.ps1` at root | `scripts/stack-manager.ps1` |
| `setup-docker-stack.ps1` at root | `scripts/setup-docker-stack.ps1` |
| `test-chat.js` at root | `dashboard/tests/test-chat.js` |
| Multiple LLM containers | Single Ollama container (`ollama`) |
| Session endpoint: `PUT .../endpoint` | `PUT .../model` |
| `useNemoClaw` field | `useSafeMode` field |

## API Changes

### Endpoints available
`primary`, `docker_runner`, `glm_flash`

### Switch model
```
PUT /api/sessions/:id/model
Body: { "endpoint": "qwen_coder", "model": "qwen3-coder:latest" }
```

### Send message with safe mode
```
POST /api/sessions/:id/message
Body: { "message": "...", "useSafeMode": true }
```


## What Changed

### Before
```
agent-board/
├── Dockerfile              # Dashboard build
├── Dockerfile.ollama       # LLM build
├── docker-compose.yml      # Single setup
├── server.js              # Backend
├── index.html             # Frontend
├── package.json
├── vite.config.js
└── src/                   # React components
```

### After
```
agent-board/
├── docker-compose.yml          # PRIMARY: Docker Hub models
├── docker-compose.legacy.yml   # FALLBACK: Custom build
├── dashboard/
│   ├── Dockerfile
│   ├── server.js
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   └── src/
├── legacy/
│   ├── Dockerfile.ollama
│   ├── ollama-entrypoint.sh
│   └── README.md
├── config/
├── llm/
├── services/
└── docs/
    ├── ARCHITECTURE.md    # NEW
    ├── MIGRATION.md       # NEW
    └── API.md            # NEW
```

## Migration Steps

### 1. No Action Required for Users

✅ **Most files have been automatically organized**. The structure is:
- `docker-compose.yml` (NEW) - Primary setup with Docker Hub models
- `docker-compose.legacy.yml` (NEW) - Fallback with custom Ollama
- `/dashboard/` - Web UI files
- `/legacy/` - Old custom files
- `/docs/` - New documentation

### 2. Update Your Workflow

#### If using the primary setup (recommended):

**Old way:**
```powershell
# Old - Not recommended
docker-compose up -d
```

**New way (same command, but different setup):**
```powershell
docker-compose up -d
# Now runs Qwen 3.5 + Qwen Coder + GLM Flash
# Access at http://localhost:3000
```

#### If you need the legacy setup:

**Old way (implicit):**
```powershell
# You were using manual Ollama
docker build -f Dockerfile.ollama -t local_llm .
docker-compose up -d
```

**New way (explicit):**
```powershell
# Explicit fallback
docker-compose -f docker-compose.legacy.yml up -d
```

### 3. Update Your Code Integration

If you have code that calls the dashboard API:

#### Get Models (Aggregated Support)

**Old response:**
```json
{
  "models": [
    { "name": "mistral", "model": "mistral", "size": "7B" }
  ]
}
```

**New response (with endpoint info):**
```json
{
  "models": [
    {
      "id": "primary",
      "endpoint": "Qwen 3.5",
      "endpointUrl": "http://llm_qwen3:8080",
      "type": "default",
      "name": "qwen",
      "model": "qwen",
      "size": "32B"
    },
    // ... more models
  ],
  "endpoints": ["primary", "qwen_coder", "glm_flash"]
}
```

#### Create Session (Now with endpoint selection)

**Old request:**
```json
{
  "model": "mistral",
  "name": "session-1"
}
```

**New request (endpoint added):**
```json
{
  "model": "qwen",
  "endpoint": "primary",
  "name": "session-1"
}
```

#### Switch Models (Changed parameter)

**Old:**
```bash
PUT /api/sessions/:id/model
Body: { "model": "qwen" }
```

**New:**
```bash
PUT /api/sessions/:id/model
Body: { "endpoint": "qwen_coder", "model": "qwen-coder" }
```

### 4. Environment Variables

`.env` file has been updated with new endpoints:

**Old variables (still supported via legacy setup):**
```env
LOCAL_LLM_URL=http://localhost:8080
NEMOCLAW_URL=http://localhost:8081
```

**New variables (docker-compose.yml):**
```env
PRIMARY_LLM_URL=http://ollama:8080
DOCKER_RUNNER_URL=http://model-runner.docker.internal/engines/llama.cpp/v1
DOCKER_RUNNER_MODEL=ai/qwen3-coder:latest
GLM_FLASH_MODEL=ai/glm-4.7-flash:latest
NEMOCLAW_URL=http://nemoclaw:8080
```

### 5. Database/Persistence

⚠️ **Sessions are re-created from scratch**

Old setup:
- In-memory sessions (lost on restart)

New setup:
- Also in-memory (no database migration needed)

If you had persistent sessions in the old setup, reimport them or recreate them.

### 6. Health Checks

Health check paths have changed:

**Old:**
```
GET http://local_llm:8080/api/tags
GET http://nemoclaw:8081/health
```

**New (primary setup):**
```
GET http://ollama:8080/api/tags
GET http://nemoclaw:8080/health
```

**Dashboard aggregated health:**
```
GET http://localhost:3000/api/health
```

## Rollback Instructions

If you need to revert to the old setup:

**1. Keep legacy as backup:**
```powershell
# Legacy files are in ./legacy/ directory
# docker-compose.legacy.yml is available
copy docker-compose.legacy.yml docker-compose.yml
```

**2. Full rollback:**
```powershell
# Stop new setup
docker-compose down

# Switch to legacy
docker-compose up -d
```

## Troubleshooting Migration

### Docker Images Not Found

**Error:** `pull access denied for ai/qwen3.5`

**Solution:**
1. Ensure Docker is logged in: `docker login`
2. Check Docker Hub availability
3. Fall back to legacy: `docker-compose -f docker-compose.legacy.yml up -d`

### Sessions Not Persisting

**Old behavior:** Sessions were lost on restart (in-memory)
**New behavior:** Same - sessions are in-memory

No persistence layer changes. If you need persistent sessions, see ARCHITECTURE.md for future plans.

### Port Conflicts

**Check existing containers:**
```powershell
docker ps -a
docker port <container>
```

**Free up ports:**
```powershell
docker compose down
docker container prune
```

### Network Issues

Containers must be on same network:
```powershell
# List networks
docker network ls

# Check agent-network exists
docker network inspect agent-network
```

## FAQ

**Q: Should I use primary or legacy setup?**
A: Use primary (docker-compose.yml) - it's faster and recommended. Use legacy only for testing.

**Q: Do I need to move my old files?**
A: No, they're already organized. Dashboard files are in `/dashboard/`, legacy in `/legacy/`.

**Q: Can I run both setups simultaneously?**
A: Not with the same port mappings. Use different `.env.local` for different configs.

**Q: What if Docker Hub models don't work?**
A: Fall back to legacy: `docker-compose -f docker-compose.legacy.yml up -d`

**Q: How do I switch setups?**
A:
```powershell
# Stop current
docker compose down

# Start different setup
docker compose -f docker-compose.legacy.yml up -d

# Or back to primary
docker compose up -d
```

**Q: Are sessions compatible between setups?**
A: No - sessions are ephemeral. They're lost when containers stop.

## Verification Checklist

- [ ] `docker-compose.yml` uses Docker Hub models
- [ ] `docker-compose.legacy.yml` is available for fallback
- [ ] Dashboard accessible at http://localhost:3000
- [ ] Multiple models visible in /api/models
- [ ] Can create sessions with endpoint selection
- [ ] Can switch models mid-conversation
- [ ] Health check passes: /api/health
- [ ] NemoClaw available on port 9000

## Next Steps

1. **Read** [ARCHITECTURE.md](./ARCHITECTURE.md) for design details
2. **Review** [API.md](./API.md) for endpoint changes
3. **Test** with different endpoints and model combinations
4. **Provide Feedback** on the new organization

## Support

For questions or issues:
1. Check [README.md](../README.md) for quick start
2. Review [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for design
3. Check container logs: `docker-compose logs <service>`
4. File an issue on GitHub
