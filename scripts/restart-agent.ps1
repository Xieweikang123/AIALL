param()
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path $PSScriptRoot -Parent
$srcTauri = Join-Path $root "src-tauri"
$exe = Join-Path $srcTauri "target\debug\agent-server.exe"
Set-Location $srcTauri
Write-Host "[watch] building agent-server..." -ForegroundColor Cyan
cargo build --bin agent-server
if ($LASTEXITCODE -ne 0) {
  Write-Host "[watch] build failed, keeping old backend" -ForegroundColor Red
  exit 0
}
Write-Host "[watch] restarting agent-server..." -ForegroundColor Green
try { Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force } } catch {}
Start-Sleep 1
Start-Process -FilePath $exe -WindowStyle Hidden
Write-Host "[watch] agent-server restarted (8787)" -ForegroundColor Green
