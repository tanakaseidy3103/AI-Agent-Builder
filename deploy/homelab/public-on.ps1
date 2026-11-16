<#
.SYNOPSIS
  Publish the running demo through a Cloudflare Quick Tunnel (no account, no domain, no open router port).

.DESCRIPTION
  Points ONE tunnel at the demo process (site + /demo API on the same port). Prints and saves the public URL, which
  is random and changes every time the tunnel starts. Nothing else on this laptop is reachable through it.
  Called by start-demo.ps1 -Public; can also be run on its own while the demo is running locally.
#>
param([int]$Port = 0)
$ErrorActionPreference = "Stop"
$State = Join-Path $env:LOCALAPPDATA "aab-homelab"
if ($Port -eq 0) {
  $portFile = Join-Path $State "port"
  if (-not (Test-Path $portFile)) { Write-Host "ERROR: the demo is not running (start-demo.ps1 first)" -ForegroundColor Red; exit 1 }
  $Port = [int](Get-Content $portFile)
}
try { Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5 | Out-Null }
catch { Write-Host "ERROR: nothing answers on 127.0.0.1:$Port (start-demo.ps1 first)" -ForegroundColor Red; exit 1 }

$pidFile = Join-Path $State "tunnel.pid"
if (Test-Path $pidFile) {
  $old = Get-Process -Id ([int](Get-Content $pidFile)) -ErrorAction SilentlyContinue
  if ($old -and $old.ProcessName -eq "cloudflared") {
    Write-Host "A tunnel is already running: $(Get-Content (Join-Path $State 'public-url.txt') -ErrorAction SilentlyContinue)"
    exit 0
  }
}
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($null -eq $cf) { Write-Host "ERROR: cloudflared not found (winget install --id Cloudflare.cloudflared)" -ForegroundColor Red; exit 1 }

Write-Host "==> Cloudflare Quick Tunnel -> http://127.0.0.1:$Port (only this port is published)" -ForegroundColor Cyan
$log = Join-Path $State "tunnel.log"
if (Test-Path $log) { Remove-Item $log }
$tunnel = Start-Process -FilePath $cf.Source -WindowStyle Hidden -PassThru -RedirectStandardError $log `
  -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$Port"
Set-Content -Path $pidFile -Value $tunnel.Id
$url = ""
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
if (-not $url) {
  Write-Host "ERROR: no tunnel URL after 60 s (internet connection?). Details: $log" -ForegroundColor Red
  Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  exit 1
}
Set-Content -Path (Join-Path $State "public-url.txt") -Value $url
Write-Host "Public URL: $url" -ForegroundColor Green
Write-Host "It changes on every start. The first visitors may wait ~30 s while the address propagates."
exit 0
