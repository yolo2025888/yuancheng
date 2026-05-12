[CmdletBinding()]
param(
    [string]$PackageRoot = '',
    [string]$HelperTaskUser = ''
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
    StartService = $true
}

if (-not [string]::IsNullOrWhiteSpace($HelperTaskUser)) {
    $arguments.HelperTaskUser = $HelperTaskUser
}

& $installScriptPath @arguments
