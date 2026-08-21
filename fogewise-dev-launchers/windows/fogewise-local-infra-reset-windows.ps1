$ErrorActionPreference = "Stop"

$LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Split-Path -Parent $LauncherDir
$ComposeFile = Join-Path $BaseDir "common\docker-compose.local-infra.yml"
$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"

Write-Host ""
Write-Host "[Fogewise] Stopping local PostgreSQL + RabbitMQ + Redis..." -ForegroundColor Cyan

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker -and (Test-Path $ComposeFile)) {
    & docker compose -f $ComposeFile down *> $null
}

$helper = Join-Path $env:TEMP "fogewise-infra-reset-hosts-$PID.ps1"
@'
param([Parameter(Mandatory=$true)][string]$HostsPath)

$ErrorActionPreference = "Stop"

$lines = Get-Content $HostsPath | Where-Object {
    $_ -notmatch '^\s*127\.0\.0\.1\s+fogewise-redis(\s+.*)?#\s*fogewise-local-infra\s*$'
}

$lines | Set-Content -Path $HostsPath -Encoding ASCII
ipconfig /flushdns | Out-Null
'@ | Set-Content -Path $helper -Encoding UTF8

try {
    $args = "-NoProfile -ExecutionPolicy Bypass -File `"$helper`" -HostsPath `"$HostsPath`""
    $proc = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList $args
    if ($proc.ExitCode -ne 0) {
        throw "Could not reset Windows hosts file."
    }
}
finally {
    Remove-Item $helper -Force -ErrorAction SilentlyContinue
}

Write-Host "[Fogewise] Local infra containers were stopped." -ForegroundColor Green
Write-Host "[Fogewise] Host alias fogewise-redis was removed."
