# Setup Instructions

> **Historical document** — initial setup is complete. See [README.md](../README.md) for current quick start.

## Current Quick Start

```powershell
cd C:\Users\$env:USERNAME\code\agent-board
docker compose up -d
Start-Process "http://localhost:3000"
```

## Pull Models

```powershell
# Default model (already works out of the box if pulled)
docker exec llm_qwen_coder ollama pull llama2:latest

# Optional: smaller/faster alternative
docker exec llm_qwen_coder ollama pull qwen3:1.7b
```

See [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for all commands.


## 🔧 Setup Steps

### Option A: Automatic Setup (Recommended)

Run this PowerShell script to set everything up:

```powershell
# From C:\Users\$env:USERNAME\code\agent-board directory

# Copy dashboard files to dashboard/ subdirectory
Copy-Item -Path "index.html" -Destination "dashboard/index.html" -Force
Copy-Item -Path "vite.config.js" -Destination "dashboard/vite.config.js" -Force
Copy-Item -Path "src" -Destination "dashboard/src" -Recurse -Force

# Verify structure
Write-Host "Dashboard structure:"
Get-ChildItem dashboard/ -Recurse | Select-Object FullName

# Start the primary setup
Write-Host "Starting Docker containers..."
docker-compose up -d

# Wait for startup
Start-Sleep -Seconds 30

# Check status
Write-Host "Service status:"
docker ps --filter "name=llm_|nemoclaw|agent-dashboard"

# Open dashboard
Start-Process "http://localhost:3000"
```

### Option B: Manual Setup

```powershell
# Navigate to project
cd C:\Users\$env:USERNAME\code\agent-board

# Copy HTML entry point
Copy-Item index.html dashboard/

# Copy Vite config
Copy-Item vite.config.js dashboard/

# Copy React components
if (!(Test-Path dashboard/src)) {
    New-Item -ItemType Directory -Path dashboard/src -Force | Out-Null
}
Copy-Item -Path src/* -Destination dashboard/src -Recurse -Force

# Start services
docker-compose up -d

# Monitor startup
docker-compose logs -f
```

### Option C: Docker Compose Will Handle It

The docker-compose build context is `./dashboard/`, but the Dockerfile references files in that context. This means:

**Current state after files are copied:**
```
dashboard/
├── Dockerfile          ✅ Points to files in same directory
├── server.js          ✅ Created
├── package.json       ✅ Created
├── index.html         ⏳ Need to copy
├── vite.config.js     ⏳ Need to copy
└── src/               ⏳ Need to copy
```

Once these files are in place, docker-compose will work correctly.

## 🧪 Verify Setup

After copying files:

```powershell
# Check dashboard directory
Get-ChildItem C:\Users\$env:USERNAME\code\agent-board\dashboard

# Should show:
# Dockerfile
# server.js
# package.json
# index.html
# vite.config.js
# src/
```

## 🚀 Start Services

```powershell
# Primary setup (recommended)
docker-compose up -d

# OR fallback setup (if primary fails)
docker-compose -f docker-compose.legacy.yml up -d

# Check status
docker ps
```

## ✅ Verify It Works

```powershell
# Health check
curl http://localhost:3000/api/health

# List models
curl http://localhost:3000/api/models

# Open dashboard
Start-Process "http://localhost:3000"
```

## 📝 About the Files

### Why Split into dashboard/?

**Before:** All files at root level (messy)
```
agent-board/
├── index.html
├── server.js
├── package.json
├── vite.config.js
├── src/
├── Dockerfile
└── ... (15+ files at this level)
```

**After:** Organized by component (clean)
```
agent-board/
├── docker-compose.yml
├── docker-compose.legacy.yml
├── .env
├── dashboard/          ← All UI files here
│   ├── index.html
│   ├── server.js
│   ├── package.json
│   ├── vite.config.js
│   ├── Dockerfile
│   └── src/
├── legacy/             ← Fallback setup here
│   ├── Dockerfile.ollama
│   └── ollama-entrypoint.sh
├── config/             ← Future: config files
├── llm/                ← Future: LLM configs
├── services/           ← Future: monitoring, etc.
└── docs/               ← All documentation
```

### Files That Can Stay at Root

These can stay at root for convenience:
- `docker-compose.yml` (primary, you use often)
- `docker-compose.legacy.yml` (fallback)
- `.env` (configuration)
- `README.md` (getting started)
- `setup-docker-stack.ps1` (setup script)
- `stack-manager.ps1` (management script)

These are there for reference/compatibility:
- `Dockerfile` (original, use dashboard/Dockerfile instead)
- `Dockerfile.ollama` (moved to legacy/)
- `index.html` (should be in dashboard/)
- `server.js` (should be in dashboard/)
- `package.json` (should be in dashboard/)
- `vite.config.js` (should be in dashboard/)
- `src/` (should be in dashboard/src/)

## 🔄 Next: Update Scripts (Optional)

The old setup scripts (`setup-docker-stack.ps1`, `stack-manager.ps1`) still work but reference old paths. For now they're kept for compatibility.

**Future update:** Rewrite them to be aware of the new structure.

## 🐛 Troubleshooting

### "Dockerfile not found"
- Make sure `dashboard/Dockerfile` exists
- Check: `Test-Path C:\Users\$env:USERNAME\code\agent-board\dashboard\Dockerfile`

### "Cannot find file: index.html"
- Files haven't been copied yet
- Run the "Automatic Setup" section above

### "Docker build fails"
- Volumes might be mounted
- Run: `docker-compose down -v`
- Then try again: `docker-compose up -d`

### "Port already in use"
- Stop all containers: `docker-compose down`
- Check ports: `netstat -ano | findstr :3000`

## 📞 Need Help?

1. **Quick reference:** See [docs/QUICK_REFERENCE.md](./docs/QUICK_REFERENCE.md)
2. **API docs:** See [docs/API.md](./docs/API.md)
3. **Architecture:** See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
4. **View logs:** `docker-compose logs -f`
5. **Check health:** `curl http://localhost:3000/api/health`

---

**Status:** Ready to setup  
**Estimated time:** 5-10 minutes  
**Difficulty:** Easy ✅
