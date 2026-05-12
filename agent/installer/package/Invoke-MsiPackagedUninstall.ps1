[CmdletBinding()]
param(
    [string]$PackageRoot = '',
    [string]$InstallRoot = 'C:\Program Files\EmployeeBehaviorAgent',
    [string]$DataDirectory = 'C:\ProgramData\EmployeeBehaviorAgent',
    [switch]$RemoveInstalledFiles
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
}
else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}

$resolvedPackageRoot = if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
    [System.IO.Path]::GetFullPath($scriptRoot)
}
else {
    [System.IO.Path]::GetFullPath($PackageRoot)
}

$uninstallScriptPath = Join-Path $resolvedPackageRoot 'Uninstall-AgentInstallerPackage.ps1'
if (-not (Test-Path -LiteralPath $uninstallScriptPath -PathType Leaf)) {
    throw "Bundled uninstall entrypoint not found: $uninstallScriptPath"
}

$arguments = @{
    InstallRoot = $InstallRoot
    DataDirectory = $DataDirectory
}
if ($RemoveInstalledFiles) {
    $arguments.RemoveServiceDirectory = $true
    $arguments.RemoveHelperDirectory = $true
    $arguments.RemoveLauncherDirectory = $true
    $arguments.RemoveLogDirectory = $true
}

& $uninstallScriptPath @arguments
