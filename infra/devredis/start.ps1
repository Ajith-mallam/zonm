# Local Redis for development (portable Windows build, no admin rights needed).
#   powershell -ExecutionPolicy Bypass -File infra\devredis\start.ps1
# Listens on 127.0.0.1:6379 only. Data is kept in infra\devredis\data.
# Install the binaries first with infra\devredis\install.ps1.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Get-ChildItem -Path (Join-Path $here "bin") -Recurse -Filter "redis-server.exe" | Select-Object -First 1
if (-not $server) { throw "redis-server.exe not found. Run infra\devredis\install.ps1 first." }
$data = Join-Path $here "data"
New-Item -ItemType Directory -Force -Path $data | Out-Null
& $server.FullName --bind 127.0.0.1 --port 6379 --protected-mode yes --dir $data --appendonly yes --save 60 1
