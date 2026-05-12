[CmdletBinding()]
param(
    [string]$Configuration = 'Release',
    [string]$RuntimeIdentifier = 'win-x64',
    [bool]$SelfContained = $true,
    [switch]$CreateZip,
    [string]$PackageOutputRoot = '',
    [switch]$UseExistingPublish,
    [string]$ExistingPublishRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
}
else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}

$projectPath = Join-Path $scriptRoot 'EmployeeBehavior.Agent.InstallerPackage.proj'
if (-not (Test-Path -LiteralPath $projectPath -PathType Leaf)) {
    throw "Installer package project not found: $projectPath"
}

$agentRoot = (Resolve-Path (Join-Path $scriptRoot '..')).Path
$resolvedOutputRoot = if ([string]::IsNullOrWhiteSpace($PackageOutputRoot)) {
    Join-Path $scriptRoot 'artifacts'
}
else {
    [System.IO.Path]::GetFullPath($PackageOutputRoot)
}

function Get-DotNetCommandPath {
    $command = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($null -ne $command -and -not [string]::IsNullOrWhiteSpace($command.Source)) {
        return $command.Source
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($env:DOTNET_ROOT)) {
        $candidates.Add((Join-Path $env:DOTNET_ROOT 'dotnet.exe'))
    }

    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        $candidates.Add((Join-Path $env:USERPROFILE '.dotnet\dotnet.exe'))
    }

    $candidates.Add('C:\Program Files\dotnet\dotnet.exe')
    $candidates.Add('C:\Program Files (x86)\dotnet\dotnet.exe')

    foreach ($candidate in $candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    return ''
}

function Remove-PathIfExists {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function Ensure-Directory {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Assert-PathExists {
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$Label,
        [ValidateSet('Leaf', 'Container')]
        [string]$PathType
    )

    if (-not (Test-Path -LiteralPath $Path -PathType $PathType)) {
        throw "$Label not found: $Path"
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
        Copy-Item -LiteralPath $_.FullName -Destination $destinationPath -Recurse -Force
    }
}

function Build-PackageFromExistingPublish {
    param(
        [Parameter(Mandatory)]
        [string]$PublishRoot
    )

    $resolvedPublishRoot = [System.IO.Path]::GetFullPath($PublishRoot)
    $packageName = 'EmployeeBehavior.Agent.InstallerPackage'
    $stageDirectory = Join-Path $resolvedOutputRoot $packageName
    $zipPath = Join-Path $resolvedOutputRoot "$packageName.zip"
    $payloadRoot = Join-Path $stageDirectory 'payload'
    $serviceTarget = Join-Path $payloadRoot 'Service'
    $helperTarget = Join-Path $payloadRoot 'SessionHelper'
    $launcherTarget = Join-Path $payloadRoot 'Launcher'
    $toolsTarget = Join-Path $stageDirectory 'tools'

    Assert-PathExists -Path $resolvedPublishRoot -Label 'Existing publish root' -PathType Container
    Assert-PathExists -Path (Join-Path $resolvedPublishRoot 'Service') -Label 'Existing service publish directory' -PathType Container
    Assert-PathExists -Path (Join-Path $resolvedPublishRoot 'SessionHelper') -Label 'Existing session helper publish directory' -PathType Container
    Assert-PathExists -Path (Join-Path $resolvedPublishRoot 'Launcher') -Label 'Existing launcher publish directory' -PathType Container

    Remove-PathIfExists -Path $stageDirectory
    Remove-PathIfExists -Path $zipPath
    Ensure-Directory -Path $toolsTarget

    Copy-DirectoryContents -SourceDirectory (Join-Path $resolvedPublishRoot 'Service') -TargetDirectory $serviceTarget
    Copy-DirectoryContents -SourceDirectory (Join-Path $resolvedPublishRoot 'SessionHelper') -TargetDirectory $helperTarget
    Copy-DirectoryContents -SourceDirectory (Join-Path $resolvedPublishRoot 'Launcher') -TargetDirectory $launcherTarget

    foreach ($launcherRootFile in @(
        'EmployeeBehavior.Agent.Launcher.exe',
        'EmployeeBehavior.Agent.Launcher.dll',
        'EmployeeBehavior.Agent.Launcher.runtimeconfig.json',
        'EmployeeBehavior.Agent.Launcher.deps.json',
        'EmployeeBehavior.Agent.Launcher.pdb'
    )) {
        $sourcePath = Join-Path $resolvedPublishRoot $launcherRootFile
        if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
            Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $launcherTarget $launcherRootFile) -Force
        }
    }

    Copy-Item -LiteralPath (Join-Path $agentRoot 'scripts\Set-AgentProductionConfig.ps1') -Destination (Join-Path $serviceTarget 'Set-AgentProductionConfig.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $agentRoot 'scripts\Write-AgentProtectedToken.ps1') -Destination (Join-Path $serviceTarget 'Write-AgentProtectedToken.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $scriptRoot 'package\Install-AgentInstallerPackage.ps1') -Destination (Join-Path $stageDirectory 'Install-AgentInstallerPackage.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $scriptRoot 'package\Run-AgentInstalledAcceptance.ps1') -Destination (Join-Path $stageDirectory 'Run-AgentInstalledAcceptance.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $scriptRoot 'package\Uninstall-AgentInstallerPackage.ps1') -Destination (Join-Path $stageDirectory 'Uninstall-AgentInstallerPackage.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $scriptRoot 'package\README.md') -Destination (Join-Path $stageDirectory 'README.md') -Force
    Copy-Item -LiteralPath (Join-Path $scriptRoot 'package\Validate-AgentInstallerPackage.ps1') -Destination (Join-Path $stageDirectory 'Validate-AgentInstallerPackage.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $agentRoot 'scripts\Test-AgentInstallerPackage.ps1') -Destination (Join-Path $stageDirectory 'Test-AgentInstallerPackage.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $agentRoot 'scripts\Install-AgentPilot.ps1') -Destination (Join-Path $toolsTarget 'Install-AgentPilot.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $agentRoot 'scripts\Uninstall-AgentPilot.ps1') -Destination (Join-Path $toolsTarget 'Uninstall-AgentPilot.ps1') -Force
    Copy-Item -LiteralPath (Join-Path $agentRoot 'scripts\Test-AgentDeployment.ps1') -Destination (Join-Path $toolsTarget 'Test-AgentDeployment.ps1') -Force

    $validatorPath = Join-Path $agentRoot 'scripts\Test-AgentInstallerPackage.ps1'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $validatorPath -PackageRoot $stageDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "Installer package validation failed with exit code $LASTEXITCODE."
    }

    if ($CreateZip.IsPresent) {
        Compress-Archive -Path $stageDirectory -DestinationPath $zipPath -Force
    }
}

$dotnetPath = Get-DotNetCommandPath
$resolvedPublishRoot = if ([string]::IsNullOrWhiteSpace($ExistingPublishRoot)) {
    Join-Path $agentRoot 'publish'
}
else {
    [System.IO.Path]::GetFullPath($ExistingPublishRoot)
}

if ($UseExistingPublish.IsPresent -or [string]::IsNullOrWhiteSpace($dotnetPath)) {
    Build-PackageFromExistingPublish -PublishRoot $resolvedPublishRoot
    return
}

$arguments = @(
    'msbuild',
    $projectPath,
    '-t:BuildPackage',
    "-p:Configuration=$Configuration",
    "-p:RuntimeIdentifier=$RuntimeIdentifier",
    "-p:SelfContained=$SelfContained",
    "-p:CreateZip=$($CreateZip.IsPresent)",
    "-p:PackageOutputRoot=$resolvedOutputRoot",
    "-p:DotNetExe=$dotnetPath"
)

& $dotnetPath @arguments
if ($LASTEXITCODE -ne 0) {
    throw "dotnet msbuild failed with exit code $LASTEXITCODE."
}
