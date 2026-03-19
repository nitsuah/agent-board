# ===============================================
# NemoClaw Setup Script for Windows (PowerShell)
# ===============================================
# Requirements: Git, Docker Desktop installed and running
# This script sets up NVIDIA NemoClaw for running OpenClaw
# safely with privacy and security controls
# ===============================================

# ---------- CHECK PREREQUISITES ----------
Write-Output "[INFO] Checking prerequisites..."

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker not found. Install Docker Desktop first: https://www.docker.com/get-started"
    exit
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "Git not found. Install Git first: https://git-scm.com/download/win"
    exit
}

Write-Output "[INFO] Prerequisites verified."

# ---------- CONFIG ----------
$NemoClawDir = "C:\Users\$env:USERNAME\nemoclaw"
$RepoUrl = "https://github.com/NVIDIA/NemoClaw.git"
$ContainerName = "nemoclaw"
$HostPort = 8081  # Port different from local_llm (8080)

# ---------- CREATE NEMOCLAW DIRECTORY ----------
if (-not (Test-Path $NemoClawDir)) {
    Write-Output "[INFO] Creating NemoClaw directory: $NemoClawDir"
    New-Item -ItemType Directory -Path $NemoClawDir | Out-Null
} else {
    Write-Output "[INFO] NemoClaw directory already exists."
}

# ---------- CLONE NEMOCLAW REPO ----------
$RepoPath = Join-Path $NemoClawDir "repo"
if (-not (Test-Path $RepoPath)) {
    Write-Output "[INFO] Cloning NemoClaw repository..."
    git clone $RepoUrl $RepoPath
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to clone NemoClaw repository."
        exit
    }
} else {
    Write-Output "[INFO] NemoClaw repository already cloned. Updating..."
    Push-Location $RepoPath
    git pull origin main
    Pop-Location
}

# ---------- BUILD NEMOCLAW DOCKER IMAGE ----------
Write-Output "[INFO] Building NemoClaw Docker image with safety features..."
Push-Location $RepoPath

# Use the safe Dockerfile with proper line ending handling
if (Test-Path "Dockerfile.safe") {
    Write-Output "[INFO] Found Dockerfile.safe, building with safety features..."
    docker build -f Dockerfile.safe -t nemoclaw:latest .
    if ($LASTEXITCODE -ne 0) {
        Write-Output "[WARNING] Safe Dockerfile build failed, using standard Dockerfile..."
        docker build -t nemoclaw:latest .
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to build NemoClaw image."
            Pop-Location
            exit
        }
    }
} elseif (Test-Path "Dockerfile") {
    Write-Output "[INFO] Found Dockerfile, building image..."
    docker build -t nemoclaw:latest .
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build NemoClaw image."
        Pop-Location
        exit
    }
} else {
    Write-Output "[WARNING] Neither Dockerfile nor Dockerfile.safe found."
    Write-Output "[INFO] Using pre-built NVIDIA NemoClaw image: nvidia/nemoclaw:latest"
}

Pop-Location

# ---------- REMOVE OLD CONTAINER ----------
$existing = docker ps -aq -f "name=$ContainerName"
if ($existing) {
    Write-Output "[INFO] Removing old container $ContainerName..."
    docker rm -f $ContainerName
}

# ---------- RUN NEMOCLAW CONTAINER ----------
Write-Output "[INFO] Starting NemoClaw container on port $HostPort..."

# Try with nvidia/nemoclaw if custom build didn't succeed
if (-not (docker images nemoclaw:latest -q)) {
    Write-Output "[INFO] Using NVIDIA NemoClaw public image..."
    $ImageName = "nvidia/nemoclaw:latest"
    docker pull $ImageName
} else {
    $ImageName = "nemoclaw:latest"
}

docker run -d `
    --name $ContainerName `
    -p ${HostPort}:8080 `
    -v "$($NemoClawDir):/workspace" `
    -v /tmp `
    -e NEMOCLAW_HOME=/workspace `
    -e LLM_API_URL=http://host.docker.internal:8080 `
    -e OPENSHELL_ENABLE=true `
    --cap-drop=all `
    --cap-add=NET_BIND_SERVICE `
    --security-opt no-new-privileges:true `
    $ImageName

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start NemoClaw container."
    exit
}

# Wait for OpenShell and OpenClaw to initialize
Write-Output "[INFO] Initializing NemoClaw with OpenShell security layer..."
Start-Sleep -Seconds 8

# Verify container is running
$containerStatus = docker ps -f "name=$ContainerName" -q
if (-not $containerStatus) {
    Write-Output "[WARNING] Container failed to start. Checking logs..."
    docker logs $ContainerName
    exit
}

Write-Output "[INFO] NemoClaw container started successfully!"

# ---------- DISPLAY STATUS ----------
Write-Output ""
Write-Output "=========================================="
Write-Output "NemoClaw Setup Complete!"
Write-Output "=========================================="
Write-Output "Container Name: $ContainerName"
Write-Output "API Endpoint: http://localhost:$HostPort"
Write-Output "Workspace: $NemoClawDir"
Write-Output ""
Write-Output "Safety Features Active:"
Write-Output "[+] OpenShell runtime (privacy and security)"
Write-Output "[+] Policy-based guardrails"
Write-Output "[+] Sandbox isolation (read-only filesystem)"
Write-Output "[+] Capability restrictions (--cap-drop=all)"
Write-Output "[+] Local LLM integration at http://localhost:8080"
Write-Output ""
Write-Output "Troubleshooting:"
Write-Output "1. Check logs: docker logs $ContainerName"
Write-Output "2. Verify local_llm running: docker ps | grep local_llm"
Write-Output "3. Test endpoint: curl http://localhost:$HostPort/health"
Write-Output ""
Write-Output "Community:"
Write-Output "Discord: https://discord.com/app/invite-with-guild-onboarding/bef6m4jKS7"
Write-Output "GitHub: https://github.com/NVIDIA/NemoClaw"
Write-Output "=========================================="
