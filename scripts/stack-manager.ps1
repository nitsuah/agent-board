#!/usr/bin/env pwsh

# Agent Stack Deployment Script
# This script manages the complete agent ecosystem deployment

param(
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs')]
    [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'

$containers = @(
    @{ name = 'local_llm'; image = 'ollama/ollama:latest'; port = '8080:8080'; vars = @{} }
    @{ name = 'nemoclaw'; image = 'nemoclaw:latest'; port = '8081:8080'; vars = @{ NEMOCLAW_HOME = '/workspace'; LLM_API_URL = 'http://local_llm:8080'; OPENSHELL_ENABLE = 'true' } }
    @{ name = 'agent-dashboard'; image = 'agent-dashboard:latest'; port = '3000:3000'; vars = @{ LOCAL_LLM_URL = 'http://local_llm:8080'; NEMOCLAW_URL = 'http://nemoclaw:8080'; PORT = '3000' } }
)

function Write-Header {
    param([string]$text)
    Write-Host ""
    Write-Host "╔$('═' * 55)╗" -ForegroundColor Cyan
    Write-Host "║ $text.PadRight(55) ║" -ForegroundColor Cyan
    Write-Host "╚$('═' * 55)╝" -ForegroundColor Cyan
    Write-Host ""
}

function Start-Stack {
    Write-Header "Starting Agent Stack"
    
    # Ensure network exists
    $networks = docker network ls --format "table {{.Name}}" | Select-Object -Skip 1
    if ($networks -notcontains 'agent-network') {
        Write-Host "📡 Creating network 'agent-network'..." -ForegroundColor Yellow
        docker network create agent-network
        Write-Host "✓ Network created" -ForegroundColor Green
    }
    
    # Start each container
    foreach ($container in $containers) {
        if (docker ps -a --format "table {{.Names}}" | Select-Object -Skip 1 | Select-String "^$($container.name)$") {
            Write-Host "▶️  Starting $($container.name)..." -ForegroundColor Yellow
            docker start $container.name
            Write-Host "✓ $($container.name) started" -ForegroundColor Green
        } else {
            Write-Host "🆕 Creating $($container.name)..." -ForegroundColor Yellow
            
            $envArgs = @()
            foreach ($key in $container.vars.Keys) {
                $envArgs += '-e', "$key=$($container.vars[$key])"
            }
            
            if ($container.name -eq 'nemoclaw') {
                $volumeArgs = @('-v', 'nemoclaw_data:/workspace')
                $capArgs = @('--cap-drop=all', '--cap-add=NET_BIND_SERVICE', '--security-opt', 'no-new-privileges:true')
            } elseif ($container.name -eq 'local_llm') {
                $volumeArgs = @('-v', 'ollama_data:/root/.ollama')
                $capArgs = @()
            } else {
                $volumeArgs = @()
                $capArgs = @()
            }
            
            $dockerCmd = @(
                'run', '-d',
                '--name', $container.name,
                '--network', 'agent-network',
                '-p', $container.port
            )
            $dockerCmd += $envArgs
            $dockerCmd += $volumeArgs
            $dockerCmd += $capArgs
            $dockerCmd += $container.image
            
            & docker @dockerCmd *>$null
            Write-Host "✓ $($container.name) created" -ForegroundColor Green
        }
    }
    
    # Wait for services to be ready
    Write-Host ""
    Write-Host "⏳ Waiting for services to be ready..." -ForegroundColor Cyan
    Start-Sleep -Seconds 5
    
    # Verify containers are running
    Write-Host ""
    Show-Status
}

function Stop-Stack {
    Write-Header "Stopping Agent Stack"
    
    foreach ($container in $containers) {
        $container.name
        if (docker ps --format "table {{.Names}}" | Select-Object -Skip 1 | Select-String "^$($container.name)$") {
            Write-Host "⏹️  Stopping $($container.name)..." -ForegroundColor Yellow
            docker stop $container.name *>$null
            Write-Host "✓ $($container.name) stopped" -ForegroundColor Green
        }
    }
    
    Write-Host ""
    Write-Host "✓ All services stopped" -ForegroundColor Green
}

function Restart-Stack {
    Stop-Stack
    Start-Sleep -Seconds 2
    Start-Stack
}

function Show-Status {
    Write-Header "Service Status"
    
    docker ps --format "table {{.Names}}\t{{.Status}}" |  Where-Object { $_ -match 'local_llm|nemoclaw|agent-dashboard|NAMES' }
    
    Write-Host ""
    Write-Host "🌐 Web Interfaces:" -ForegroundColor Cyan
    Write-Host "  • Dashboard:   http://localhost:3000"
    Write-Host "  • Ollama:      http://localhost:8080"
    Write-Host "  • NemoClaw:    http://localhost:8081"
    Write-Host ""
}

function Show-Logs {
    Write-Header "Recent Logs"
    docker-compose -f "$PSScriptRoot/../docker-compose.yml" logs --tail=20
}

# Execute the requested action
switch ($Action) {
    'start'   { Start-Stack }
    'stop'    { Stop-Stack }
    'restart' { Restart-Stack }
    'status'  { Show-Status }
    'logs'    { Show-Logs }
    default   { Write-Host "Unknown action: $Action"; exit 1 }
}
