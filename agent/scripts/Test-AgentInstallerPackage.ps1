[CmdletBinding()]
param(
    [string]$PackageRoot = '',
    [switch]$RequireZip,
    [string]$ZipPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$results = New-Object System.Collections.Generic.List[object]
$hasFailure = $false

function Add-CheckResult {
    param(
        [string]$Check,
        [string]$Status,
        [string]$Detail
    )

    $script:results.Add([pscustomobject]@{
        Check = $Check
        Status = $Status
        Detail = $Detail
    })

    if ($Status -eq 'FAIL') {
        $script:hasFailure = $true
    }
}

function Resolve-DefaultPackageRoot {
    $scriptRoot = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $PSScriptRoot
    }
    else {
        Split-Path -Parent $MyInvocation.MyCommand.Path
    }

    $candidateRoots = @(
        (Join-Path $scriptRoot '..\installer\artifacts\EmployeeBehavior.Agent.InstallerPackage'),
        (Join-Path $scriptRoot '..\installer\artifacts'),
        $scriptRoot
    )

    foreach ($candidate in $candidateRoots) {
        $resolvedCandidate = [System.IO.Path]::GetFullPath($candidate)
        if (Test-Path -LiteralPath (Join-Path $resolvedCandidate 'payload') -PathType Container) {
            return $resolvedCandidate
        }
    }

    return [System.IO.Path]::GetFullPath((Join-Path $scriptRoot '..\installer\artifacts\EmployeeBehavior.Agent.InstallerPackage'))
}

function Test-RequiredDirectory {
    param(
        [string]$Path,
        [string]$Check
    )

    if (Test-Path -LiteralPath $Path -PathType Container) {
        Add-CheckResult -Check $Check -Status 'PASS' -Detail "Found directory '$Path'."
        return $true
    }

    Add-CheckResult -Check $Check -Status 'FAIL' -Detail "Missing directory '$Path'."
    return $false
}

function Test-RequiredFile {
    param(
        [string]$Path,
        [string]$Check
    )

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Add-CheckResult -Check $Check -Status 'PASS' -Detail "Found file '$Path'."
        return $true
    }

    Add-CheckResult -Check $Check -Status 'FAIL' -Detail "Missing file '$Path'."
    return $false
}

function Test-JsonFile {
    param(
        [string]$Path,
        [string]$Check
    )

    if (-not (Test-RequiredFile -Path $Path -Check $Check)) {
        return $false
    }

    try {
        Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json | Out-Null
        Add-CheckResult -Check "$Check JSON" -Status 'PASS' -Detail "Parsed JSON from '$Path'."
        return $true
    }
    catch {
        Add-CheckResult -Check "$Check JSON" -Status 'FAIL' -Detail "Could not parse JSON from '$Path': $($_.Exception.Message)"
        return $false
    }
}

function Test-OptionalZipFile {
    param(
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Add-CheckResult -Check 'Zip archive' -Status 'FAIL' -Detail 'Zip archive path was not provided.'
        return
    }

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Add-CheckResult -Check 'Zip archive' -Status 'PASS' -Detail "Found zip archive '$Path'."
    }
    else {
        Add-CheckResult -Check 'Zip archive' -Status 'FAIL' -Detail "Missing zip archive '$Path'."
    }
}

$resolvedPackageRoot = if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
    Resolve-DefaultPackageRoot
}
else {
    [System.IO.Path]::GetFullPath($PackageRoot)
}

if (Test-Path -LiteralPath $resolvedPackageRoot -PathType Container) {
    Add-CheckResult -Check 'Package root' -Status 'PASS' -Detail "Using package root '$resolvedPackageRoot'."
}
else {
    Add-CheckResult -Check 'Package root' -Status 'FAIL' -Detail "Package root '$resolvedPackageRoot' does not exist."
}

$payloadRoot = Join-Path $resolvedPackageRoot 'payload'
$toolsRoot = Join-Path $resolvedPackageRoot 'tools'
$serviceRoot = Join-Path $payloadRoot 'Service'
$helperRoot = Join-Path $payloadRoot 'SessionHelper'
$launcherRoot = Join-Path $payloadRoot 'Launcher'

$payloadRootExists = Test-RequiredDirectory -Path $payloadRoot -Check 'Payload root directory'
$toolsRootExists = Test-RequiredDirectory -Path $toolsRoot -Check 'Tools directory'
$serviceRootExists = Test-RequiredDirectory -Path $serviceRoot -Check 'Service payload directory'
$helperRootExists = Test-RequiredDirectory -Path $helperRoot -Check 'Session helper payload directory'
$launcherRootExists = Test-RequiredDirectory -Path $launcherRoot -Check 'Launcher payload directory'

foreach ($rootFile in @(
    'README.md',
    'Install-AgentInstallerPackage.ps1',
    'Invoke-MsiPackagedInstall.ps1',
    'Invoke-MsiPackagedUninstall.ps1',
    'Run-AgentInstalledAcceptance.ps1',
    'Validate-AgentInstallerPackage.ps1',
    'Uninstall-AgentInstallerPackage.ps1',
    'Test-AgentInstallerPackage.ps1'
)) {
    $null = Test-RequiredFile -Path (Join-Path $resolvedPackageRoot $rootFile) -Check "Root file $rootFile"
}

if ($toolsRootExists) {
    foreach ($toolFile in @(
    'Install-AgentPilot.ps1',
    'Uninstall-AgentPilot.ps1',
    'Test-AgentDeployment.ps1',
    'Test-AgentInstalledLifecycle.ps1'
    )) {
        $null = Test-RequiredFile -Path (Join-Path $toolsRoot $toolFile) -Check "Bundled tool $toolFile"
    }
}

if ($serviceRootExists) {
    $null = Test-RequiredFile -Path (Join-Path $serviceRoot 'EmployeeBehavior.Agent.Service.exe') -Check 'Service executable'
    $null = Test-JsonFile -Path (Join-Path $serviceRoot 'appsettings.json') -Check 'Service config'
    $null = Test-JsonFile -Path (Join-Path $serviceRoot 'appsettings.json.example') -Check 'Service example config'
    $null = Test-RequiredFile -Path (Join-Path $serviceRoot 'Set-AgentProductionConfig.ps1') -Check 'Service production config script'
    $null = Test-RequiredFile -Path (Join-Path $serviceRoot 'Write-AgentProtectedToken.ps1') -Check 'Service protected token script'
}

if ($helperRootExists) {
    $null = Test-RequiredFile -Path (Join-Path $helperRoot 'EmployeeBehavior.Agent.SessionHelper.exe') -Check 'Session helper executable'
    $null = Test-JsonFile -Path (Join-Path $helperRoot 'appsettings.json') -Check 'Session helper config'
    $null = Test-JsonFile -Path (Join-Path $helperRoot 'appsettings.json.example') -Check 'Session helper example config'
}

if ($launcherRootExists) {
    $launcherExePath = Join-Path $launcherRoot 'EmployeeBehavior.Agent.Launcher.exe'
    $null = Test-RequiredFile -Path $launcherExePath -Check 'Launcher executable'

    $launcherDllPath = Join-Path $launcherRoot 'EmployeeBehavior.Agent.Launcher.dll'
    $launcherRuntimeConfigPath = Join-Path $launcherRoot 'EmployeeBehavior.Agent.Launcher.runtimeconfig.json'
    $hasLauncherDll = Test-Path -LiteralPath $launcherDllPath -PathType Leaf
    $hasLauncherRuntimeConfig = Test-Path -LiteralPath $launcherRuntimeConfigPath -PathType Leaf

    if ($hasLauncherDll -or $hasLauncherRuntimeConfig) {
        if ($hasLauncherDll -and $hasLauncherRuntimeConfig) {
            Add-CheckResult -Check 'Launcher runtime files' -Status 'PASS' -Detail 'Launcher includes framework-dependent runtime files.'
        }
        else {
            Add-CheckResult -Check 'Launcher runtime files' -Status 'FAIL' -Detail 'Launcher runtime files are incomplete: require both DLL and runtimeconfig when either is present.'
        }
    }
    else {
        Add-CheckResult -Check 'Launcher runtime files' -Status 'PASS' -Detail 'Launcher appears bundled as a single-file payload.'
    }
}

if ($RequireZip) {
    $resolvedZipPath = if ([string]::IsNullOrWhiteSpace($ZipPath)) {
        $parentDirectory = Split-Path -Parent $resolvedPackageRoot
        Join-Path $parentDirectory ((Split-Path -Leaf $resolvedPackageRoot) + '.zip')
    }
    else {
        [System.IO.Path]::GetFullPath($ZipPath)
    }

    Test-OptionalZipFile -Path $resolvedZipPath
}

$results | Format-Table -AutoSize | Out-String | Write-Output

if ($hasFailure) {
    throw 'Installer package validation failed.'
}

Write-Output "Installer package validation passed for '$resolvedPackageRoot'."
