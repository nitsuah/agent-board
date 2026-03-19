# ===============================================
# Local LLM Setup Script for Windows (PowerShell)
# ===============================================
# Requirements: Docker Desktop installed and running
# This script pulls Docker images, starts a container,
# pulls a model (if Ollama), and exposes a local API
# ===============================================

# ---------- CONFIG ----------
# Choose your model here: options: mistral, neural-chat, llama2
$ModelChoice = "mistral"
$ContainerName = "local_llm"
$HostPort = 8080   # Port to expose API on

# ---------- CHECK DOCKER ----------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker not found. Install Docker Desktop first: https://www.docker.com/get-started"
    exit
}

# ---------- SELECT DOCKER IMAGE ----------
switch ($ModelChoice) {
    "mistral" { $DockerImage = "ollama/ollama:latest" }
    "neural-chat" { $DockerImage = "ollama/ollama:latest" }
    "llama2" { $DockerImage = "ollama/ollama:latest" }
    default { Write-Error "Unsupported model choice: $ModelChoice"; exit }
}

Write-Output "[INFO] Pulling Docker image: $DockerImage ..."
docker pull $DockerImage

# ---------- REMOVE OLD CONTAINER ----------
$existing = docker ps -aq -f "name=$ContainerName"
if ($existing) {
    Write-Output "[INFO] Removing old container $ContainerName ..."
    docker rm -f $ContainerName
}

# ---------- RUN CONTAINER ----------
Write-Output "[INFO] Starting container $ContainerName on port $HostPort ..."
Invoke-Expression "docker run -d --name $ContainerName -p ${HostPort}:8080 $DockerImage"

# ---------- PULL MODEL INSIDE CONTAINER (if Ollama) ----------
if ($DockerImage -eq "ollama/ollama:latest") {
    Write-Output "[INFO] Waiting for Ollama to start..."
    Start-Sleep -Seconds 10
    Write-Output "[INFO] Pulling model $ModelChoice inside container ..."
    docker exec $ContainerName ollama pull $ModelChoice
}

$curlBodySingleLine = "{""model"":""$ModelChoice"",""messages"":[{""role"":""user"",""content"":""Hello!""}]}"
Write-Output "curl -X POST http://localhost:$HostPort/v1/chat/completions -H 'Authorization: Bearer local' -H 'Content-Type: application/json' -d '$curlBodySingleLine'"
