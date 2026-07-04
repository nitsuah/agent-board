# Production Deployment Guide

motor-pool is Docker-native and local-first. This guide covers running it on a
dedicated host (Linux server, a VPS, or a Windows machine with Docker Desktop).

---

## Prerequisites

| Requirement | Minimum | Notes |
|-------------|---------|-------|
| Docker Engine / Docker Desktop | 24+ | Compose v2 required (`docker compose`, not `docker-compose`) |
| RAM | 4 GB | 8 GB recommended for Ollama models |
| Disk | 10 GB free | More if pulling large models |
| GPU (optional) | CUDA 12+ / ROCm | Required for GPU-accelerated Ollama |

---

## 1. Clone and configure

```bash
git clone https://github.com/nitsuah/motor-pool.git
cd motor-pool
cp .env.example config/.env
```

Edit `config/.env` — at minimum set:

```env
POSTGRES_DB=agent_board
POSTGRES_USER=agent
POSTGRES_PASSWORD=<strong-random-password>
ACTIVE_LLM_BACKEND=docker-model-runner   # or ollama
DEVICE_PROFILE=laptop                    # minimal | laptop | desktop
```

---

## 2. Choose an LLM backend

### Docker Model Runner (default — lowest overhead)

Uses Docker Desktop's built-in model runner. No extra container required.

```bash
docker compose -f config/docker-compose.yml --project-directory . up -d
```

### Ollama (local container, higher RAM)

```bash
ACTIVE_LLM_BACKEND=ollama \
docker compose -f config/docker-compose.yml --project-directory . --profile llm-ollama up -d

# Pull a model
docker exec ollama ollama pull llama3.2:3b
```

---

## 3. Enable optional profiles

```bash
# MCP tool servers (content-gen, website agent)
docker compose -f config/docker-compose.yml --project-directory . --profile tools up -d

# Docker control UI (lets dashboard start/stop services)
# Requires: AGENT_BOARD_ENABLE_DOCKER_CONTROL=true in .env
docker compose -f config/docker-compose.yml -f config/docker-compose.docker-control.yml \
  --project-directory . up -d
```

---

## 4. Secrets handling

**Never commit `config/.env` to source control.** The repository's `.gitignore`
excludes it by default.

Secrets checklist:
- `POSTGRES_PASSWORD` — use a long random string; never use the default `agent`
- `ANTHROPIC_API_KEY` / external LLM keys — set only if using BYOK endpoints via the dashboard UI; not required for local-only setups
- `WEBHOOK_SECRET` — set if using the webhooks API to receive inbound events

For CI/CD or remote hosts, inject secrets via environment variables or a secrets
manager (e.g. Docker Swarm secrets, Vault, or GitHub Actions secrets) rather than
shipping a `.env` file.

---

## 5. Reverse proxy (HTTPS)

The dashboard runs on port `3000` and does not terminate TLS. For internet-facing
deployments, put it behind a reverse proxy:

**nginx example**

```nginx
server {
    listen 443 ssl;
    server_name board.example.com;

    ssl_certificate     /etc/letsencrypt/live/board.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/board.example.com/privkey.pem;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_read_timeout 300s;   # needed for streaming LLM responses
    }
}
```

**Caddy example**

```
board.example.com {
    reverse_proxy localhost:3000
}
```

---

## 6. Health check

```bash
curl http://localhost:3000/api/health
# → {"status":"ok","timestamp":"...","server":{...},"llm":{...}}
```

Container-level health is already configured in `docker-compose.yml`
(`/api/health` with 30 s interval, 3 retries, 30 s start period).

---

## 7. Persistence

The PostgreSQL database stores sessions, tasks, and messages. The data volume is
named `agent-db-data` and persists across `docker compose down` restarts.

To back up:

```bash
docker exec agent-db pg_dump -U agent agent_board > backup_$(date +%F).sql
```

To restore:

```bash
cat backup_YYYY-MM-DD.sql | docker exec -i agent-db psql -U agent agent_board
```

---

## 8. Updating

```bash
git pull origin main
docker compose -f config/docker-compose.yml --project-directory . up -d --build
```

The `--build` flag rebuilds the dashboard image. Database migrations run
automatically on server start via `db.js`.

---

## 9. Environment variables reference

| Variable | Default | Description |
|----------|---------|-------------|
| `ACTIVE_LLM_BACKEND` | `docker-model-runner` | `docker-model-runner`, `ollama`, `openllm` |
| `DEVICE_PROFILE` | `minimal` | `minimal`, `laptop`, `desktop` — drives default model selection |
| `PRIMARY_LLM_URL` | `http://ollama:8080` | Override Ollama endpoint |
| `PRIMARY_LLM_MODEL` | profile-dependent | Override default model |
| `POSTGRES_DB/USER/PASSWORD` | `agent_board / agent / agent` | Database credentials |
| `PORT` | `3000` | Dashboard HTTP port |
| `AGENT_BOARD_ENABLE_DOCKER_CONTROL` | `false` | Enable start/stop/restart buttons in UI |
| `OTEL_ENABLED` | `false` | Enable OpenTelemetry tracing (exports to Jaeger) |
| `WEBHOOK_SECRET` | — | HMAC secret for inbound webhook validation |
| `CUSTOM_LLM_ENDPOINTS` | — | JSON array of additional LLM endpoints (BYOK) |
| `PUBLIC_DEMO_MODE` | `false` | Restricts to primary endpoint, disables destructive ops |
| `BB_MCP_ENABLED` | `false` | Enable Blackboard MCP connector |

---

## 10. Resource limits (optional)

Add resource limits to `config/docker-compose.yml` service definitions to cap
memory on shared hosts:

```yaml
services:
  agent-dashboard:
    deploy:
      resources:
        limits:
          memory: 512M
  ollama:
    deploy:
      resources:
        limits:
          memory: 6G
```
