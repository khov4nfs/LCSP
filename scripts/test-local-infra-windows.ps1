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
Assert-Launcher ($source.Contains('Test-Path $PrivateEnvFile')) "Missing private env file is not rejected."

# The intentional native-failure fixture must not become the CI step exit code.
$global:LASTEXITCODE = 0
Write-Output "PASS: PowerShell syntax, literal Compose arguments, private env preflight, Docker errors and Linux-container requirement."
Write-Output "Windows Docker Desktop smoke: NOT_VERIFIED - ENVIRONMENT_UNAVAILABLE (these checks mock Docker)."
