[CmdletBinding()]
param(
    [string]$PackageRoot = '',
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

$arguments = @{}
if ($RemoveInstalledFiles) {
    $arguments.RemoveServiceDirectory = $true
    $arguments.RemoveHelperDirectory = $true
    $arguments.RemoveLauncherDirectory = $true
}

& $uninstallScriptPath @arguments
