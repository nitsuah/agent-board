# ===============================================
# Agent Ecosystem Setup Script for Windows
# ===============================================
# Sets up Docker containers for:
# - Local LLM (Ollama with models)
# - NemoClaw (Safe agent runtime)
# - Agent Dashboard (Web UI)
# ===============================================

Write-Output "[INFO] Agent Ecosystem Setup"
Write-Output "=============================="

# Check Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop"
    exit 1
}

# Check docker compose
if (-not (docker compose version 2>$null)) {
    Write-Error "docker compose not found. Ensure Docker Desktop is installed and up to date."
    exit 1
}

Write-Output "[INFO] Prerequisites verified"

# Navigate to agent-board directory
$projectDir = Join-Path $env:USERPROFILE 'code\agent-board'
if (-not (Test-Path $projectDir)) {
    Write-Error "Project directory not found: $projectDir"
    exit 1
}

Push-Location $projectDir

# Start all services
Write-Output "[INFO] Starting agent ecosystem..."
docker compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start services"
    Pop-Location
    exit 1
}

# Wait for services to be healthy
Write-Output "[INFO] Waiting for services to be healthy..."
Start-Sleep -Seconds 5

# Check health
$healthy = 0
1..5 | ForEach-Object {
    Write-Output "[INFO] Health check attempt $_/5..."
    
    try {
        $llmHealth = Invoke-WebRequest -Uri "http://localhost:8081/api/tags" -ErrorAction SilentlyContinue
        $dashboardHealth = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -ErrorAction SilentlyContinue
        
        if ($llmHealth.StatusCode -eq 200 -and $dashboardHealth.StatusCode -eq 200) {
            $healthy = 1
        }
    } catch {
        Write-Output "[WAIT] Services still starting..."
        Start-Sleep -Seconds 3
    }
}

Pop-Location

Write-Output ""
Write-Output "=============================================="
Write-Output "Agent Ecosystem Running!"
Write-Output "=============================================="
Write-Output "  Dashboard:    http://localhost:3000"
Write-Output "  Ollama API:   http://localhost:8081"
Write-Output "  NemoClaw:     http://localhost:9000"
Write-Output ""
Write-Output "Docker Containers:"
docker ps --filter "name=llm_qwen_coder" --filter "name=nemoclaw" --filter "name=agent-dashboard" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
Write-Output ""
Write-Output "Next Steps:"
Write-Output "1. Open http://localhost:3000 in your browser"
Write-Output "2. Create a new session with your preferred model"
Write-Output "3. Start chatting with local models!"
Write-Output ""
Write-Output "List loaded models:"
Write-Output "  docker exec llm_qwen_coder ollama list"
Write-Output ""
Write-Output "Pull additional models:"
Write-Output "  docker exec llm_qwen_coder ollama pull qwen3:1.7b"
Write-Output "  docker exec llm_qwen_coder ollama pull llama3.2:latest"
Write-Output "  docker exec local_llm ollama pull neural-chat"
Write-Output ""
Write-Output "View logs:"
Write-Output "  docker-compose logs -f"
Write-Output ""
Write-Output "Stop services:"
Write-Output "  docker-compose down"
Write-Output "=============================================="
