# Start Math-Checker when Ollama is reachable via SSH tunnel on localhost:11435.
# Uses port 11435 locally so it does not conflict with local Ollama on 11434.
#
# Prerequisite: in another PowerShell window, keep this running:
#   ssh -L 11435:127.0.0.1:11434 root@194.68.245.167 -p 22057 -i C:\Users\rohit\.ssh\id_ed25519

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$TunnelPort = 11435
$RemotePort = 11434
$OllamaUrl = "http://127.0.0.1:$TunnelPort"

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

Write-Host "Checking Ollama tunnel on $OllamaUrl ..." -ForegroundColor Cyan

try {
    Invoke-RestMethod -Uri "$OllamaUrl/api/tags" -Method Get -TimeoutSec 10 | Out-Null
    Write-Host "Ollama tunnel OK" -ForegroundColor Green
}
catch {
    Write-Host "Ollama not reachable on $OllamaUrl" -ForegroundColor Red
    Write-Host "Open another PowerShell window and run the SSH tunnel first:" -ForegroundColor Yellow
    Write-Host "  ssh -L ${TunnelPort}:127.0.0.1:${RemotePort} root@194.68.245.167 -p 22057 -i C:\Users\rohit\.ssh\id_ed25519"
    Write-Host ""
    Write-Host "Tip: local Ollama keeps port 11434 busy on Windows. This script uses 11435 instead." -ForegroundColor Yellow
    exit 1
}

Write-Host "Updating .env.local for SSH tunnel on port $TunnelPort ..." -ForegroundColor Yellow

$envLines = @(
    "OLLAMA_URL=$OllamaUrl",
    "OLLAMA_MODEL=qwen3-vl:2b-instruct",
    "OLLAMA_FAST_MODE=true",
    "OLLAMA_KEEP_ALIVE=30m"
)
Set-Content -Path ".env.local" -Value $envLines -Encoding utf8

Write-Host "Building Math-Checker ..." -ForegroundColor Cyan
npm run build

Write-Host "Starting Math-Checker at http://localhost:3000" -ForegroundColor Green
Write-Host "Keep the SSH tunnel window open while using the app." -ForegroundColor Yellow
npm run start -- --hostname 0.0.0.0
