<#
.SYNOPSIS
  Show whether the homelab demo is up, its readiness, the public URL and whether the model is loaded in memory.
#>
$State = Join-Path $env:LOCALAPPDATA "aab-homelab"
$port = if (Test-Path (Join-Path $State "port")) { [int](Get-Content (Join-Path $State "port")) } else { 8100 }
try {
  $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health/ready" -TimeoutSec 15
  Write-Host "Demo API on 127.0.0.1:$port : $($r.status) (database=$($r.checks.database), sandbox=$($r.checks.sandbox), model server=$($r.checks.model))"
  $s = Invoke-RestMethod -Uri "http://127.0.0.1:$port/demo/status" -TimeoutSec 15
  Write-Host "Queue: $($s.queue)/$($s.queue_max)   access code required: $($s.access_code_required)"
} catch { Write-Host "Demo API on 127.0.0.1:$port : not running" }
$url = Get-Content (Join-Path $State "public-url.txt") -ErrorAction SilentlyContinue
if ($url) {
  $tp = Get-Content (Join-Path $State "tunnel.pid") -ErrorAction SilentlyContinue
  $alive = $tp -and (Get-Process -Id ([int]$tp) -ErrorAction SilentlyContinue)
  Write-Host "Public URL: $url  (tunnel process running: $([bool]$alive))"
} else { Write-Host "Public URL: off" }
try {
  $ps = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/ps" -TimeoutSec 5
  $loaded = @($ps.models | ForEach-Object { "$($_.name) ($([math]::Round($_.size / 1GB, 1)) GB)" })
  Write-Host "Model in memory: $(if ($loaded.Count) { $loaded -join ', ' } else { 'none (loads on the first generation)' })"
} catch { Write-Host "Ollama: not reachable" }
