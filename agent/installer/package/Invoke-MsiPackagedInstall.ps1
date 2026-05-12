[CmdletBinding()]
param(
    [string]$PackageRoot = '',
    [string]$HelperTaskUser = '',
    [string]$InstallRoot = 'C:\Program Files\EmployeeBehaviorAgent',
    [string]$DataDirectory = 'C:\ProgramData\EmployeeBehaviorAgent',
    [string]$LogDirectory = 'C:\ProgramData\EmployeeBehaviorAgent\logs',
    [switch]$StartHelperTask
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

$installScriptPath = Join-Path $resolvedPackageRoot 'Install-AgentInstallerPackage.ps1'
if (-not (Test-Path -LiteralPath $installScriptPath -PathType Leaf)) {
    throw "Bundled installer entrypoint not found: $installScriptPath"
}

$arguments = @{
    PackageRoot = $resolvedPackageRoot
    InstallRoot = $InstallRoot
    DataDirectory = $DataDirectory
    LogDirectory = $LogDirectory
    StartService = $true
}

if (-not [string]::IsNullOrWhiteSpace($HelperTaskUser)) {
    $arguments.HelperTaskUser = $HelperTaskUser
}
if ($StartHelperTask) {
    $arguments.StartHelperTask = $true
}

& $installScriptPath @arguments
