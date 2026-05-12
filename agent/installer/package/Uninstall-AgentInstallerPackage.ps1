[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$ServiceName = 'EmployeeBehavior.Agent.Service',
    [string]$HelperTaskName = 'EmployeeBehavior.Agent.SessionHelper',
    [string]$InstallRoot = 'C:\Program Files\EmployeeBehaviorAgent',
    [string]$DataDirectory = 'C:\ProgramData\EmployeeBehaviorAgent',
    [switch]$RemoveServiceDirectory,
    [switch]$RemoveHelperDirectory,
    [switch]$RemoveLauncherDirectory,
    [switch]$RemoveLogDirectory,
    [switch]$RemoveUploadQueue,
    [switch]$RemoveDeviceIdentity
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

function Assert-FileExists {
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label '$Path' does not exist."
    }
}

$scriptRoot = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
}
else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}

$toolsRoot = Join-Path $scriptRoot 'tools'
$uninstallScriptPath = Join-Path $toolsRoot 'Uninstall-AgentPilot.ps1'
$serviceTargetDirectory = Join-Path $InstallRoot 'Service'
$helperTargetDirectory = Join-Path $InstallRoot 'SessionHelper'
$launcherTargetDirectory = Join-Path $InstallRoot 'Launcher'

Assert-FileExists -Path $uninstallScriptPath -Label 'Bundled uninstall script'

$arguments = @{
    ServiceName = $ServiceName
    HelperTaskName = $HelperTaskName
    ServiceTargetDirectory = $serviceTargetDirectory
    HelperTargetDirectory = $helperTargetDirectory
    DataDirectory = $DataDirectory
    WhatIf = $WhatIfPreference
    Confirm = $false
}

if ($RemoveServiceDirectory) {
    $arguments.RemoveServiceDirectory = $true
}

if ($RemoveHelperDirectory) {
    $arguments.RemoveHelperDirectory = $true
}

if ($RemoveLogDirectory) {
    $arguments.RemoveLogDirectory = $true
}

if ($RemoveUploadQueue) {
    $arguments.RemoveUploadQueue = $true
}

if ($RemoveDeviceIdentity) {
    $arguments.RemoveDeviceIdentity = $true
}

& $uninstallScriptPath @arguments

if ($RemoveLauncherDirectory -and (Test-Path -LiteralPath $launcherTargetDirectory)) {
    if ($PSCmdlet.ShouldProcess($launcherTargetDirectory, 'Remove launcher install directory')) {
        Remove-Item -LiteralPath $launcherTargetDirectory -Recurse -Force
    }
}

[pscustomobject]@{
    ServiceName = $ServiceName
    HelperTaskName = $HelperTaskName
    ServiceTargetDirectory = Resolve-FullPath -Path $serviceTargetDirectory
    HelperTargetDirectory = Resolve-FullPath -Path $helperTargetDirectory
    LauncherTargetDirectory = Resolve-FullPath -Path $launcherTargetDirectory
    DataDirectory = Resolve-FullPath -Path $DataDirectory
    RemoveLauncherDirectory = [bool]$RemoveLauncherDirectory
}
