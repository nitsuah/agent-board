# Discover local businesses that need a website
# Output: JSON file at output/leads-{zip}-{category}-{date}.json
#
# Priority targets:
#   HIGH   — no website listed at all
#   MEDIUM — website listed but likely outdated (low reviews + old biz)
#   LOW    — has a website (still citable for upgrade pitch)
param(
    [Parameter(Mandatory)]
    [string]$Zip,

    [string]$Category     = "restaurants",
    [int]   $Radius       = 5,          # miles
    [int]   $MaxResults   = 40,
    [switch]$NoWebsiteOnly,             # only return businesses without a website
    # OutputDir defaults to ../output relative to this script's location so it
    # resolves correctly both on the host and inside the Docker container
    # (/app/scripts/../output == /app/output, which is the mounted volume).
    [string]$OutputDir    = ""
)

$ErrorActionPreference = "Stop"
$projectDir  = $PSScriptRoot
$outputDir   = if ($OutputDir) { $OutputDir } else { Join-Path $PSScriptRoot ".." "output" }
New-Item -ItemType Directory -Force $outputDir | Out-Null

# ── Load .env ─────────────────────────────────────────────────────────────────
$envFile = Join-Path $projectDir ".." ".env"
$cfg = @{}
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match '^\s*[^#]\S+=\S' } | ForEach-Object {
        $parts = $_ -split '=', 2
        $cfg[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
    }
}
$YelpKey         = $env:YELP_API_KEY         ?? $cfg['YELP_API_KEY'] ?? ""
$GooglePlacesKey = $env:GOOGLE_PLACES_API_KEY ?? $cfg['GOOGLE_PLACES_API_KEY'] ?? ""

# ── Category aliases ───────────────────────────────────────────────────────────
# Maps friendly names → Yelp category aliases + Google Places types
$categoryMap = @{
    "restaurants"   = @{ yelp = "restaurants";      google = "restaurant" }
    "restaurant"    = @{ yelp = "restaurants";      google = "restaurant" }
    "auto"          = @{ yelp = "auto";             google = "car_repair" }
    "automotive"    = @{ yelp = "auto";             google = "car_repair" }
    "realestate"    = @{ yelp = "realestatesvcs";   google = "real_estate_agency" }
    "real-estate"   = @{ yelp = "realestatesvcs";   google = "real_estate_agency" }
    "retail"        = @{ yelp = "shopping";         google = "store" }
    "health"        = @{ yelp = "health";           google = "doctor" }
    "dental"        = @{ yelp = "dentists";         google = "dentist" }
    "beauty"        = @{ yelp = "beautysvc";        google = "beauty_salon" }
    "salon"         = @{ yelp = "beautysvc";        google = "hair_care" }
    "gym"           = @{ yelp = "gyms";             google = "gym" }
    "fitness"       = @{ yelp = "gyms";             google = "gym" }
    "legal"         = @{ yelp = "lawyers";          google = "lawyer" }
    "accounting"    = @{ yelp = "accountants";      google = "accounting" }
    "contractor"    = @{ yelp = "contractors";      google = "general_contractor" }
    "plumber"       = @{ yelp = "plumbing";         google = "plumber" }
    "electrician"   = @{ yelp = "electricians";     google = "electrician" }
    "landscaping"   = @{ yelp = "landscaping";      google = "florist" }
    "cleaning"      = @{ yelp = "homecleaning";     google = "cleaning" }
    "hvac"          = @{ yelp = "heating_air";      google = "general_contractor" }
    "catering"      = @{ yelp = "caterers";         google = "meal_catering" }
    "photography"   = @{ yelp = "photographers";    google = "photographer" }
    "bakery"        = @{ yelp = "bakeries";         google = "bakery" }
    "coffee"        = @{ yelp = "coffee";           google = "cafe" }
    "bar"           = @{ yelp = "bars";             google = "bar" }
    "childcare"     = @{ yelp = "childcare";        google = "child_care_agency" }
    "tutoring"      = @{ yelp = "tutoring";         google = "tutoring_service" }
    "veterinary"    = @{ yelp = "veterinarians";    google = "veterinary_care" }
    "tax"           = @{ yelp = "taxservices";      google = "accounting" }
    "insurance"     = @{ yelp = "insurance";        google = "insurance_agency" }
}

$catEntry = $categoryMap[$Category.ToLower()]
if (-not $catEntry) {
    Write-Host "⚠ Unknown category '$Category'. Supported: $($categoryMap.Keys -join ', ')" -ForegroundColor Yellow
    Write-Host "  Falling back to raw category value." -ForegroundColor Yellow
    $catEntry = @{ yelp = $Category; google = $Category }
}

$radiusMeters = [int]($Radius * 1609.34)
$leads = @()
$source = "none"

# ── Yelp Fusion API ───────────────────────────────────────────────────────────
if ($YelpKey) {
    Write-Host "Querying Yelp for '$($catEntry.yelp)' near $Zip..." -ForegroundColor Cyan
    try {
        $headers  = @{ Authorization = "Bearer $YelpKey" }
        $uri      = "https://api.yelp.com/v3/businesses/search"
        $body     = @{
            location   = $Zip
            categories = $catEntry.yelp
            limit      = [Math]::Min($MaxResults, 50)
            radius     = [Math]::Min($radiusMeters, 40000)
            sort_by    = "rating"
        }
        $resp = Invoke-RestMethod -Uri $uri -Method GET -Headers $headers -Body $body
        $source = "yelp"

        foreach ($biz in $resp.businesses) {
            $hasWebsite = $biz.url -and -not ($biz.url -match "yelp\.com")
            $priority   = if (-not $hasWebsite)            { "HIGH" }
                         elseif ($biz.review_count -lt 10)  { "MEDIUM" }
                         else                               { "LOW" }

            if ($NoWebsiteOnly -and $hasWebsite) { continue }

            $slug = ($biz.name -replace '[^a-zA-Z0-9]', '-').ToLower().Trim('-') + "-" + $Zip

            $leads += [PSCustomObject]@{
                id            = $biz.id
                slug          = $slug
                name          = $biz.name
                phone         = $biz.phone
                email         = $null
                address       = ($biz.location.display_address -join ", ")
                city          = $biz.location.city
                state         = $biz.location.state
                zip           = $biz.location.zip_code
                website       = if ($hasWebsite) { $biz.url } else { $null }
                yelp_url      = "https://www.yelp.com/biz/" + $biz.alias
                rating        = $biz.rating
                review_count  = $biz.review_count
                categories    = ($biz.categories | ForEach-Object { $_.alias })
                has_website   = $hasWebsite
                pitch_priority = $priority
                source        = "yelp"
            }
        }
        Write-Host "✓ Found $($leads.Count) businesses via Yelp" -ForegroundColor Green
    } catch {
        Write-Host "✗ Yelp error: $_" -ForegroundColor Red
    }
}

# ── Google Places API (fallback or supplement) ────────────────────────────────
if (-not $leads -and $GooglePlacesKey) {
    Write-Host "Querying Google Places for '$($catEntry.google)' near $Zip..." -ForegroundColor Cyan
    try {
        $uri  = "https://maps.googleapis.com/maps/api/place/textsearch/json"
        $body = @{
            query  = "$Category near $Zip"
            type   = $catEntry.google
            key    = $GooglePlacesKey
        }
        $resp   = Invoke-RestMethod -Uri $uri -Method GET -Body $body
        $source = "google"

        foreach ($place in $resp.results | Select-Object -First $MaxResults) {
            $hasWebsite = [bool]$place.website
            $priority   = if (-not $hasWebsite) { "HIGH" } else { "LOW" }

            if ($NoWebsiteOnly -and $hasWebsite) { continue }

            $slug = ($place.name -replace '[^a-zA-Z0-9]', '-').ToLower().Trim('-') + "-" + $Zip

            $leads += [PSCustomObject]@{
                id             = $place.place_id
                slug           = $slug
                name           = $place.name
                phone          = $null
                email          = $null
                address        = $place.formatted_address
                city           = $null
                state          = $null
                zip            = $Zip
                website        = $place.website
                yelp_url       = $null
                rating         = $place.rating
                review_count   = $place.user_ratings_total
                categories     = @($catEntry.google)
                has_website    = $hasWebsite
                pitch_priority = $priority
                source         = "google"
            }
        }
        Write-Host "✓ Found $($leads.Count) businesses via Google Places" -ForegroundColor Green
    } catch {
        Write-Host "✗ Google Places error: $_" -ForegroundColor Red
    }
}

# ── No API keys — output search guidance ─────────────────────────────────────
if (-not $leads) {
    Write-Host ""
    Write-Host "⚠ NO_API_KEYS — no results fetched from APIs." -ForegroundColor Yellow
    Write-Host "  To fix: add YELP_API_KEY to .env (free at https://www.yelp.com/developers)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "FALLBACK_SEARCH_URLS:" -ForegroundColor Cyan
    Write-Host "  Google Maps: https://www.google.com/maps/search/$($Category.Replace(' ','+'))+near+$Zip"
    Write-Host "  Yelp:        https://www.yelp.com/search?cflt=$($catEntry.yelp)&find_loc=$Zip"
    Write-Host "  Use Playwright or WebSearch to scrape these and return structured lead data."
    exit 0
}

# ── Score and sort ─────────────────────────────────────────────────────────────
$sorted = $leads | Sort-Object @{E={
    switch ($_.pitch_priority) {
        "HIGH"   { 0 }
        "MEDIUM" { 1 }
        "LOW"    { 2 }
    }
}}, @{E={ $_.rating }}

# ── Write output ───────────────────────────────────────────────────────────────
$date     = Get-Date -Format "yyyyMMdd"
$outFile  = Join-Path $outputDir "leads-$Zip-$($Category.ToLower())-$date.json"
$payload  = @{
    search = @{ zip = $Zip; category = $Category; date = $date; radius_miles = $Radius; source = $source }
    summary = @{
        total  = $sorted.Count
        high   = ($sorted | Where-Object { $_.pitch_priority -eq "HIGH" }).Count
        medium = ($sorted | Where-Object { $_.pitch_priority -eq "MEDIUM" }).Count
        low    = ($sorted | Where-Object { $_.pitch_priority -eq "LOW" }).Count
    }
    leads = $sorted
}
$payload | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $outFile

Write-Host ""
Write-Host "=== LEAD SUMMARY ===" -ForegroundColor Cyan
Write-Host "  Total:          $($payload.summary.total)"
Write-Host "  HIGH priority:  $($payload.summary.high)  (no website)"
Write-Host "  MEDIUM priority: $($payload.summary.medium)"
Write-Host "  LOW priority:   $($payload.summary.low)"
Write-Host ""
foreach ($lead in ($sorted | Where-Object { $_.pitch_priority -eq "HIGH" } | Select-Object -First 10)) {
    Write-Host "→ LEAD: $($lead.name) | $($lead.address) | $($lead.phone) | NO WEBSITE" -ForegroundColor Yellow
}
foreach ($lead in ($sorted | Where-Object { $_.pitch_priority -eq "MEDIUM" } | Select-Object -First 5)) {
    Write-Host "→ LEAD: $($lead.name) | $($lead.address) | $($lead.phone) | rating: $($lead.rating)" -ForegroundColor White
}
Write-Host ""
Write-Host "✓ Saved: $outFile" -ForegroundColor Green
