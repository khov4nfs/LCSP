$ErrorActionPreference = "Stop"

$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$AdminAddress = "127.0.0.1:20191"

Write-Host ""
Write-Host "[Fogewise] Resetting local development override..." -ForegroundColor Cyan

$caddy = Get-Command caddy -ErrorAction SilentlyContinue
if ($caddy) {
    try {
        & $caddy.Source stop --address $AdminAddress 2>$null
    } catch {}
}

$helper = Join-Path $env:TEMP "fogewise-reset-hosts-$PID.ps1"

@'
param([Parameter(Mandatory=$true)][string]$HostsPath)

$ErrorActionPreference = "Stop"

$lines = Get-Content $HostsPath | Where-Object {
    $_ -notmatch '#\s*fogewise-local-dev\s*$'
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

Write-Host "[Fogewise] All Fogewise local hosts overrides were removed." -ForegroundColor Green
Write-Host "[Fogewise] Fogewise domains now resolve through public DNS again."
