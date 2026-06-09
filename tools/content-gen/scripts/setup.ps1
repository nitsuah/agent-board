# One-time setup for content-gen / MoneyPrinterTurbo
# Run this once from C:\Users\ajhar\code\agent-board\tools\content-gen\scripts\
# Keys are read automatically from .env in the parent directory.
# CLI params override .env values if both are present.
param(
    [string]$PexelsKey = "",
    [string]$GeminiKey = "",
    [string]$AnthropicKey = ""
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path $PSScriptRoot -Parent
$mptDir = Join-Path $projectDir "MoneyPrinterTurbo"

function Write-Warn { param($msg) Write-Host "  ! $msg" -ForegroundColor Yellow }

Write-Host "`n=== content-gen setup ===" -ForegroundColor Cyan

# ── Load .env from the project directory ─────────────────────────────────────
$envFile = Join-Path $projectDir ".env"
$env = @{}
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match '^\s*[^#]\S+=\S' } | ForEach-Object {
        $parts = $_ -split '=', 2
        $env[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
    }
    Write-Host "Loaded keys from .env" -ForegroundColor Green
} else {
    Write-Warn "No .env file found at $envFile"
}

# .env wins, CLI overrides .env
if (-not $PexelsKey)    { $PexelsKey    = $env['PEXELS_API_KEY'] ?? $env['PEXEL_API_KEY'] ?? "" }
if (-not $GeminiKey)    { $GeminiKey    = $env['GEMINI_API_KEY'] ?? "" }
if (-not $AnthropicKey) { $AnthropicKey = $env['ANTHROPIC_API_KEY'] ?? "" }

# ── 1. Clone MoneyPrinterTurbo if not already present ────────────────────────
if (-not (Test-Path $mptDir)) {
    Write-Host "Cloning harry0703/MoneyPrinterTurbo (open-source video pipeline)..." -ForegroundColor Yellow
    git clone https://github.com/harry0703/MoneyPrinterTurbo.git $mptDir
} else {
    Write-Host "MoneyPrinterTurbo already cloned at $mptDir" -ForegroundColor Green
}

# ── 2. Create config.toml from template if not already present ───────────────
$configDest = Join-Path $mptDir "config.toml"
$configTemplate = Join-Path $projectDir "config.template.toml"

if (-not (Test-Path $configDest)) {
    Copy-Item $configTemplate $configDest
    Write-Host "Copied config.template.toml -> MoneyPrinterTurbo/config.toml" -ForegroundColor Green
} else {
    Write-Host "config.toml already exists, re-patching keys" -ForegroundColor Yellow
}

# ── 3. Patch in API keys ──────────────────────────────────────────────────────
if ($PexelsKey) {
    (Get-Content $configDest) -replace 'PEXELS_API_KEY_HERE', $PexelsKey | Set-Content $configDest
    Write-Host "  Pexels key set." -ForegroundColor Green
} else {
    Write-Host "  Pexels key missing — add PEXELS_API_KEY to .env" -ForegroundColor Yellow
}
if ($GeminiKey) {
    (Get-Content $configDest) -replace 'GEMINI_API_KEY_HERE', $GeminiKey | Set-Content $configDest
    Write-Host "  Gemini key set." -ForegroundColor Green
}
if ($AnthropicKey) {
    (Get-Content $configDest) -replace 'ANTHROPIC_API_KEY_HERE', $AnthropicKey | Set-Content $configDest
    Write-Host "  Anthropic key set." -ForegroundColor Green
}

Write-Host @"

=== Next steps ===
1. Open MoneyPrinterTurbo\config.toml and fill in any remaining API keys.
   Required: pexels_api_keys (inside [app] section), and an LLM provider key.
2. Run a test generation:
     /content-gen "5 tips for better sleep"
3. The skill auto-starts Docker and stops it when done.

Tip: get a free Pexels key at https://www.pexels.com/api/
Tip: get a free Gemini key at https://aistudio.google.com/app/apikey
"@ -ForegroundColor Cyan
