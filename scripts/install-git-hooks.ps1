Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot\..
git config core.hooksPath .githooks
Write-Host "Git hooks path set to .githooks"
Write-Host "pre-commit hook will now run dashboard tests via Docker."
