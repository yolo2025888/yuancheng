[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$PackageRoot = '',
    [string]$ServiceName = 'EmployeeBehavior.Agent.Service',
    [string]$ServiceDisplayName = 'Employee Behavior Agent Service',
    [string]$HelperTaskName = 'EmployeeBehavior.Agent.SessionHelper',
    [string]$HelperTaskUser = ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name),
    [string]$InstallRoot = 'C:\Program Files\EmployeeBehaviorAgent',
    [string]$DataDirectory = 'C:\ProgramData\EmployeeBehaviorAgent',
    [string]$LogDirectory = 'C:\ProgramData\EmployeeBehaviorAgent\logs',
    [string]$ServiceConfigPath = '',
    [string]$HelperConfigPath = '',
    [string]$HelperArguments = '',
    [switch]$StartService,
    [switch]$StartHelperTask,
    [switch]$SkipLauncher
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
    param(
        [string]$Path
    )

    if (-not [string]::IsNullOrWhiteSpace($Path)) {
        return Resolve-FullPath -Path $Path
    }

    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        return Resolve-FullPath -Path $PSScriptRoot
    }

    return Resolve-FullPath -Path (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

function Assert-DirectoryExists {
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label '$Path' does not exist or is not a directory."
    }
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

function Ensure-Directory {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path -PathType Container) {
        return
    }

    if ($PSCmdlet.ShouldProcess($Path, 'Create directory')) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory)]
        [string]$SourceDirectory,
        [Parameter(Mandatory)]
        [string]$TargetDirectory
    )

    Ensure-Directory -Path $TargetDirectory

    Get-ChildItem -LiteralPath $SourceDirectory -Force | ForEach-Object {
        $destinationPath = Join-Path -Path $TargetDirectory -ChildPath $_.Name
        if ($PSCmdlet.ShouldProcess($destinationPath, "Copy '$($_.FullName)'")) {
            Copy-Item -LiteralPath $_.FullName -Destination $destinationPath -Recurse -Force
        }
    }
}

$resolvedPackageRoot = Resolve-PackageRootPath -Path $PackageRoot
$payloadRoot = Join-Path $resolvedPackageRoot 'payload'
$toolsRoot = Join-Path $resolvedPackageRoot 'tools'
$serviceSourceDirectory = Join-Path $payloadRoot 'Service'
$helperSourceDirectory = Join-Path $payloadRoot 'SessionHelper'
$launcherSourceDirectory = Join-Path $payloadRoot 'Launcher'
$installScriptPath = Join-Path $toolsRoot 'Install-AgentPilot.ps1'
$serviceTargetDirectory = Join-Path $InstallRoot 'Service'
$helperTargetDirectory = Join-Path $InstallRoot 'SessionHelper'
$launcherTargetDirectory = Join-Path $InstallRoot 'Launcher'

Assert-DirectoryExists -Path $resolvedPackageRoot -Label 'Package root'
Assert-DirectoryExists -Path $serviceSourceDirectory -Label 'Service payload directory'
Assert-DirectoryExists -Path $helperSourceDirectory -Label 'Session helper payload directory'
Assert-FileExists -Path $installScriptPath -Label 'Bundled install script'

if (-not $SkipLauncher) {
    Assert-DirectoryExists -Path $launcherSourceDirectory -Label 'Launcher payload directory'
}

$installArguments = @{
    ServiceSourceDirectory = $serviceSourceDirectory
    HelperSourceDirectory = $helperSourceDirectory
    ServiceName = $ServiceName
    ServiceDisplayName = $ServiceDisplayName
    HelperTaskName = $HelperTaskName
    HelperTaskUser = $HelperTaskUser
    ServiceTargetDirectory = $serviceTargetDirectory
    HelperTargetDirectory = $helperTargetDirectory
    DataDirectory = $DataDirectory
    LogDirectory = $LogDirectory
    HelperArguments = $HelperArguments
    WhatIf = $WhatIfPreference
    Confirm = $false
}

if (-not [string]::IsNullOrWhiteSpace($ServiceConfigPath)) {
    $installArguments.ServiceConfigPath = Resolve-FullPath -Path $ServiceConfigPath
}

if (-not [string]::IsNullOrWhiteSpace($HelperConfigPath)) {
    $installArguments.HelperConfigPath = Resolve-FullPath -Path $HelperConfigPath
}

if ($StartService) {
    $installArguments.StartService = $true
}

if ($StartHelperTask) {
    $installArguments.StartHelperTask = $true
}

& $installScriptPath @installArguments

if (-not $SkipLauncher) {
    Copy-DirectoryContents -SourceDirectory $launcherSourceDirectory -TargetDirectory $launcherTargetDirectory
}

[pscustomobject]@{
    PackageRoot = $resolvedPackageRoot
    ServiceSourceDirectory = $serviceSourceDirectory
    HelperSourceDirectory = $helperSourceDirectory
    LauncherSourceDirectory = if ($SkipLauncher) { '' } else { $launcherSourceDirectory }
    ServiceTargetDirectory = $serviceTargetDirectory
    HelperTargetDirectory = $helperTargetDirectory
    LauncherTargetDirectory = if ($SkipLauncher) { '' } else { $launcherTargetDirectory }
    SkipLauncher = [bool]$SkipLauncher
}
