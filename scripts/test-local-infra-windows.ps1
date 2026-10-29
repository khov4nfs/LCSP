param(
    [string]$LauncherPath = (Join-Path $PSScriptRoot "../fogewise-dev-launchers/windows/fogewise-local-infra-windows.ps1")
)

$ErrorActionPreference = "Stop"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path $LauncherPath).Path, [ref]$tokens, [ref]$parseErrors
)
if ($parseErrors.Count -ne 0) { throw "PowerShell launcher syntax validation failed." }

function Assert-Launcher([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

# Load only function declarations: no hosts changes, containers, or private files.
$functions = $ast.EndBlock.Statements | Where-Object {
    $_ -is [System.Management.Automation.Language.FunctionDefinitionAst]
} | ForEach-Object { $_.Extent.Text }
. ([scriptblock]::Create(($functions -join "`n")))

function Fail([string]$Message) { throw $Message }
function docker {
    $script:DockerCalls += ,@($args)
    $global:LASTEXITCODE = $script:DockerExit
    if ($args[0] -eq "info" -and $args -contains "--format") {
        Write-Output $script:DockerOs
    }
    if ($args[0] -eq "ps") {
        Write-Output $script:ContainerNames
    }
    if ($args[0] -eq "volume") {
        Write-Output $script:VolumeNames
    }
}

$PrivateEnvFile = "C:\LCSP workspace & (test)\common\.env"
$ComposeFile = "C:\LCSP workspace & (test)\common\docker-compose.local-infra.yml"
$script:DockerCalls = @()
$script:DockerExit = 0
$script:DockerOs = "linux"
$PSNativeCommandUseErrorActionPreference = $true

Invoke-Compose @("-f", $ComposeFile, "config", "--quiet")
$expected = @("compose", "--env-file", $PrivateEnvFile, "-f", $ComposeFile, "config", "--quiet")
$actual = $script:DockerCalls[0]
Assert-Launcher ($actual.Count -eq $expected.Count) "Compose arguments were lost."
for ($i = 0; $i -lt $expected.Count; $i++) {
    Assert-Launcher ($actual[$i] -ceq $expected[$i]) "Compose changed a literal path or argument."
}
Assert-Launcher ($ErrorActionPreference -eq "Stop") "Compose leaked ErrorActionPreference."
Assert-Launcher $PSNativeCommandUseErrorActionPreference "Compose leaked native error preferences."

$script:DockerExit = 17
try {
    Invoke-Compose @("-f", $ComposeFile, "up", "-d")
    throw "Compose failure was ignored."
} catch {
    Assert-Launcher ($_.Exception.Message -match "exit code 17") "Compose failure lost its exit code."
}
Assert-Launcher ($ErrorActionPreference -eq "Stop") "Failed Compose leaked error preferences."
Assert-Launcher $PSNativeCommandUseErrorActionPreference "Failed Compose leaked native error preferences."

$script:DockerExit = 0
Ensure-Docker
$script:DockerOs = "windows"
try {
    Ensure-Docker
    throw "Windows-container mode was accepted."
} catch {
    Assert-Launcher ($_.Exception.Message -match "Linux containers") "Docker Desktop mode was not rejected."
}
$script:DockerExit = 23
try {
    Ensure-Docker
    throw "Unavailable Docker daemon was accepted."
} catch {
    Assert-Launcher ($_.Exception.Message -match "Docker Desktop is not running") "Docker daemon failure was not propagated."
}
Assert-Launcher ($ErrorActionPreference -eq "Stop") "Docker checks leaked error preferences."
Assert-Launcher $PSNativeCommandUseErrorActionPreference "Docker checks leaked native error preferences."

$script:DockerExit = 0
$script:ContainerNames = @()
$script:VolumeNames = @()
$privateTestDir = Join-Path ([System.IO.Path]::GetTempPath()) ("lcsp-infra-secrets-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $privateTestDir | Out-Null
$PrivateEnvFile = Join-Path $privateTestDir ".env"
try {
    Ensure-PrivateEnv
    Assert-Launcher (Test-Path -LiteralPath $PrivateEnvFile) "Missing private configuration was not generated."
    $values = @{}
    foreach ($line in (Get-Content -LiteralPath $PrivateEnvFile)) {
        $parts = $line.Split('=', 2)
        Assert-Launcher ($parts.Count -eq 2) "Generated configuration has an invalid line."
        $values[$parts[0]] = $parts[1]
    }
    Assert-Launcher ($values.Count -eq 3) "Generated configuration has the wrong number of passwords."
    foreach ($key in @("LCSP_LOCAL_POSTGRES_PASSWORD", "LCSP_LOCAL_RABBITMQ_PASSWORD", "LCSP_LOCAL_REDIS_PASSWORD")) {
        Assert-Launcher ($values[$key] -cmatch '^[a-f0-9]{64}$') "Generated configuration has an invalid password."
    }
    Assert-Launcher (@($values.Values | Select-Object -Unique).Count -eq 3) "Generated passwords are not independent."
    $original = Get-Content -LiteralPath $PrivateEnvFile -Raw
    $script:VolumeNames = @("old_fogewise-postgres-data")
    Ensure-PrivateEnv
    Assert-Launcher ((Get-Content -LiteralPath $PrivateEnvFile -Raw) -ceq $original) "Existing passwords were replaced."

    Remove-Item -LiteralPath $PrivateEnvFile
    try {
        Ensure-PrivateEnv
        throw "Existing Fogewise data volume was ignored."
    } catch {
        Assert-Launcher ($_.Exception.Message -match "Restore the original private passwords") "Volume recovery guidance was lost."
    }
    Assert-Launcher (-not (Test-Path -LiteralPath $PrivateEnvFile)) "A new password file was created for old data."
    $script:VolumeNames = @()
    $script:ContainerNames = @("fogewise-rabbitmq")
    try {
        Ensure-PrivateEnv
        throw "Existing Fogewise container was ignored."
    } catch {
        Assert-Launcher ($_.Exception.Message -match "Restore the original private passwords") "Container recovery guidance was lost."
    }
    Assert-Launcher (-not (Test-Path -LiteralPath $PrivateEnvFile)) "A new password file was created for an old container."
}
finally {
    if (Test-Path -LiteralPath $PrivateEnvFile) { Remove-Item -LiteralPath $PrivateEnvFile }
    Remove-Item -LiteralPath $privateTestDir
}

$commands = @($ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.CommandAst]
}, $true))
$preflight = @($commands | Where-Object {
    $_.GetCommandName() -eq "Invoke-Compose" -and $_.Extent.Text -match '"config", "--quiet"'
})
$hostsChange = @($commands | Where-Object { $_.GetCommandName() -eq "Ensure-HostsAlias" })
Assert-Launcher ($preflight.Count -eq 1 -and $hostsChange.Count -eq 1) "Private configuration preflight is missing."
Assert-Launcher ($preflight[0].Extent.StartOffset -lt $hostsChange[0].Extent.StartOffset) "Hosts change precedes configuration validation."
$source = Get-Content -LiteralPath $LauncherPath -Raw
Assert-Launcher ($source.Contains('Ensure-PrivateEnv')) "Missing private env bootstrap is absent."

# The intentional native-failure fixture must not become the CI step exit code.
$global:LASTEXITCODE = 0
Write-Output "PASS: PowerShell syntax, literal Compose arguments, private env preflight, Docker errors and Linux-container requirement."
Write-Output "Windows Docker Desktop smoke: NOT_VERIFIED - ENVIRONMENT_UNAVAILABLE (these checks mock Docker)."
