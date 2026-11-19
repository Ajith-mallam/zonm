# Download a portable Redis build for Windows (redis-windows project) and
# verify its SHA-256 before extracting. No admin rights needed.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = "8.10.2"
$name = "Redis-$version-Windows-x64-msys2.zip"
$url = "https://github.com/redis-windows/redis-windows/releases/download/$version/$name"
$expected = "7c8cebd50347eaa1d9e784da842ed47a4f33394637835531d6614777b950ee85"
$zip = Join-Path $here "download\$name"
New-Item -ItemType Directory -Force -Path (Join-Path $here "download") | Out-Null
Invoke-WebRequest -Uri $url -OutFile $zip
$actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
if ($actual -ne $expected) { Remove-Item $zip; throw "SHA-256 mismatch for $name ($actual)" }
Expand-Archive -Path $zip -DestinationPath (Join-Path $here "bin") -Force
Write-Host "Redis $version installed in infra\devredis\bin"
