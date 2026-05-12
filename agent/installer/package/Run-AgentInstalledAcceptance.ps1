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
    [string]$ReportDirectory = '',
    [switch]$StartHelperTask,
    [switch]$SkipInstall,
    [switch]$SkipValidate,
    [switch]$ArchiveReport,
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
$resolvedReportDirectory = if ([string]::IsNullOrWhiteSpace($ReportDirectory)) {
    Join-Path $resolvedPackageRoot 'acceptance-report'
}
else {
    Resolve-FullPath -Path $ReportDirectory
}

New-Item -ItemType Directory -Path $resolvedReportDirectory -Force | Out-Null

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
    DeploymentReportPath = Join-Path $resolvedReportDirectory 'deployment-report.json'
    LifecycleReportPath = Join-Path $resolvedReportDirectory 'lifecycle-result.json'
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

$summary = [ordered]@{
    PackageRoot = $resolvedPackageRoot
    InstallRoot = $InstallRoot
    DataDirectory = $DataDirectory
    ReportDirectory = $resolvedReportDirectory
    EmployeeCode = $EmployeeCode
    StartedAt = (Get-Date).ToString('O')
    InstallSucceeded = $false
    ValidateSucceeded = $false
    CleanupExecuted = $false
    ArchiveReport = [bool]$ArchiveReport
}

[pscustomobject]@{
    MachineName = $env:COMPUTERNAME
    UserName = $env:USERNAME
    HelperTaskUser = $HelperTaskUser
    InstallRoot = $InstallRoot
    DataDirectory = $DataDirectory
    LogDirectory = $LogDirectory
    PackageRoot = $resolvedPackageRoot
    ServiceConfigPath = if ([string]::IsNullOrWhiteSpace($ServiceConfigPath)) { '' } else { Resolve-FullPath -Path $ServiceConfigPath }
    HelperConfigPath = if ([string]::IsNullOrWhiteSpace($HelperConfigPath)) { '' } else { Resolve-FullPath -Path $HelperConfigPath }
    GeneratedAt = (Get-Date).ToString('O')
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $resolvedReportDirectory 'environment.json') -Encoding UTF8

try {
    if (-not $SkipInstall) {
        & $installScriptPath @installArguments 2>&1 | Tee-Object -FilePath (Join-Path $resolvedReportDirectory 'install.log') | Out-Host
        $summary.InstallSucceeded = $true
    }

    if (-not $SkipValidate) {
        & $validateScriptPath @validateArguments 2>&1 | Tee-Object -FilePath (Join-Path $resolvedReportDirectory 'validate.log') | Out-Host
        $summary.ValidateSucceeded = $true
    }
}
finally {
    if ($Cleanup) {
        & $uninstallScriptPath @uninstallArguments 2>&1 | Tee-Object -FilePath (Join-Path $resolvedReportDirectory 'cleanup.log') | Out-Host
        $summary.CleanupExecuted = $true
    }

    $summary.CompletedAt = (Get-Date).ToString('O')
    $summary.DeploymentReportPath = Join-Path $resolvedReportDirectory 'deployment-report.json'
    $summary.LifecycleReportPath = Join-Path $resolvedReportDirectory 'lifecycle-result.json'
    $summary.EnvironmentReportPath = Join-Path $resolvedReportDirectory 'environment.json'
    $summaryPath = Join-Path $resolvedReportDirectory 'acceptance-summary.json'
    $summary.AcceptanceSummaryPath = $summaryPath
    $reportArchivePath = $null
    if ($ArchiveReport) {
        $reportArchivePath = $resolvedReportDirectory.TrimEnd('\') + '.zip'
        if (Test-Path -LiteralPath $reportArchivePath) {
            Remove-Item -LiteralPath $reportArchivePath -Force
        }

        Compress-Archive -Path (Join-Path $resolvedReportDirectory '*') -DestinationPath $reportArchivePath -CompressionLevel Optimal
    }
    $summary.ReportArchivePath = $reportArchivePath
    [pscustomobject]$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
}
