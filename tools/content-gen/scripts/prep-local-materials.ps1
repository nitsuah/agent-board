# prep-local-materials.ps1
# Converts still images into 5-second portrait video clips using FFmpeg
# inside the MoneyPrinterTurbo Docker container.
# Output lands in MoneyPrinterTurbo/storage/local_materials/
# (mounted as /MoneyPrinterTurbo/storage/local_materials inside container)
param(
    [Parameter(Mandatory=$true)]
    [string[]]$ImagePaths,       # absolute paths to PNG/JPG source images

    [ValidateSet("portrait","landscape")]
    [string]$Aspect = "portrait",

    [int]$ClipDurationSecs = 5,

    [string]$Effect = "zoom"     # zoom | pan | static
)

$ErrorActionPreference = "Stop"
$mptDir = Join-Path $PSScriptRoot "MoneyPrinterTurbo"
$outputDir = Join-Path $mptDir "storage\local_materials"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$resolution = if ($Aspect -eq "portrait") { "1080x1920" } else { "1920x1080" }
$frames = $ClipDurationSecs * 25   # 25fps

function Write-Step { param($msg) Write-Host "`n[$([datetime]::Now.ToString('HH:mm:ss'))] $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }

# Ensure container is running (we need FFmpeg from inside it)
Write-Step "Checking MoneyPrinterTurbo container..."
$running = docker ps --filter "name=moneyprinterturbo-api" --format "{{.Names}}" 2>$null
if (-not ($running -match "moneyprinterturbo-api")) {
    Write-Step "Starting container..."
    Push-Location $mptDir
    docker compose up -d moneyprinterturbo-api 2>&1 | Write-Host
    Pop-Location
    Start-Sleep 5
}

$created = @()

foreach ($imgPath in $ImagePaths) {
    if (-not (Test-Path $imgPath)) {
        Write-Host "  ! Skipping missing file: $imgPath" -ForegroundColor Yellow
        continue
    }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($imgPath)
    $outName  = "${baseName}_clip.mp4"
    $outPath  = Join-Path $outputDir $outName

    # Copy source image into the container-accessible directory
    $stageDir  = Join-Path $mptDir "storage\stage"
    New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
    $stagedImg = Join-Path $stageDir (Split-Path $imgPath -Leaf)
    Copy-Item $imgPath $stagedImg -Force

    # Container paths (the MPT dir is mounted as /MoneyPrinterTurbo)
    $cIn  = "/MoneyPrinterTurbo/storage/stage/$(Split-Path $imgPath -Leaf)"
    $cOut = "/MoneyPrinterTurbo/storage/local_materials/$outName"

    # Dimensions split for filters that need W and H separately
    $wh = $resolution -split "x"
    $W  = $wh[0]; $H = $wh[1]

    # Build FFmpeg filter for effect
    $vf = switch ($Effect) {
        "zoom"   { "scale=8000:-1,zoompan=z='min(zoom+0.0005,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H},setsar=1" }
        "pan"    { "scale=-1:$H,crop=${W}:${H}:x='if(lte(on\,1)\,0\,min((iw-ow)*on/${frames}\,iw-ow))':y=0,setsar=1" }
        "static" { "scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1" }
    }

    Write-Step "Converting: $(Split-Path $imgPath -Leaf) → $outName ($Effect effect)"

    docker exec moneyprinterturbo-api ffmpeg -y `
        -loop 1 -framerate 25 -i $cIn `
        -vf $vf `
        -c:v libx264 -preset fast -crf 20 `
        -t $ClipDurationSecs -pix_fmt yuv420p `
        -an $cOut 2>&1 | Select-String -NotMatch "frame=|fps=|bitrate=|speed=|size=" | Write-Host

    if (Test-Path $outPath) {
        Write-Ok "$outName ($(([System.IO.FileInfo]$outPath).Length / 1KB -as [int]) KB)"
        $created += $outPath
    } else {
        Write-Host "  ! Failed: $outName" -ForegroundColor Red
    }
}

Write-Host "`n=== Done: $($created.Count) clip(s) in:" -ForegroundColor Green
Write-Host "  $outputDir"
Write-Host ""
Write-Host "To use these in generation, set in config.toml:"
Write-Host "  video_source = `"local`""
Write-Host "  material_directory = `"storage/local_materials`""
Write-Host ""
return $created
