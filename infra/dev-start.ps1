# Start the whole ZONM NET stack for local testing, each part in its own window:
#   PostgreSQL 16 (infra/devdb), Redis (infra/devredis), the analysis engine
#   (port 8000), the job worker, and the web app (http://localhost:3100).
#   powershell -ExecutionPolicy Bypass -File H:\zonm-net\infra\dev-start.ps1
# First run only: cd infra\devdb; npm install  and  infra\devredis\install.ps1
# Close a window (or press Ctrl+C in it) to stop that part.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Start-Part($title, $dir, $command) {
  Start-Process powershell -WorkingDirectory $dir -ArgumentList "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = 'ZONM: $title'; $command"
}

function Test-Port($port) {
  try { $c = New-Object Net.Sockets.TcpClient; $c.Connect("127.0.0.1", $port); $c.Close(); return $true } catch { return $false }
}

if (-not (Test-Port 5432)) { Start-Part "PostgreSQL" "$root\infra\devdb" "npm start" } else { Write-Host "PostgreSQL already running" }
if (-not (Test-Port 6379)) { Start-Part "Redis" "$root\infra\devredis" "powershell -ExecutionPolicy Bypass -File .\start.ps1" } else { Write-Host "Redis already running" }
if (-not (Test-Port 8000)) { Start-Part "Engine" "$root\services\engine" ".\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000" } else { Write-Host "Engine already running" }

Write-Host "Waiting for the database and Redis..."
for ($i = 0; $i -lt 60 -and -not ((Test-Port 5432) -and (Test-Port 6379)); $i++) { Start-Sleep -Seconds 1 }

Start-Part "Worker" "$root\apps\web" "npm run worker"
if (-not (Test-Port 3100)) {
  Start-Part "Web" "$root\apps\web" "if (-not (Test-Path .next\BUILD_ID)) { npm run build }; npx next start -p 3100"
} else { Write-Host "Web app already running" }

Write-Host "Starting. Open http://localhost:3100 in a minute."
