$ErrorActionPreference = "Stop"

$LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Split-Path -Parent $LauncherDir
$CommonDir = Join-Path $BaseDir "common"
$DevConfig = Join-Path $BaseDir ".fogewise-dev.local"
$ProdConfig = Join-Path $BaseDir ".fogewise-production.local"
$CaddyFile = Join-Path $CommonDir "Caddyfile.production"
$CaddyAdmin = "127.0.0.1:20192"

function Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail([string]$Message) {
    Write-Host ""
    Write-Host "[Fogewise] ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Resolve-ProjectRoot {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        try {
            $root = (& git -C $BaseDir rev-parse --show-toplevel 2>$null).Trim()

            if ($LASTEXITCODE -eq 0 -and $root) {
                return $root
            }
        }
        catch {}
    }

    return Split-Path -Parent $BaseDir
}

function Read-KeyValueFile([string]$Path) {
    $result = @{}

    if (Test-Path $Path) {
        foreach ($line in Get-Content $Path) {
            if ($line -match '^\s*([A-Z0-9_]+)\s*=(.*)$') {
                $result[$matches[1]] = $matches[2].Trim()
            }
        }
    }

    return $result
}

function Slug([string]$Value) {
    $s = $Value.ToLowerInvariant()
    $s = [regex]::Replace($s, '[^a-z0-9]+', '-')
    return $s.Trim('-')
}

function Ensure-Caddy {
    $cmd = Get-Command caddy -ErrorAction SilentlyContinue

    if ($cmd) {
        return $cmd.Source
    }

    Step "Installing Caddy"

    if (Get-Command choco -ErrorAction SilentlyContinue) {
        & choco install caddy -y
    }
    elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
        & scoop install caddy
    }
    else {
        Fail "Install Caddy with Chocolatey or Scoop, then run again."
    }

    $cmd = Get-Command caddy -ErrorAction SilentlyContinue

    if (-not $cmd) {
        Fail "Caddy is not in PATH."
    }

    return $cmd.Source
}

function Ensure-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue

    if ($cmd) {
        return $cmd.Source
    }

    Step "Installing cloudflared to launcher tools directory"

    $tools = Join-Path $LauncherDir ".tools"
    New-Item -ItemType Directory -Path $tools -Force | Out-Null

    $exe = Join-Path $tools "cloudflared.exe"

    Invoke-WebRequest `
        -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
        -OutFile $exe

    return $exe
}

$ProjectRoot = Resolve-ProjectRoot
$dev = Read-KeyValueFile $DevConfig
$prod = Read-KeyValueFile $ProdConfig

$subdomain = $dev["FOGEWISE_SUBDOMAIN"]
if (-not $subdomain) {
    $subdomain = (Split-Path $ProjectRoot -Leaf).ToLowerInvariant()
}

$webPort = $dev["FOGEWISE_WEB_PORT"]
if (-not $webPort) {
    $webPort = "3000"
}

$apiPort = $dev["FOGEWISE_API_PORT"]
if (-not $apiPort) {
    $apiPort = "4000"
}

$defaultDev = ""

if (Get-Command git -ErrorAction SilentlyContinue) {
    try {
        $defaultDev = (& git -C $ProjectRoot config user.name 2>$null).Trim()
    }
    catch {}
}

if (-not $defaultDev) {
    $defaultDev = $env:USERNAME
}

$defaultDev = Slug $defaultDev

if (-not $defaultDev) {
    $defaultDev = "developer"
}

$devSlug = $prod["FOGEWISE_DEV_SLUG"]
if (-not $devSlug) {
    $devSlug = $defaultDev
}
$devSlug = Slug $devSlug

$sharePort = $prod["FOGEWISE_SHARE_PORT"]
if (-not $sharePort) {
    $sharePort = "18080"
}

$previewHost = $prod["FOGEWISE_PREVIEW_HOST"]
if (-not $previewHost) {
    $previewHost = "$subdomain-$devSlug.fogewise.io.vn"
}

$tunnelToken = $env:FOGEWISE_TUNNEL_TOKEN
if (-not $tunnelToken) {
    $tunnelToken = $prod["FOGEWISE_TUNNEL_TOKEN"]
}

if (-not (Test-Path $ProdConfig)) {
    @(
        "FOGEWISE_DEV_SLUG=$devSlug"
        "FOGEWISE_SHARE_PORT=$sharePort"
        "FOGEWISE_PREVIEW_HOST=$previewHost"
        "FOGEWISE_TUNNEL_TOKEN="
    ) | Set-Content -Path $ProdConfig -Encoding UTF8
}

if (-not $tunnelToken) {
    Fail @"
Missing FOGEWISE_TUNNEL_TOKEN.

Ask the Fogewise/Cloudflare admin to provision the preview tunnel for:
  https://$previewHost

Then edit:
  $ProdConfig

and set:
  FOGEWISE_TUNNEL_TOKEN=<token>

No Cloudflare zone permission is required on the developer machine.
"@
}

$env:FOGEWISE_SUBDOMAIN = $subdomain
$env:FOGEWISE_WEB_PORT = $webPort
$env:FOGEWISE_API_PORT = $apiPort
$env:FOGEWISE_SHARE_PORT = $sharePort

$caddy = Ensure-Caddy
$cloudflared = Ensure-Cloudflared

Write-Host ""
Write-Host "Fogewise Production Preview" -ForegroundColor Green
Write-Host "Project : $ProjectRoot"
Write-Host "Public  : https://$previewHost"
Write-Host "Web     : 127.0.0.1:$webPort"
Write-Host "API     : 127.0.0.1:$apiPort"
Write-Host "Router  : 127.0.0.1:$sharePort"
Write-Host ""
Write-Host "[Fogewise] The project is NOT started by this launcher."
Write-Host "[Fogewise] Cloudflare tunnel/DNS provisioning is NOT done on the developer machine."
Write-Host "[Fogewise] Start the project yourself before sharing it."

Step "Starting local preview router"

& $caddy adapt --config $CaddyFile | Out-Null

if ($LASTEXITCODE -ne 0) {
    Fail "Caddyfile.production is invalid."
}

$caddyProcess = Start-Process `
    -FilePath $caddy `
    -ArgumentList @("run", "--config", $CaddyFile) `
    -PassThru

Start-Sleep -Seconds 1

if ($caddyProcess.HasExited) {
    Fail "Production-preview Caddy failed to start."
}

Write-Host ""
Write-Host "[Fogewise] PUBLIC PREVIEW STARTING" -ForegroundColor Green
Write-Host "Share this URL after cloudflared connects:"
Write-Host "https://$previewHost" -ForegroundColor Blue
Write-Host ""
Write-Host "Ctrl+C / close this window to stop sharing."
Write-Host ""

try {
    & $cloudflared tunnel --protocol http2 --edge-ip-version 4 run --token $tunnelToken
}
finally {
    try {
        & $caddy stop --address $CaddyAdmin 2>$null
    }
    catch {}

    if ($caddyProcess -and -not $caddyProcess.HasExited) {
        Stop-Process -Id $caddyProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
