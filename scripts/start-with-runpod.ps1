# Start Math-Checker when Ollama is reachable via SSH tunnel on localhost:11434.
# Prerequisite: in another PowerShell window, keep this running:
#   ssh -L 11434:127.0.0.1:11434 root@194.68.245.167 -p 22057 -i C:\Users\rohit\.ssh\id_ed25519

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

function Stop-PortListener {
    param([int]$Port)

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue

    foreach ($connection in $connections) {
        $processId = $connection.OwningProcess

        if ($processId -and $processId -ne 0) {
            Write-Host "Stopping process $processId using port $Port ..." -ForegroundColor Yellow
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

Stop-PortListener -Port 3000
Start-Sleep -Seconds 1

Write-Host "Checking Ollama tunnel on http://127.0.0.1:11434 ..." -ForegroundColor Cyan

try {
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get -TimeoutSec 10 | Out-Null
    Write-Host "Ollama tunnel OK" -ForegroundColor Green
}
catch {
    Write-Host "Ollama not reachable on localhost:11434" -ForegroundColor Red
    Write-Host "Open another PowerShell window and run the SSH tunnel first:" -ForegroundColor Yellow
    Write-Host '  ssh -L 11434:127.0.0.1:11434 root@194.68.245.167 -p 22057 -i C:\Users\rohit\.ssh\id_ed25519'
    exit 1
}

if (-not (Test-Path ".env.local")) {
    Write-Host "Creating .env.local for SSH tunnel setup ..." -ForegroundColor Yellow
    @"
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3-vl:2b-instruct
OLLAMA_FAST_MODE=true
OLLAMA_KEEP_ALIVE=30m
"@ | Set-Content -Path ".env.local" -Encoding utf8
}

Write-Host "Building Math-Checker ..." -ForegroundColor Cyan
npm run build

Write-Host "Starting Math-Checker at http://localhost:3000" -ForegroundColor Green
Write-Host "Keep the SSH tunnel window open while using the app." -ForegroundColor Yellow
npm run start -- --hostname 0.0.0.0
