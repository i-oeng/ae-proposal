param(
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker was not found. Install and start Docker Desktop, then run this script again."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker is installed but the Docker engine is not running. Start Docker Desktop and try again."
}

if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host "Created .env from .env.example." -ForegroundColor Yellow
    Write-Host "Add ANTHROPIC_API_KEY for real extraction and Supabase values for History." -ForegroundColor Yellow
}

$composeArgs = @("compose", "up", "-d")
if (-not $NoBuild) {
    $composeArgs += "--build"
}

& docker @composeArgs
if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose could not start the application. Run 'docker compose logs app' for details."
}

$apiPortMapping = (& docker compose port app 8000 | Select-Object -First 1).Trim()
$apiPort = $apiPortMapping.Split(":")[-1]
$n8nPortMapping = (& docker compose port n8n 5678 | Select-Object -First 1).Trim()
$n8nPort = $n8nPortMapping.Split(":")[-1]
$healthUrl = "http://127.0.0.1:$apiPort/health"
$healthy = $false
for ($attempt = 1; $attempt -le 45; $attempt++) {
    try {
        $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
        if ($response.status -eq "ok") {
            $healthy = $true
            break
        }
    } catch {
    }
    Start-Sleep -Seconds 2
}

if (-not $healthy) {
    docker compose ps
    throw "The containers started, but the API did not become healthy. Run 'docker compose logs app'."
}

Write-Host ""
Write-Host "Aspan Proposal Engine is ready." -ForegroundColor Green
Write-Host "Application: http://127.0.0.1:3000"
Write-Host "API health:  $healthUrl"
Write-Host "n8n:         http://127.0.0.1:$n8nPort"
Write-Host ""
Write-Host "Stop with: docker compose down"
