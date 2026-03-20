# Quick Reference Guide

Fast reference for common operations.

## Getting Started

```powershell
# Navigate to project
cd C:\Users\$env:USERNAME\code\agent-board

# Start all services
docker compose up -d

# Open dashboard
Start-Process "http://localhost:3000"

# View logs
docker compose logs -f
```

## Available Endpoints

- Dashboard: http://localhost:3000
- Ollama API: http://localhost:8081  (`llm_qwen_coder` container)
- NemoClaw (Safe Mode): http://localhost:9000

## Docker Commands

```powershell
# See running containers
docker ps

# View logs
docker compose logs agent-dashboard        # Dashboard
docker compose logs llm_qwen_coder         # Ollama
docker logs llm_qwen_coder | Select-Object -Last 50

# Restart a service
docker compose restart agent-dashboard
docker compose restart llm_qwen_coder

# Rebuild dashboard after code changes
docker compose build agent-dashboard
docker compose up -d agent-dashboard

# Full cleanup
docker compose down -v
docker system prune -a
```

## Testing

```powershell
# Health check
curl http://localhost:3000/api/health | ConvertFrom-Json

# List models
curl http://localhost:3000/api/models | ConvertFrom-Json | Select -ExpandProperty models

# Create session
$session = curl -Method POST http://localhost:3000/api/sessions `
  -ContentType "application/json" `
  -Body '{"model":"llama2:latest","endpoint":"primary","name":"test"}' | ConvertFrom-Json
$sessionId = $session.session.id

# Send message
curl -Method POST "http://localhost:3000/api/sessions/$sessionId/message" `
  -ContentType "application/json" `
  -Body '{"message":"Hello!"}' | ConvertFrom-Json

# Switch to qwen coder endpoint
curl -Method PUT "http://localhost:3000/api/sessions/$sessionId/model" `
  -ContentType "application/json" `
  -Body '{"endpoint":"qwen_coder","model":"qwen3-coder:latest"}' | ConvertFrom-Json

# Run integration test
node dashboard/tests/test-chat.js
```

## File Organization

```
agent-board/
├── docker-compose.yml
├── dashboard/
│   ├── server.js               # Express backend
│   ├── src/                    # React frontend
│   └── tests/                  # Integration tests
├── scripts/
│   ├── setup-docker-stack.ps1
│   └── stack-manager.ps1
└── docs/
    ├── ARCHITECTURE.md
    ├── API.md
    └── QUICK_REFERENCE.md
```

## Models

```powershell
# List models in Ollama
docker exec llm_qwen_coder ollama list

# Pull a smaller model (recommended for <16GB RAM)
docker exec llm_qwen_coder ollama pull qwen3:1.7b
docker exec llm_qwen_coder ollama pull llama3.2:latest
```

| Model | RAM needed | Best for |
|---|---|---|
| `llama2:latest` | ~4 GB | Default — general chat |
| `qwen3:1.7b` | ~2 GB | Fast, lightweight |
| `qwen3-coder:latest` | ~18 GB | Code generation |
| `qwen3:latest` | ~18 GB at runtime | MoE — avoid on <16GB |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port already in use | `docker compose down` then retry |
| Container won't start | `docker logs <container>` |
| Can't reach Ollama | `curl http://localhost:8081/api/tags` |
| LLM OOM / no response | Switch to `llama2:latest`; check free RAM |
| Dashboard 404 | Rebuild: `docker compose build --no-cache agent-dashboard` |
| NemoClaw errors | `docker logs nemoclaw` |

## Endpoints (LLM_CONFIG in server.js)

| Key | URL | API style | Default model |
|---|---|---|---|
| `primary` | llm_qwen_coder:8080 | ollama | llama2:latest |
| `qwen_coder` | llm_qwen_coder:8080 | ollama | qwen3-coder:latest |
| `docker_runner` | model-runner.docker.internal | openai | ai/qwen3-coder:latest |
| `glm_flash` | model-runner.docker.internal | openai | ai/glm-4.7-flash:latest |

## 🔐 Safe Mode

Enable NemoClaw (policy enforcement):
```powershell
# In dashboard UI: Check "Use NemoClaw (Safe Mode)" before sending

# Or via API:
curl -Method POST "http://localhost:3000/api/sessions/$sessionId/message" `
  -Body '{"message":"...","useSafeMode":true}'
```

## Documentation

- `README.md` - Getting started
- `docs/ARCHITECTURE.md` - System design
- `docs/API.md` - Complete endpoint reference
- `docs/QUICK_REFERENCE.md` - This file

## 🎯 Development Workflow

### Local Development (no Docker)
```powershell
# Terminal 1: Dashboard backend
cd dashboard
npm install
npm run dev
# Runs on localhost:3000 (proxies LLM requests to running containers)

# Terminal 2: Make sure Ollama is running
docker compose up -d llm_qwen_coder nemoclaw
```

### Docker Development
```powershell
# Build & run with compose
docker compose up -d

# Edit files, then rebuild
docker compose build
docker-compose up -d
```

## 💾 Backing Up

```powershell
# Backup docker volumes
docker run --rm -v ollama_data:/data -v C:\backups:/backup `
  busybox tar czf /backup/ollama-backup.tar.gz -C /data .

# Restore
docker run --rm -v ollama_data:/data -v C:\backups:/backup `
  busybox tar xzf /backup/ollama-backup.tar.gz -C /data
```

## 🚨 Emergency Cleanup

If things are broken:

```powershell
# Nuclear option
docker-compose down -v
docker system prune -a
docker volume prune

# Restart fresh
docker-compose up -d
```

## 📈 Performance Tips

- Use GLM Flash for quick responses
- Use Qwen Coder for programming
- Use NemoClaw for critical operations
- Monitor with: `docker stats`
- Limit concurrent requests per session

## 🔗 Useful Links

- [Docker Compose Docs](https://docs.docker.com/compose/)
- [Ollama Documentation](https://github.com/ollama/ollama)
- [Qwen Model Card](https://huggingface.co/Qwen)
- [Agent Board Repo](https://github.com/yourusername/agent-board)

## 📞 Support

- **Logs:** `docker-compose logs <service>`
- **Health:** `curl http://localhost:3000/api/health`
- **Models:** `curl http://localhost:3000/api/models`
- **Docs:** See `docs/` folder
- **Issues:** Check container logs first

---

**Last Updated:** 2026-03-19  
**Status:** ✅ Ready to use  
**Primary Setup:** Docker Hub models  
**Fallback Setup:** Legacy custom Ollama
