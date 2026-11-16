<#
.SYNOPSIS
  Start the AI Agent Builder public demo on this laptop (homelab). See docs/DEPLOY_HOMELAB.md.

.DESCRIPTION
  Checks Docker, PostgreSQL, the sandbox image and Ollama; builds the demo frontend if needed; starts ONE process
  (uvicorn app.demo.app) that serves the site and the demo API on 127.0.0.1. With -Public it also opens a Cloudflare
  Quick Tunnel to that single port and prints the public URL. The Studio (port 8000), PostgreSQL, Ollama and Docker are
  never published. The model is not preloaded: Ollama loads it on the first generation and unloads it when idle.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\homelab\start-demo.ps1                 # local only: http://127.0.0.1:8100
  powershell -ExecutionPolicy Bypass -File deploy\homelab\start-demo.ps1 -Public         # + public https://<random>.trycloudflare.com
  powershell -ExecutionPolicy Bypass -File deploy\homelab\start-demo.ps1 -Public -AccessCode "hal-2026-demo"
#>
param(
  [switch]$Public,
  [string]$AccessCode = "",
  [int]$Port = 8100,
  [switch]$Rebuild
)
$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Api = Join-Path $Repo "apps\api"
$Web = Join-Path $Repo "apps\web"
$Site = Join-Path $Web "dist-homelab"
$State = Join-Path $env:LOCALAPPDATA "aab-homelab"
New-Item -ItemType Directory -Force $State | Out-Null
$OllamaUrl = "http://127.0.0.1:11434"
$Model = "qwen2.5-coder:latest"

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "ERROR: $text" -ForegroundColor Red; exit 1 }
function PortOwner($p) {
  $c = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $c) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
}
function WaitHttp($url, $seconds) {
  for ($i = 0; $i -lt $seconds; $i++) {
    try { return Invoke-RestMethod -Uri $url -TimeoutSec 5 } catch { Start-Sleep -Seconds 1 }
  }
  return $null
}

# 0. Already running? Never touch a process this script did not start.
$owner = PortOwner $Port
if ($null -ne $owner) {
  Fail "port $Port is already used by PID $($owner.ProcessId): $($owner.CommandLine). Stop it yourself or use -Port <free port>."
}

Step "Docker"
docker info --format "{{.ServerVersion}}" *> $null
if ($LASTEXITCODE -ne 0) { Fail "Docker is not running. Start Docker Desktop and run this script again." }

Step "PostgreSQL (docker compose service 'db', bound to 127.0.0.1 only)"
Push-Location $Repo
try {
  docker compose up -d db | Out-Null
  $healthy = $false
  for ($i = 0; $i -lt 60; $i++) {
    $h = docker inspect --format "{{.State.Health.Status}}" (docker compose ps -q db)
    if ($h -eq "healthy") { $healthy = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $healthy) { Fail "the database container did not become healthy (docker compose logs db)" }
  # SQL goes through stdin: Windows PowerShell 5.1 drops double quotes inside native arguments
  $pgUser = ("" + (docker compose exec -T db printenv POSTGRES_USER)).Trim()
  $exists = ("" + ("SELECT 1 FROM pg_database WHERE datname = 'aab_demo';" | docker compose exec -T db psql -U $pgUser -d postgres -tA)).Trim()
  if ($exists -ne "1") {
    "CREATE DATABASE aab_demo;" | docker compose exec -T db psql -U $pgUser -d postgres -q | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "could not create database aab_demo" }
    Write-Host "    created database aab_demo"
  } else { Write-Host "    database aab_demo exists" }
} finally { Pop-Location }

Step "Sandbox image"
docker image inspect python:3.12-slim *> $null
if ($LASTEXITCODE -ne 0) { docker pull python:3.12-slim; if ($LASTEXITCODE -ne 0) { Fail "could not pull python:3.12-slim" } }

Step "Ollama (the model is NOT preloaded; it loads on the first generation)"
$tags = WaitHttp "$OllamaUrl/api/tags" 2
if ($null -eq $tags) {
  $ollama = Get-Command ollama -ErrorAction SilentlyContinue
  if ($null -eq $ollama) { Fail "Ollama is not installed or not on PATH (https://ollama.com/download)" }
  Start-Process -FilePath $ollama.Source -ArgumentList "serve" -WindowStyle Hidden | Out-Null
  $tags = WaitHttp "$OllamaUrl/api/tags" 30
  if ($null -eq $tags) { Fail "Ollama did not answer on $OllamaUrl" }
}
if (-not ($tags.models | Where-Object { $_.name -eq $Model })) {
  Fail "model $Model is not installed. Run once: ollama pull $Model   (4.7 GB download)"
}

Step "Demo frontend (same-origin build: VITE_DEMO_MODE=true, VITE_API_BASE=/)"
if ($Rebuild -or -not (Test-Path (Join-Path $Site "index.html"))) {
  Push-Location $Web
  try {
    $env:VITE_DEMO_MODE = "true"; $env:VITE_API_BASE = "/"
    npx tsc --noEmit -p . ; if ($LASTEXITCODE -ne 0) { Fail "TypeScript check failed" }
    npx vite build --outDir dist-homelab --emptyOutDir ; if ($LASTEXITCODE -ne 0) { Fail "frontend build failed" }
  } finally {
    Remove-Item Env:VITE_DEMO_MODE, Env:VITE_API_BASE -ErrorAction SilentlyContinue
    Pop-Location
  }
} else { Write-Host "    using the existing build (-Rebuild to rebuild)" }

Step "Demo API + site on http://127.0.0.1:$Port (one process, one generation at a time)"
# The rest of the configuration (database, storage, limits) comes from apps\api\.env.demo.
$env:DEMO_STATIC_DIR = $Site
$env:DEMO_ALLOWED_HOSTS = "*.trycloudflare.com,localhost,127.0.0.1"
$env:DEMO_MAX_CONCURRENT_GENERATIONS = "1"
if ($AccessCode) { $env:DEMO_ACCESS_CODE = $AccessCode } else { Remove-Item Env:DEMO_ACCESS_CODE -ErrorAction SilentlyContinue }
$python = Join-Path $Api ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { Fail "backend virtualenv missing: cd apps\api; uv sync --frozen" }
$apiLog = Join-Path $State "api.log"
$apiProc = Start-Process -FilePath $python -WorkingDirectory $Api -WindowStyle Hidden -PassThru `
  -ArgumentList "-m", "uvicorn", "app.demo.app:app", "--host", "127.0.0.1", "--port", "$Port", "--workers", "1" `
  -RedirectStandardOutput $apiLog -RedirectStandardError (Join-Path $State "api.err.log")
Remove-Item Env:DEMO_STATIC_DIR, Env:DEMO_ALLOWED_HOSTS, Env:DEMO_MAX_CONCURRENT_GENERATIONS, Env:DEMO_ACCESS_CODE -ErrorAction SilentlyContinue
Set-Content -Path (Join-Path $State "api.pid") -Value $apiProc.Id
Set-Content -Path (Join-Path $State "port") -Value $Port
$ready = WaitHttp "http://127.0.0.1:$Port/health/ready" 120
if ($null -eq $ready) { Fail "the demo API did not start; see $State\api.err.log" }
Write-Host "    readiness: $($ready.status) (database=$($ready.checks.database), sandbox=$($ready.checks.sandbox), model=$($ready.checks.model))"

$publicUrl = ""
if ($Public) {
  & (Join-Path $PSScriptRoot "public-on.ps1") -Port $Port
  if ($LASTEXITCODE -ne 0) { Fail "the public tunnel did not start (the demo keeps running locally)" }
  $publicUrl = (Get-Content (Join-Path $State "public-url.txt") -ErrorAction SilentlyContinue | Select-Object -First 1)
}

Write-Host ""
Write-Host "AI Agent Builder demo is running." -ForegroundColor Green
Write-Host "  Local:   http://127.0.0.1:$Port"
if ($publicUrl) { Write-Host "  Public:  $publicUrl   (new address on every start; share it after each start)" -ForegroundColor Green }
else { Write-Host "  Public:  off (run again with -Public, or deploy\homelab\public-on.ps1)" }
if ($AccessCode) { Write-Host "  Access code required to create Skills: yes (tell it to the audience)" } else { Write-Host "  Access code: none (anyone with the URL can use the demo limits)" }
Write-Host "  Stop:    powershell -ExecutionPolicy Bypass -File deploy\homelab\stop-demo.ps1"
Write-Host "  Logs:    $State"
