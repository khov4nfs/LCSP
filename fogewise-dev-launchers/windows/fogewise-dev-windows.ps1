$ErrorActionPreference = "Stop"

$LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Split-Path -Parent $LauncherDir
$CommonDir = Join-Path $BaseDir "common"

function Resolve-ProjectRoot {
    $git = Get-Command git -ErrorAction SilentlyContinue

    if ($git) {
        try {
            $gitRoot = (& git -C $BaseDir rev-parse --show-toplevel 2>$null).Trim()
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($gitRoot)) {
                return $gitRoot
            }
        } catch {}
    }

    # Only when Git is unavailable / this folder is not inside a Git work tree:
    # fallback to the parent directory that contains fogewise-dev-launchers/.
    return Split-Path -Parent $BaseDir
}

$ProjectRoot = Resolve-ProjectRoot
$ConfigFile = Join-Path $BaseDir ".fogewise-dev.local"
$CaddyFile = Join-Path $CommonDir "Caddyfile.dev"
$TrustMarker = Join-Path $BaseDir ".fogewise-dev.trusted-windows"
$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$AdminAddress = "127.0.0.1:20191"

function Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail([string]$Message) {
    Write-Host ""
    Write-Host "[Fogewise] ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Add-LocalExclude([string]$Entry) {
    $exclude = Join-Path $ProjectRoot ".git\info\exclude"

    if (Test-Path (Split-Path -Parent $exclude)) {
        if (-not (Test-Path $exclude)) {
            New-Item -ItemType File -Path $exclude -Force | Out-Null
        }

        if (-not (Select-String -Path $exclude -SimpleMatch $Entry -Quiet -ErrorAction SilentlyContinue)) {
            Add-Content -Path $exclude -Value $Entry
        }
    }
}

function Load-Or-Create-Config {
    $values = @{}

    if (Test-Path $ConfigFile) {
        foreach ($line in Get-Content $ConfigFile) {
            if ($line -match '^\s*([A-Z0-9_]+)\s*=(.*)$') {
                $values[$matches[1]] = $matches[2].Trim()
            }
        }
    }

    $defaultSubdomain = (Split-Path $ProjectRoot -Leaf).ToLowerInvariant()
    $launcherFolderName = (Split-Path $LauncherDir -Leaf).ToLowerInvariant()
    $subdomain = $values["FOGEWISE_SUBDOMAIN"]

    # Migration for the previous bug:
    # when the launcher folder name was incorrectly used as the default.
    if (
        -not [string]::IsNullOrWhiteSpace($subdomain) -and
        $subdomain.ToLowerInvariant() -eq $launcherFolderName -and
        $launcherFolderName -ne $defaultSubdomain
    ) {
        Write-Host "[Fogewise] Auto-fix old subdomain: $subdomain -> $defaultSubdomain" -ForegroundColor Yellow
        $subdomain = $defaultSubdomain
    }

    if ([string]::IsNullOrWhiteSpace($subdomain)) {
        $answer = Read-Host "Fogewise subdomain [$defaultSubdomain]"

        if ([string]::IsNullOrWhiteSpace($answer)) {
            $subdomain = $defaultSubdomain
        } else {
            $subdomain = $answer.Trim().ToLowerInvariant()
        }
    }

    if ($subdomain -notmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$') {
        Fail "Invalid subdomain: $subdomain"
    }

    $webPort = $values["FOGEWISE_WEB_PORT"]
    if ([string]::IsNullOrWhiteSpace($webPort)) { $webPort = "3000" }

    $apiPort = $values["FOGEWISE_API_PORT"]
    if ([string]::IsNullOrWhiteSpace($apiPort)) { $apiPort = "4000" }

    if ($webPort -notmatch '^\d{2,5}$') { Fail "Invalid WEB port: $webPort" }
    if ($apiPort -notmatch '^\d{2,5}$') { Fail "Invalid API port: $apiPort" }

    @(
        "FOGEWISE_SUBDOMAIN=$subdomain"
        "FOGEWISE_WEB_PORT=$webPort"
        "FOGEWISE_API_PORT=$apiPort"
    ) | Set-Content -Path $ConfigFile -Encoding UTF8

    Add-LocalExclude "fogewise-dev-launchers/.fogewise-dev.local"
    Add-LocalExclude "fogewise-dev-launchers/.fogewise-dev.trusted-*"

    return @{
        Subdomain = $subdomain
        WebPort = $webPort
        ApiPort = $apiPort
    }
}

function Ensure-Caddy {
    $cmd = Get-Command caddy -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    Step "Caddy not found - installing"

    $choco = Get-Command choco -ErrorAction SilentlyContinue
    if ($choco) {
        & choco install caddy -y
    } else {
        $scoop = Get-Command scoop -ErrorAction SilentlyContinue
        if ($scoop) {
            & scoop install caddy
        } else {
            Fail "Caddy not found. Install Caddy with Chocolatey/Scoop, then run this launcher again."
        }
    }

    $cmd = Get-Command caddy -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Fail "Caddy was installed but is not in PATH. Close and re-open the launcher."
    }

    return $cmd.Source
}

function Ensure-Caddyfile {
    if (Test-Path $CaddyFile) {
        return
    }

    @'
{
    admin 127.0.0.1:20191
    auto_https disable_redirects
}

{$FOGEWISE_SUBDOMAIN}.fogewise.io.vn {
    bind 127.0.0.1
    tls internal

    @api path /api /api/*
    handle @api {
        reverse_proxy 127.0.0.1:{$FOGEWISE_API_PORT}
    }

    handle {
        reverse_proxy 127.0.0.1:{$FOGEWISE_WEB_PORT}
    }
}
'@ | Set-Content -Path $CaddyFile -Encoding UTF8
}

function Remove-HostsOverride([string]$Domain) {
    if ([string]::IsNullOrWhiteSpace($Domain)) {
        return
    }

    $managed = Get-Content $HostsPath | Where-Object {
        $_ -match ("^\s*127\.0\.0\.1\s+" + [regex]::Escape($Domain) + "(\s|$)") -and
        $_ -match '#\s*fogewise-local-dev\s*$'
    }

    if (-not $managed) {
        return
    }

    $helper = Join-Path $env:TEMP "fogewise-remove-hosts-$PID.ps1"

    @'
param(
    [Parameter(Mandatory=$true)][string]$HostsPath,
    [Parameter(Mandatory=$true)][string]$Domain
)

$ErrorActionPreference = "Stop"
$escaped = [regex]::Escape($Domain)

$lines = Get-Content $HostsPath | Where-Object {
    -not (
        $_ -match ("^\s*127\.0\.0\.1\s+" + $escaped + "(\s|$)") -and
        $_ -match '#\s*fogewise-local-dev\s*$'
    )
}

$lines | Set-Content -Path $HostsPath -Encoding ASCII
ipconfig /flushdns | Out-Null
'@ | Set-Content -Path $helper -Encoding UTF8

    try {
        $args = "-NoProfile -ExecutionPolicy Bypass -File `"$helper`" -HostsPath `"$HostsPath`" -Domain `"$Domain`""
        $proc = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList $args

        if ($proc.ExitCode -ne 0) {
            Write-Host "[Fogewise] Warning: could not remove hosts override." -ForegroundColor Yellow
        }
    }
    finally {
        Remove-Item $helper -Force -ErrorAction SilentlyContinue
    }
}

function Ensure-Hosts([string]$Domain) {
    $escaped = [regex]::Escape($Domain)

    # Allow stale entries that are ours; reject anything else.
    $matching = Get-Content $HostsPath | Where-Object {
        $_ -match ("(^|\s)" + $escaped + "(\s|$)")
    }

    $foreign = $matching | Where-Object {
        -not (
            $_ -match '^\s*127\.0\.0\.1\s+' -and
            $_ -match '#\s*fogewise-local-dev\s*$'
        )
    }

    if ($foreign) {
        Fail "hosts already contains $Domain without the Fogewise marker. Remove/fix that entry manually first."
    }

    $helper = Join-Path $env:TEMP "fogewise-hosts-$PID.ps1"

    @'
param(
    [Parameter(Mandatory=$true)][string]$HostsPath,
    [Parameter(Mandatory=$true)][string]$Domain
)

$ErrorActionPreference = "Stop"
$escaped = [regex]::Escape($Domain)

# Repair stale managed entry first.
$lines = Get-Content $HostsPath | Where-Object {
    -not (
        $_ -match ("^\s*127\.0\.0\.1\s+" + $escaped + "(\s|$)") -and
        $_ -match '#\s*fogewise-local-dev\s*$'
    )
}

$lines | Set-Content -Path $HostsPath -Encoding ASCII
Add-Content -Path $HostsPath -Value "127.0.0.1 $Domain # fogewise-local-dev"
ipconfig /flushdns | Out-Null
'@ | Set-Content -Path $helper -Encoding UTF8

    try {
        $args = "-NoProfile -ExecutionPolicy Bypass -File `"$helper`" -HostsPath `"$HostsPath`" -Domain `"$Domain`""
        $proc = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList $args

        if ($proc.ExitCode -ne 0) {
            Fail "Could not update Windows hosts file."
        }
    }
    finally {
        Remove-Item $helper -Force -ErrorAction SilentlyContinue
    }
}

$config = Load-Or-Create-Config
$env:FOGEWISE_SUBDOMAIN = $config.Subdomain
$env:FOGEWISE_WEB_PORT = $config.WebPort
$env:FOGEWISE_API_PORT = $config.ApiPort

$domain = "$($config.Subdomain).fogewise.io.vn"
$caddyProcess = $null

Write-Host ""
Write-Host "Fogewise Local Development" -ForegroundColor Green
Write-Host "Launcher: $LauncherDir"
Write-Host "Project : $ProjectRoot"
Write-Host "Domain  : https://$domain"
Write-Host "Web     : 127.0.0.1:$($config.WebPort)"
Write-Host "API     : 127.0.0.1:$($config.ApiPort)"

$caddy = Ensure-Caddy
Ensure-Caddyfile

try {
    Step "Configuring local DNS override"
    Ensure-Hosts $domain

    Step "Verifying local resolution"
    $pingOutput = ping.exe -n 1 $domain | Out-String
    Write-Host $pingOutput

    if ($pingOutput -notmatch '127\.0\.0\.1') {
        Fail "$domain does not resolve to 127.0.0.1."
    }

    Step "Checking Caddyfile"
    & $caddy adapt --config $CaddyFile | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Fail "Caddyfile.dev is invalid."
    }

    Step "Starting local Caddy"

    $caddyProcess = Start-Process `
        -FilePath $caddy `
        -ArgumentList @("run", "--config", $CaddyFile) `
        -PassThru

    Start-Sleep -Seconds 2

    if ($caddyProcess.HasExited) {
        Fail "Caddy exited during startup."
    }

    if (-not (Test-Path $TrustMarker)) {
        Step "Trusting Caddy Local CA (one-time)"
        try {
            & $caddy trust --address $AdminAddress
            if ($LASTEXITCODE -eq 0) {
                New-Item -ItemType File -Path $TrustMarker -Force | Out-Null
            }
        }
        catch {
            Write-Host "[Fogewise] Automatic trust failed. Run PowerShell as Administrator and execute: caddy trust" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "[Fogewise] CADDY READY: https://$domain" -ForegroundColor Green
    Write-Host "[Fogewise] Launcher does NOT run the project."
    Write-Host "[Fogewise] Dev tự mở terminal khác tại: $ProjectRoot"
    Write-Host "[Fogewise] Sau đó tự chạy command dev của project."
    Write-Host "[Fogewise] Ctrl+C để stop local Caddy và trả domain về production."
    Write-Host ""

    while (-not $caddyProcess.HasExited) {
        Start-Sleep -Seconds 1
    }

    if ($caddyProcess.ExitCode -ne 0) {
        Fail "Caddy exited with code $($caddyProcess.ExitCode)."
    }
}
finally {
    Write-Host ""
    Write-Host "[Fogewise] Stopping local Caddy..."

    try {
        & $caddy stop --address $AdminAddress 2>$null
    }
    catch {}

    if ($caddyProcess -and -not $caddyProcess.HasExited) {
        Stop-Process -Id $caddyProcess.Id -Force -ErrorAction SilentlyContinue
    }

    Remove-HostsOverride $domain

    Write-Host "[Fogewise] Local hosts override removed."
    Write-Host "[Fogewise] https://$domain now resolves through public DNS again."
}
