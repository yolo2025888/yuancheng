[CmdletBinding()]
param(
    [string]$Configuration = 'Release',
    [string]$PackageOutputRoot = '',
    [switch]$RebuildInstallerPayload,
    [switch]$CreateZip
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

function Get-DotNetCommandPath {
    $command = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($null -ne $command -and -not [string]::IsNullOrWhiteSpace($command.Source)) {
        return $command.Source
    }

    $candidatePaths = @()
    if (-not [string]::IsNullOrWhiteSpace($env:DOTNET_ROOT)) {
        $candidatePaths += (Join-Path $env:DOTNET_ROOT 'dotnet.exe')
    }
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $candidatePaths += (Join-Path $env:USERPROFILE '.dotnet\dotnet.exe')
    }
    $candidatePaths += 'C:\Program Files\dotnet\dotnet.exe'
    $candidatePaths += 'C:\Program Files (x86)\dotnet\dotnet.exe'

    foreach ($candidatePath in $candidatePaths) {
        if (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
            return $candidatePath
        }
    }

    throw 'dotnet executable was not found. Install .NET SDK 8 or set DOTNET_ROOT.'
}

$scriptRoot = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
}
else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}

$dotnetPath = Get-DotNetCommandPath
$installerPackageProject = Join-Path $scriptRoot 'EmployeeBehavior.Agent.InstallerPackage.proj'
$wixProject = Join-Path $scriptRoot 'wix\EmployeeBehavior.Agent.Installer.wixproj'
$buildInstallerPackageScript = Join-Path $scriptRoot 'Build-AgentInstallerPackage.ps1'
$resolvedPackageOutputRoot = if ([string]::IsNullOrWhiteSpace($PackageOutputRoot)) {
    Join-Path $scriptRoot 'artifacts'
}
else {
    Resolve-FullPath -Path $PackageOutputRoot
}
$installerPayloadRoot = Join-Path $resolvedPackageOutputRoot 'EmployeeBehavior.Agent.InstallerPackage'

if ($RebuildInstallerPayload -or -not (Test-Path -LiteralPath $installerPayloadRoot -PathType Container)) {
    $installerPackageArguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $buildInstallerPackageScript,
        '-PackageOutputRoot', $resolvedPackageOutputRoot
    )
    if ($CreateZip) {
        $installerPackageArguments += '-CreateZip'
    }
    & powershell @installerPackageArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Build-AgentInstallerPackage.ps1 failed with exit code $LASTEXITCODE."
    }
}

if (-not (Test-Path -LiteralPath $installerPayloadRoot -PathType Container)) {
    throw "Installer payload root not found: $installerPayloadRoot"
}

& $dotnetPath build $wixProject -c $Configuration "-p:InstallerPayloadRoot=$installerPayloadRoot"
if ($LASTEXITCODE -ne 0) {
    throw "WiX MSI build failed with exit code $LASTEXITCODE."
}

[pscustomobject]@{
    WixProject = $wixProject
    InstallerPayloadRoot = $installerPayloadRoot
    Configuration = $Configuration
}
