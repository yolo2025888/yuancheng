[CmdletBinding()]
param(
    [string]$PackageRoot = '',
    [string]$InstallRoot = 'C:\Program Files\EmployeeBehaviorAgent',
    [string]$DataDirectory = 'C:\ProgramData\EmployeeBehaviorAgent',
    [switch]$RequireInstalledHelperTask,
    [switch]$RunLifecycleSmoke,
    [string]$EmployeeCode = 'E-001'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-FullPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    return [System.IO.Path]::GetFullPath($Path)
}

$scriptRoot = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
}
else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}

$resolvedPackageRoot = if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
    Resolve-FullPath -Path $scriptRoot
}
else {
    Resolve-FullPath -Path $PackageRoot
}

$toolsRoot = Join-Path $resolvedPackageRoot 'tools'
$validatorPath = Join-Path $toolsRoot 'Test-AgentDeployment.ps1'
$lifecycleValidatorPath = Join-Path $toolsRoot 'Test-AgentInstalledLifecycle.ps1'

if (-not (Test-Path -LiteralPath $validatorPath -PathType Leaf)) {
    throw "Bundled deployment validator not found: $validatorPath"
}

$parameters = @{
    ServiceConfigPath = Join-Path $InstallRoot 'Service\appsettings.json'
    HelperConfigPath = Join-Path $InstallRoot 'SessionHelper\appsettings.json'
    LauncherTargetDirectory = Join-Path $InstallRoot 'Launcher'
    LogRootPath = Join-Path $DataDirectory 'logs'
}

if ($RequireInstalledHelperTask) {
    $parameters.RequireInstalledHelperTask = $true
}

& $validatorPath @parameters

if ($RunLifecycleSmoke) {
    if (-not (Test-Path -LiteralPath $lifecycleValidatorPath -PathType Leaf)) {
        throw "Bundled lifecycle validator not found: $lifecycleValidatorPath"
    }

    & $lifecycleValidatorPath `
        -LauncherExecutablePath (Join-Path $InstallRoot 'Launcher\EmployeeBehavior.Agent.Launcher.exe') `
        -DataDirectory $DataDirectory `
        -EmployeeCode $EmployeeCode
}
