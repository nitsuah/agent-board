# Agent Ecosystem - Local Development Stack

Local AI agent dashboard backed by Ollama (container: ollama), with NemoClaw safety sandbox (container: nemoclaw), and optional Docker Model Runner support (not a container).

## Overview

- **Ollama** (`ollama`) - Local LLM runtime, models pulled on demand (port 8081)
- **NemoClaw** (`nemoclaw`) - Policy-enforced safe execution sandbox (port 9000)
- **Agent Dashboard** (`agent-dashboard`) - React/Express web UI for session management (port 3000)
- **Docker Model Runner** (optional) - Docker Desktop's built-in OpenAI-compatible model API (not a container)

## Architecture

```
┌──────────────────────────────────────┐
│  agent-dashboard  (Port 3000)        │
│  React + Express.js                  │
└─────────────┬────────────────────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
┌──────────────┐  ┌──────────────────┐
│  ollama      │  │  nemoclaw        │
│  (Ollama)    │  │  (Safe Runtime)  │
│  Port 8081   │  │  Port 9000       │
│ llama2:latest│  │  • OpenShell     │
│ qwen3-coder  │  │  • Policy Guards │
│ ...          │  │  • Sandbox       │
└──────────────┘  └──────────────────┘
```

## Quick Start

```powershell
cd C:\Users\$env:USERNAME\code\agent-board
docker compose up -d
Start-Process "http://localhost:3000"
```

## Container Reference

### ollama (Ollama)
```powershell
# List loaded models
docker exec ollama ollama list

# Pull a model
docker exec ollama ollama pull llama3.2:latest

# View logs
docker logs -f ollama
```

### nemoclaw (Safety Layer)
```powershell
docker logs -f nemoclaw
```

### agent-dashboard (Web UI)
```powershell
docker logs -f agent-dashboard

# Rebuild after code changes
docker compose build agent-dashboard
docker compose up -d agent-dashboard
```

## Management

```powershell
.\scripts\stack-manager.ps1 -Action start
.\scripts\stack-manager.ps1 -Action stop
.\scripts\stack-manager.ps1 -Action restart
.\scripts\stack-manager.ps1 -Action status
.\scripts\stack-manager.ps1 -Action logs

# Or docker compose directly
docker compose ps
docker compose down
docker compose up -d
```

## API Summary

```
GET    /api/models
GET    /api/health
GET    /api/docker/status
POST   /api/sessions
GET    /api/sessions
GET    /api/sessions/:id
POST   /api/sessions/:id/message
PUT    /api/sessions/:id/model
DELETE /api/sessions/:id
```

Ollama direct access: `GET http://localhost:8081/api/tags`

## Security

- All traffic local — no external API calls
- NemoClaw: `--cap-drop=all`, `no-new-privileges:true`
- Dashboard proxies all LLM requests (Ollama not exposed directly in production)

## MCPs & Extensions

See [MCP_SETUP.md](./MCP_SETUP.md) for GitHub, Docker, Filesystem, and shell MCPs.

- Git MCP - Direct git operations

Recommended setup:
```powershell
npm install -g @modelcontextprotocol/server-docker
npm install -g @modelcontextprotocol/server-filesystem
npm install -g @modelcontextprotocol/server-git
npm install -g @modelcontextprotocol/server-bash
```

## 🎓 Using with Claude

Once MCPs are installed, use Claude to:

```
"Create a new feature branch and implement X"
→ Uses GitHub & Git MCPs for safe development

"Add a new model endpoint to the dashboard"
→ Uses Filesystem MCP to modify files safely

"Deploy the agent-dashboard image to Docker Hub"
→ Uses Docker MCP to manage containers

"Run tests in the agent-dashboard"
→ Uses Bash MCP with safety restrictions
```

## 🐛 Troubleshooting

### Services won't start
```powershell
# Check Docker is running
docker ps

# View detailed logs
docker-compose logs --tail=50
```

### Models not loading
```powershell
# Check Ollama is responding
Invoke-WebRequest http://localhost:8081/api/tags

# Verify models are pulled
docker exec ollama ollama list
```

### Dashboard won't connect
```powershell
# Check it's running
docker ps | findstr agent-dashboard

# Verify network
docker network ls
docker network inspect agent-network
```

### Memory issues
Adjust Docker Desktop resources:
- Settings → Resources
- Memory: 8GB+ recommended
- CPUs: 4+ cores

## 📚 Documentation

- [Agent Dashboard README](./agent-dashboard/README.md)
- [MCP Setup Guide](./MCP_SETUP.md)
- [Ollama Models](https://ollama.ai/library)
- [NemoClaw Docs](https://github.com/NVIDIA/NemoClaw)

## 🤝 Contributing

Development workflow:
1. Create git worktree: `git worktree add ../feature-name feature/name`
2. Make changes and test locally
3. Rebuild Docker: `docker-compose up -d --build`
4. Commit and push
5. Clean up worktree: `git worktree remove ../feature-name`

## 📝 Model Inventory

### Currently Available
- **Mistral** (4.4 GB) - Fast, good for most tasks
- **Qwen** (2.3 GB) - Smaller, efficient
- Add more via: `docker exec ollama ollama pull <model>`

### Recommended Additions
```bash
docker exec ollama ollama pull llama2          # Meta's LLaMA 2
docker exec ollama ollama pull neural-chat    # Intel's chat model
docker exec ollama ollama pull dolphin-mixtral # Mixture of experts
```

## 🎯 Next Steps

1. ✓ Run `setup-docker-stack.ps1`
2. ✓ Open http://localhost:3000
3. ✓ Create a session and chat
4. → Install MCPs (see MCP_SETUP.md)
5. → Use Claude with MCPs for safe development
6. → Build features with agent assistance

## 📞 Support

Issues? Check:
- Docker Desktop logs
- Service health: `docker-compose ps`
- Individual container logs: `docker logs <container>`
- Network connectivity: `docker network inspect agent-network`

---

**Last Updated**: March 2026
**Status**: Production Ready
**License**: MIT
