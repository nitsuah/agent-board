# One-time setup for site-gen
# Run from C:\Users\ajhar\code\site-gen\
# Keys are read from .env in the same directory.
param(
    [string]$YelpKey          = "",
    [string]$GooglePlacesKey  = "",
    [string]$YourName         = "",
    [string]$YourEmail        = "",
    [string]$YourPhone        = "",
    [string]$YourCompany      = ""
)

$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot

Write-Host "`n=== site-gen setup ===" -ForegroundColor Cyan

# ── Load .env ────────────────────────────────────────────────────────────────
$envFile = Join-Path $projectDir ".env"
$env = @{}
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match '^\s*[^#]\S+=\S' } | ForEach-Object {
        $parts = $_ -split '=', 2
        $env[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
    }
    Write-Host "Loaded .env" -ForegroundColor Green
}

# CLI params override .env
if (-not $YelpKey)         { $YelpKey        = $env['YELP_API_KEY'] ?? "" }
if (-not $GooglePlacesKey) { $GooglePlacesKey = $env['GOOGLE_PLACES_API_KEY'] ?? "" }
if (-not $YourName)        { $YourName       = $env['YOUR_NAME'] ?? "" }
if (-not $YourEmail)       { $YourEmail      = $env['YOUR_EMAIL'] ?? "" }
if (-not $YourPhone)       { $YourPhone      = $env['YOUR_PHONE'] ?? "" }
if (-not $YourCompany)     { $YourCompany    = $env['YOUR_COMPANY'] ?? "Your Web Agency" }

# ── 1. Check Node.js ─────────────────────────────────────────────────────────
$nodeVer = node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Node.js not found. Install from https://nodejs.org or via Docker Desktop." -ForegroundColor Red
    exit 1
}
Write-Host "✓ Node.js $nodeVer" -ForegroundColor Green

# ── 2. Install Netlify CLI ────────────────────────────────────────────────────
$netlifyVer = netlify --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing netlify-cli globally..." -ForegroundColor Yellow
    npm install -g netlify-cli
    Write-Host "✓ netlify-cli installed" -ForegroundColor Green
} else {
    Write-Host "✓ netlify-cli $netlifyVer" -ForegroundColor Green
}

# ── 3. Write .env if keys provided ────────────────────────────────────────────
if ($YelpKey -or $GooglePlacesKey -or $YourName) {
    $lines = @(
        "YELP_API_KEY=$YelpKey",
        "GOOGLE_PLACES_API_KEY=$GooglePlacesKey",
        "YOUR_NAME=$YourName",
        "YOUR_COMPANY=$YourCompany",
        "YOUR_EMAIL=$YourEmail",
        "YOUR_PHONE=$YourPhone",
        "PRICE_SETUP=500",
        "PRICE_MONTHLY=50"
    )
    $lines | Set-Content $envFile
    Write-Host "✓ .env written" -ForegroundColor Green
}

# ── 4. Create output dir ──────────────────────────────────────────────────────
$outputDir = Join-Path $projectDir "output"
New-Item -ItemType Directory -Force $outputDir | Out-Null
Write-Host "✓ output/ ready" -ForegroundColor Green

# ── 5. Summary ────────────────────────────────────────────────────────────────
$hasYelp   = if ($YelpKey)        { "✓ set" } else { "✗ missing (add to .env)" }
$hasGoogle = if ($GooglePlacesKey){ "✓ set" } else { "— optional" }

Write-Host @"

=== Configuration ===
  Yelp API key:          $hasYelp
  Google Places API key: $hasGoogle
  Your name:             $(if ($YourName) { $YourName } else { '✗ missing' })
  Your email:            $(if ($YourEmail) { $YourEmail } else { '✗ missing' })

=== Next steps ===
1. Run: netlify login   (one-time browser auth)
2. Discover leads:
     /site-gen discover 90210 restaurant
3. Build and deploy:
     /site-gen full 90210 restaurant

Get a free Yelp key: https://www.yelp.com/developers/v3/manage_app
"@ -ForegroundColor Cyan
