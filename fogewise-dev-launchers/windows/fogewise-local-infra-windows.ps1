$ErrorActionPreference = "Stop"

$LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Split-Path -Parent $LauncherDir
$ComposeFile = Join-Path $BaseDir "common\docker-compose.local-infra.yml"
$PrivateEnvFile = Join-Path $BaseDir "common\.env"
$HostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"

function Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail([string]$Message) {
    Write-Host ""
    Write-Host "[Fogewise] ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Invoke-Compose([string[]]$ComposeArgs) {
    $previousErrorPreference = $ErrorActionPreference
    $previousNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
    $ErrorActionPreference = "Continue"
    $PSNativeCommandUseErrorActionPreference = $false
    try {
        & docker compose --env-file $PrivateEnvFile @ComposeArgs
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorPreference
        $PSNativeCommandUseErrorActionPreference = $previousNativeErrorPreference
    }

    if ($exitCode -ne 0) {
        Fail "Docker Compose failed with exit code $exitCode."
    }
}

function Ensure-Docker {
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        Fail "Docker is not installed or not in PATH."
    }

    $previousErrorPreference = $ErrorActionPreference
    $previousNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
    $ErrorActionPreference = "Continue"
    $PSNativeCommandUseErrorActionPreference = $false
    try {
        & docker info *> $null
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) {
            $dockerOs = [string](& docker info --format "{{.OSType}}")
            $exitCode = $LASTEXITCODE
        }
    }
    finally {
        $ErrorActionPreference = $previousErrorPreference
        $PSNativeCommandUseErrorActionPreference = $previousNativeErrorPreference
    }

    if ($exitCode -ne 0) {
        Fail "Docker Desktop is not running or this terminal cannot access Docker."
    }
    if ($dockerOs.Trim() -ne "linux") {
        Fail "Docker Desktop must use Linux containers for PostgreSQL, RabbitMQ, and Redis."
    }
}

function Ensure-HostsAlias {
    $managedPattern = '^\s*127\.0\.0\.1\s+fogewise-redis(\s+.*)?#\s*fogewise-local-infra\s*$'
    if (Select-String -Path $HostsPath -Pattern $managedPattern -Quiet -ErrorAction SilentlyContinue) {
        return
    }

    $foreign = Get-Content $HostsPath | Where-Object {
        $_ -match '(^|\s)fogewise-redis(\s|$)' -and $_ -notmatch '#\s*fogewise-local-infra\s*$'
    }
    if ($foreign) {
        Fail "fogewise-redis already exists in hosts without the Fogewise marker. Remove/fix that entry manually first."
    }

    $helper = Join-Path $env:TEMP "fogewise-infra-hosts-$PID.ps1"
    @'
param([Parameter(Mandatory=$true)][string]$HostsPath)

$ErrorActionPreference = "Stop"
Add-Content -Path $HostsPath -Value "127.0.0.1 fogewise-redis # fogewise-local-infra"
ipconfig /flushdns | Out-Null
'@ | Set-Content -Path $helper -Encoding UTF8

    try {
        $args = "-NoProfile -ExecutionPolicy Bypass -File `"$helper`" -HostsPath `"$HostsPath`""
        $proc = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList $args
        if ($proc.ExitCode -ne 0) {
            Fail "Could not update Windows hosts file."
        }
    }
    finally {
        Remove-Item $helper -Force -ErrorAction SilentlyContinue
    }
}

function Get-ContainerHealth([string]$ContainerName) {
    $state = (& docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $ContainerName 2>$null)
    if ($LASTEXITCODE -ne 0) {
        return ""
    }
    return ($state | Select-Object -First 1).Trim()
}

function Wait-ForHealthyContainer([string]$ContainerName, [string]$Label, [int]$TimeoutSeconds = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $state = Get-ContainerHealth $ContainerName
        if ($state -eq "healthy" -or $state -eq "running") {
            return
        }
        Start-Sleep -Seconds 1
    }

    $lastState = Get-ContainerHealth $ContainerName
    if ([string]::IsNullOrWhiteSpace($lastState)) {
        $lastState = "unknown"
    }
    Fail "$Label did not become healthy within ${TimeoutSeconds}s (last state: $lastState)."
}

if (-not (Test-Path $ComposeFile)) {
    Fail "Compose file not found: $ComposeFile"
}
if (-not (Test-Path $PrivateEnvFile)) {
    Fail "Private configuration missing. Copy common/.env.example to common/.env and set the three passwords."
}

Step "Ensuring Docker Desktop is available"
Ensure-Docker

Step "Validating private local infrastructure configuration"
Invoke-Compose @("-f", $ComposeFile, "config", "--quiet")

Step "Ensuring host alias for fogewise-redis"
Ensure-HostsAlias

Step "Starting local PostgreSQL + RabbitMQ + Redis"
Invoke-Compose @("-f", $ComposeFile, "up", "-d")

Step "Waiting for PostgreSQL + RabbitMQ + Redis health checks"
Wait-ForHealthyContainer "fogewise-postgres" "PostgreSQL"
Wait-ForHealthyContainer "fogewise-rabbitmq" "RabbitMQ"
Wait-ForHealthyContainer "fogewise-redis" "Redis"

Step "Current container status"
Invoke-Compose @("-f", $ComposeFile, "ps")

Write-Host ""
Write-Host "[Fogewise] Local infra is ready for Windows." -ForegroundColor Green
Write-Host ""
Write-Host "Use these local endpoints from the host machine:"
Write-Host "  DATABASE_URL=postgresql://fogewise:<password-from-private-local-config>@127.0.0.1:5432/lcsp_dev?schema=public"
Write-Host "  RABBITMQ_URL=amqp://fogewise:<password-from-private-local-config>@127.0.0.1:5672"
Write-Host ""
Write-Host "Useful checks:"
Write-Host "  RabbitMQ UI: http://127.0.0.1:15672"
Write-Host "  RabbitMQ user: fogewise"
Write-Host "  Redis host alias: fogewise-redis -> 127.0.0.1"
