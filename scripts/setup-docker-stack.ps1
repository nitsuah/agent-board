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

# Check docker-compose
if (-not (Get-Command docker-compose -ErrorAction SilentlyContinue)) {
    Write-Error "docker-compose not found."
    exit 1
}

Write-Output "[INFO] Prerequisites verified"

# Navigate to code directory
$codeDir = "C:\Users\$env:USERNAME\code"
if (-not (Test-Path $codeDir)) {
    Write-Error "Code directory not found: $codeDir"
    exit 1
}

Push-Location $codeDir

# Build NemoClaw image locally (if not using pre-built)
Write-Output "[INFO] Building NemoClaw Docker image..."
if (Test-Path "nemoclaw\repo\Dockerfile.safe") {
    Push-Location nemoclaw\repo
    docker build -f Dockerfile.safe -t nemoclaw:latest .
    Pop-Location
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build NemoClaw image"
        Pop-Location
        exit 1
    }
}

# Start all services with docker-compose
Write-Output "[INFO] Starting agent ecosystem with docker-compose..."
docker-compose up -d

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
        $llmHealth = Invoke-WebRequest -Uri "http://localhost:8080/api/tags" -ErrorAction SilentlyContinue
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
Write-Output "🌐 Agent Dashboard:  http://localhost:3000"
Write-Output "🤖 Local LLM (API):  http://localhost:8080"
Write-Output "🛡️  NemoClaw (Safe):  http://localhost:8081"
Write-Output ""
Write-Output "Docker Containers:"
docker ps --filter "name=local_llm|nemoclaw|agent-dashboard" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
Write-Output ""
Write-Output "Next Steps:"
Write-Output "1. Open http://localhost:3000 in your browser"
Write-Output "2. Create a new session with your preferred model"
Write-Output "3. Start chatting with local models!"
Write-Output ""
Write-Output "Pull more models:"
Write-Output "  docker exec local_llm ollama pull llama2"
Write-Output "  docker exec local_llm ollama pull neural-chat"
Write-Output ""
Write-Output "View logs:"
Write-Output "  docker-compose logs -f"
Write-Output ""
Write-Output "Stop services:"
Write-Output "  docker-compose down"
Write-Output "=============================================="
