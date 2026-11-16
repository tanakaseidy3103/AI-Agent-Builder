<#
.SYNOPSIS
  Stop the homelab demo in a safe order: public access first, then the API, then (optionally) free the model's RAM.

.DESCRIPTION
  1. Stops the Cloudflare tunnel: from this moment nobody outside can reach the laptop.
  2. Stops the demo API process started by start-demo.ps1 (only that PID, after checking it is that process).
     A generation still running is cut; the next start marks it "interrupted" for the visitor.
  3. Asks Ollama to unload the model now (frees ~5.5 GB) unless -KeepModel. Ollama itself keeps running.
  4. Leaves PostgreSQL running (the local Studio uses it too) unless -StopDatabase.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\homelab\stop-demo.ps1
  powershell -ExecutionPolicy Bypass -File deploy\homelab\stop-demo.ps1 -PublicOnly       # keep it running locally
#>
param([switch]$PublicOnly, [switch]$KeepModel, [switch]$StopDatabase)
$ErrorActionPreference = "Continue"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$State = Join-Path $env:LOCALAPPDATA "aab-homelab"

function StopOwned($pidFile, $expectedName) {
  if (-not (Test-Path $pidFile)) { return $false }
  $id = [int](Get-Content $pidFile)
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq $expectedName) {
    # /T: the whole tree. A virtualenv's python.exe on Windows is a launcher that runs the real interpreter as a
    # child; stopping only the launcher would leave uvicorn listening.
    taskkill /PID $id /T /F | Out-Null
    $p.WaitForExit(15000) | Out-Null
    Write-Host "    stopped $expectedName (PID $id and its child processes)"
  } elseif ($p) {
    Write-Host "    PID $id is now '$($p.ProcessName)', not ${expectedName}: left untouched"
  }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  return $true
}

Write-Host "==> Public access (Cloudflare tunnel)" -ForegroundColor Cyan
if (-not (StopOwned (Join-Path $State "tunnel.pid") "cloudflared")) { Write-Host "    no tunnel was running" }
Remove-Item (Join-Path $State "public-url.txt") -ErrorAction SilentlyContinue
if ($PublicOnly) { Write-Host "Public access is off; the demo still runs locally."; exit 0 }

Write-Host "==> Demo API" -ForegroundColor Cyan
if (-not (StopOwned (Join-Path $State "api.pid") "python")) { Write-Host "    no demo API was running" }
Remove-Item (Join-Path $State "port") -ErrorAction SilentlyContinue

if (-not $KeepModel) {
  Write-Host "==> Unload the model from memory (Ollama keeps running)" -ForegroundColor Cyan
  try {
    $body = '{"model": "qwen2.5-coder:latest", "keep_alive": 0}'
    Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/generate" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 30 | Out-Null
    Write-Host "    unloaded"
  } catch { Write-Host "    Ollama not reachable (nothing to unload)" }
}

if ($StopDatabase) {
  Write-Host "==> PostgreSQL" -ForegroundColor Cyan
  Push-Location $Repo; docker compose stop db | Out-Null; Pop-Location
  Write-Host "    stopped (the local Studio uses it too)"
}
Write-Host "Demo stopped." -ForegroundColor Green
