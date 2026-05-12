[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$PackageRoot = '',
    [string]$HelperTaskUser = ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name),
    [string]$InstallRoot = 'C:\Program Files\EmployeeBehaviorAgent',
    [string]$DataDirectory = 'C:\ProgramData\EmployeeBehaviorAgent',
    [string]$LogDirectory = 'C:\ProgramData\EmployeeBehaviorAgent\logs',
    [string]$ServiceConfigPath = '',
    [string]$HelperConfigPath = '',
    [string]$EmployeeCode = 'E-001',
    [switch]$StartHelperTask,
    [switch]$Cleanup,
    [switch]$RemoveInstalledFiles
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

function Resolve-PackageRootPath {
    param([string]$Path)

    if (-not [string]::IsNullOrWhiteSpace($Path)) {
        return Resolve-FullPath -Path $Path
    }

    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        return Resolve-FullPath -Path $PSScriptRoot
    }

    return Resolve-FullPath -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

$resolvedPackageRoot = Resolve-PackageRootPath -Path $PackageRoot
$installScriptPath = Join-Path $resolvedPackageRoot 'Install-AgentInstallerPackage.ps1'
$validateScriptPath = Join-Path $resolvedPackageRoot 'Validate-AgentInstallerPackage.ps1'
$uninstallScriptPath = Join-Path $resolvedPackageRoot 'Uninstall-AgentInstallerPackage.ps1'

foreach ($requiredPath in @($installScriptPath, $validateScriptPath, $uninstallScriptPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Bundled acceptance dependency missing: $requiredPath"
    }
}

$installArguments = @{
    PackageRoot = $resolvedPackageRoot
    HelperTaskUser = $HelperTaskUser
    InstallRoot = $InstallRoot
    DataDirectory = $DataDirectory
    LogDirectory = $LogDirectory
    StartService = $true
    Confirm = $false
}

if (-not [string]::IsNullOrWhiteSpace($ServiceConfigPath)) {
    $installArguments.ServiceConfigPath = Resolve-FullPath -Path $ServiceConfigPath
}
if (-not [string]::IsNullOrWhiteSpace($HelperConfigPath)) {
    $installArguments.HelperConfigPath = Resolve-FullPath -Path $HelperConfigPath
}
if ($StartHelperTask) {
    $installArguments.StartHelperTask = $true
}
if ($WhatIfPreference) {
    $installArguments.WhatIf = $true
}

$validateArguments = @{
    PackageRoot = $resolvedPackageRoot
    InstallRoot = $InstallRoot
    DataDirectory = $DataDirectory
    RequireInstalledHelperTask = $true
    RunLifecycleSmoke = $true
    EmployeeCode = $EmployeeCode
}

$uninstallArguments = @{
    InstallRoot = $InstallRoot
    DataDirectory = $DataDirectory
    Confirm = $false
}

if ($RemoveInstalledFiles) {
    $uninstallArguments.RemoveServiceDirectory = $true
    $uninstallArguments.RemoveHelperDirectory = $true
    $uninstallArguments.RemoveLauncherDirectory = $true
    $uninstallArguments.RemoveLogDirectory = $true
}
if ($WhatIfPreference) {
    $uninstallArguments.WhatIf = $true
}

try {
    & $installScriptPath @installArguments
    & $validateScriptPath @validateArguments
}
finally {
    if ($Cleanup) {
        & $uninstallScriptPath @uninstallArguments
    }
}
