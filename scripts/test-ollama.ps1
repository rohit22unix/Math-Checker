# Test Ollama connection for Math-Checker (local or RunPod cloud GPU).
# Usage:
#   .\scripts\test-ollama.ps1
#   .\scripts\test-ollama.ps1 -Url "https://YOUR_POD_ID-11434.proxy.runpod.net"

param(
    [string]$Url = ""
)

$ErrorActionPreference = "Stop"

function Read-EnvLocal {
    param([string]$Key)

    $envFile = Join-Path (Get-Location) ".env.local"

    if (-not (Test-Path $envFile)) {
        return $null
    }

    foreach ($line in Get-Content $envFile) {
        if ($line -match "^\s*$Key\s*=\s*(.+)\s*$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }

    return $null
}

if (-not $Url) {
    $Url = Read-EnvLocal "OLLAMA_URL"
}

if (-not $Url) {
    $Url = "http://127.0.0.1:11434"
}

$Url = $Url.TrimEnd("/")
$Model = Read-EnvLocal "OLLAMA_MODEL"

if (-not $Model) {
    $Model = "qwen3-vl:2b-instruct"
}

Write-Host ""
Write-Host "Math-Checker Ollama connection test" -ForegroundColor Cyan
Write-Host "  URL:   $Url"
Write-Host "  Model: $Model"
Write-Host ""

Write-Host "[1/3] Listing models (/api/tags)..." -ForegroundColor Yellow

try {
    $tags = Invoke-RestMethod -Uri "$Url/api/tags" -Method Get -TimeoutSec 30
    $modelNames = @($tags.models | ForEach-Object { $_.name })

    if ($modelNames.Count -eq 0) {
        Write-Host "  WARNING: No models installed yet. On the pod run: ollama pull $Model" -ForegroundColor Red
    }
    else {
        Write-Host "  OK — installed models:" -ForegroundColor Green
        $modelNames | ForEach-Object { Write-Host "    - $_" }
    }

    if ($modelNames -notcontains $Model -and ($modelNames | Where-Object { $_ -like "$Model*" }).Count -eq 0) {
        Write-Host "  WARNING: '$Model' not found. Run: ollama pull $Model" -ForegroundColor Red
    }
}
catch {
    Write-Host "  FAILED — could not reach Ollama at $Url" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check:" -ForegroundColor Yellow
    Write-Host "  - RunPod pod is Running (not Stopped)"
    Write-Host "  - OLLAMA_URL in .env.local matches the RunPod proxy URL"
    Write-Host "  - Port 11434 is exposed and OLLAMA_HOST=0.0.0.0 on the pod"
    exit 1
}

Write-Host ""
Write-Host "[2/3] Warming model (/api/chat)..." -ForegroundColor Yellow

$chatBody = @{
    model    = $Model
    stream   = $false
    messages = @(
        @{
            role    = "user"
            content = "Reply with OK."
        }
    )
} | ConvertTo-Json -Depth 5

try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $chat = Invoke-RestMethod -Uri "$Url/api/chat" -Method Post -Body $chatBody -ContentType "application/json" -TimeoutSec 120
    $sw.Stop()
    $reply = $chat.message.content

    Write-Host "  OK — model responded in $($sw.Elapsed.TotalSeconds.ToString('0.0'))s" -ForegroundColor Green
    Write-Host "  Reply: $reply"
}
catch {
    Write-Host "  FAILED — chat request error" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[3/3] Checking processor (/api/ps)..." -ForegroundColor Yellow

try {
    $ps = Invoke-RestMethod -Uri "$Url/api/ps" -Method Get -TimeoutSec 15
    $loaded = $ps.models | Select-Object -First 1

    if ($loaded -and $loaded.size -and ($null -ne $loaded.size_vram)) {
        $gpuPercent = [math]::Round(($loaded.size_vram / $loaded.size) * 100)

        if ($gpuPercent -ge 80) {
            Write-Host "  OK — Processor: GPU ($gpuPercent% VRAM)" -ForegroundColor Green
        }
        elseif ($gpuPercent -le 5) {
            Write-Host "  WARNING — Processor: CPU (model not on GPU)" -ForegroundColor Red
        }
        else {
            Write-Host "  OK — Processor: hybrid ($gpuPercent% GPU)" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "  Model loaded but processor stats unavailable" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "  Skipped — /api/ps not available" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Connection test passed. Start Math-Checker:" -ForegroundColor Green
Write-Host "  npm run build"
Write-Host "  npm run start -- --hostname 0.0.0.0"
Write-Host ""
Write-Host "Remember to STOP your RunPod pod when finished to save money." -ForegroundColor Cyan
Write-Host ""
