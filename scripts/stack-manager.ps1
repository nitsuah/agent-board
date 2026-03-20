#!/usr/bin/env pwsh

# Agent Stack Manager
# Manages the agent-board docker compose stack

param(
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$ComposeFile = "$PSScriptRoot/../docker-compose.yml"

function Write-Header {
    param([string]$text)
    Write-Host ""
    Write-Host "=== $text ===" -ForegroundColor Cyan
    Write-Host ""
}

function Start-Stack {
    Write-Header "Starting Agent Stack"
    docker compose -f $ComposeFile up -d
    Show-Status
}

function Stop-Stack {
    Write-Header "Stopping Agent Stack"
    docker compose -f $ComposeFile down
}

function Restart-Stack {
    Write-Header "Restarting Agent Stack"
    docker compose -f $ComposeFile restart
    Show-Status
}

function Show-Status {
    Write-Header "Service Status"
    docker compose -f $ComposeFile ps
    Write-Host ""
    Write-Host "Endpoints:" -ForegroundColor Cyan
    Write-Host "  Dashboard:   http://localhost:3000"
    Write-Host "  Ollama API:  http://localhost:8081"
    Write-Host "  NemoClaw:    http://localhost:9000"
    Write-Host ""
}

function Show-Logs {
    Write-Header "Recent Logs"
    docker compose -f $ComposeFile logs --tail=50
}

switch ($Action) {
    'start'   { Start-Stack }
    'stop'    { Stop-Stack }
    'restart' { Restart-Stack }
    'status'  { Show-Status }
    'logs'    { Show-Logs }
}
