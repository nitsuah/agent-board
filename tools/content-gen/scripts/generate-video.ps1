# generate-video.ps1 — Drive MoneyPrinterTurbo via REST API
# Called by the /content-gen Claude skill.
param(
    [Parameter(Mandatory=$true)]
    [string]$Topic,

    [ValidateSet("portrait","landscape")]
    [string]$Aspect = "portrait",

    [string]$Language = "en",

    [ValidateRange(1, 5)]
    [int]$Count = 1,

    [string]$Script = "",       # optional custom script; skips LLM if provided

    [ValidateSet("on","off")]
    [string]$Subtitles = "on",

    [string]$Voice = "en-US-AriaNeural",   # Edge TTS voice name

    [string]$VideoTerms = "",   # comma-separated; if set, skips LLM terms lookup

    [switch]$KeepRunning        # skip the auto-stop at the end
)

$ErrorActionPreference = "Stop"
$mptDir = Join-Path (Split-Path $PSScriptRoot -Parent) "MoneyPrinterTurbo"
$apiBase = "http://localhost:8080"
$pollInterval = 8   # seconds between status checks
$startupTimeout = 90  # seconds to wait for container readiness

# ── helpers ──────────────────────────────────────────────────────────────────

function Write-Step { param($msg) Write-Host "`n[$([datetime]::Now.ToString('HH:mm:ss'))] $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "  ✗ $msg" -ForegroundColor Red }

function Wait-ForApi {
    Write-Step "Waiting for MoneyPrinterTurbo API..."
    $deadline = [datetime]::Now.AddSeconds($startupTimeout)
    while ([datetime]::Now -lt $deadline) {
        try {
            $null = Invoke-RestMethod -Uri "$apiBase/" -TimeoutSec 3
            Write-Ok "API is ready."
            return $true
        } catch { Start-Sleep 3 }
    }
    return $false
}

function Is-ContainerRunning {
    $running = docker ps --filter "name=moneyprinterturbo-api" --format "{{.Names}}" 2>$null
    return ($running -match "moneyprinterturbo-api")
}

function Stop-Container {
    Write-Step "Stopping MoneyPrinterTurbo container..."
    Push-Location $mptDir
    docker compose stop 2>&1 | Write-Host
    Pop-Location
    Write-Ok "Container stopped."
}

# ── 1. Ensure Docker is up ────────────────────────────────────────────────────

Write-Step "Checking Docker container..."

if (Is-ContainerRunning) {
    Write-Ok "Container already running."
} else {
    Write-Step "Starting MoneyPrinterTurbo via docker compose..."
    Push-Location $mptDir
    docker compose up -d 2>&1 | Write-Host
    Pop-Location

    if (-not (Wait-ForApi)) {
        Write-Fail "API did not become available within $startupTimeout seconds."
        Write-Host "Check logs: docker compose -f $mptDir\docker-compose.yml logs"
        exit 1
    }
}

# ── 2. Submit video generation job ───────────────────────────────────────────

Write-Step "Submitting job: `"$Topic`" ($Aspect, lang=$Language, count=$Count)..."

$aspectRatio = @{ portrait = "9:16"; landscape = "16:9" }[$Aspect]

$body = @{
    video_subject       = $Topic
    video_language      = $Language
    video_aspect        = $aspectRatio
    video_count         = $Count
    subtitle_enabled    = ($Subtitles -eq "on")
    voice_name          = $Voice
}
if ($Script)      { $body.video_script = $Script }
if ($VideoTerms)  { $body.video_terms  = ($VideoTerms -split ",").Trim() }

try {
    $resp = Invoke-RestMethod -Uri "$apiBase/api/v1/videos" `
        -Method POST `
        -Body ($body | ConvertTo-Json -Depth 3) `
        -ContentType "application/json"
} catch {
    Write-Fail "Failed to submit job: $_"
    exit 1
}

$taskId = $resp.data.task_id
if (-not $taskId) {
    Write-Fail "No task_id in response: $($resp | ConvertTo-Json)"
    exit 1
}
Write-Ok "Task submitted: $taskId"

# ── 3. Poll until complete ────────────────────────────────────────────────────

Write-Step "Waiting for video(s) to render..."
$dots = 0

while ($true) {
    Start-Sleep $pollInterval

    try {
        $status = Invoke-RestMethod -Uri "$apiBase/api/v1/tasks/$taskId" -TimeoutSec 10
    } catch {
        $errMsg = $_.ToString()
        if ($errMsg -match "404|task not found|Not Found") {
            Write-Host ""
            Write-Fail "Task $taskId no longer exists (container may have restarted). Re-submit the job."
            if (-not $KeepRunning) { Stop-Container }
            exit 1
        }
        Write-Warn "Poll error (will retry): $_"
        continue
    }

    $state    = $status.data.state
    $progress = $status.data.progress

    # progress indicator
    $dots++
    $bar = ("#" * [math]::Floor($progress / 5)).PadRight(20)
    Write-Host "`r  [$bar] $progress%  state=$state   " -NoNewline

    if ($state -eq "complete" -or $state -eq "completed" -or $state -eq 1) {
        Write-Host ""   # flush the inline line
        break
    }
    if ($state -eq "failed" -or $state -eq "error" -or $state -eq -1) {
        Write-Host ""
        Write-Fail "Generation failed. Raw status:"
        $status | ConvertTo-Json -Depth 5 | Write-Host
        if (-not $KeepRunning) { Stop-Container }
        exit 1
    }
}

# ── 4. Report results ─────────────────────────────────────────────────────────

Write-Step "Done! Generated video(s):"

$videos = $status.data.combined_videos
if (-not $videos -or $videos.Count -eq 0) {
    $videos = $status.data.videos
}

if ($videos -and $videos.Count -gt 0) {
    foreach ($v in $videos) {
        $url = "$apiBase/tasks/$taskId/$v"
        Write-Ok $url
        Write-Host "  Download: Invoke-WebRequest '$url' -OutFile '$(Split-Path $v -Leaf)'"
    }
} else {
    Write-Warn "Videos not yet indexed in status. Browse: $apiBase/tasks/$taskId/"
    Write-Host "  Or check the UI at http://localhost:8501"
}

# ── 5. Auto-stop container ────────────────────────────────────────────────────

if (-not $KeepRunning) {
    Stop-Container
}
