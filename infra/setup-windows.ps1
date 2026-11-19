# ZONM NET - one-time Windows dev setup. Run in an ELEVATED PowerShell (Run as Administrator):
#   powershell -ExecutionPolicy Bypass -File H:\zonm-net\infra\setup-windows.ps1
# Installs: PostgreSQL 16 (native), Memurai (Redis-compatible, native), WSL2 + Docker Desktop.
# A reboot is needed afterwards for WSL/Docker Desktop.

$ErrorActionPreference = "Continue"

Write-Host "== PostgreSQL 16 (Chocolatey; winget's EnterpriseDB download returns 403) ==" -ForegroundColor Cyan
choco install postgresql16 -y --params "/Password:zonm_dev_password /Port:5432"

Write-Host "== Memurai Developer (Redis for Windows) ==" -ForegroundColor Cyan
winget install --id Memurai.MemuraiDeveloper -e --accept-package-agreements --accept-source-agreements

Write-Host "== WSL2 (required by Docker Desktop) ==" -ForegroundColor Cyan
wsl --install --no-distribution

Write-Host "== Docker Desktop ==" -ForegroundColor Cyan
winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements

Write-Host "== Create zonm database and user ==" -ForegroundColor Cyan
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
if (Test-Path $psql) {
  $env:PGPASSWORD = "zonm_dev_password"
  & $psql -U postgres -h localhost -c "CREATE ROLE zonm LOGIN PASSWORD 'zonm_dev_password' CREATEDB;"
  & $psql -U postgres -h localhost -c "CREATE DATABASE zonm OWNER zonm;"
} else {
  Write-Host "psql not found - PostgreSQL install may have failed." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done. Reboot Windows to finish WSL / Docker Desktop setup." -ForegroundColor Green
