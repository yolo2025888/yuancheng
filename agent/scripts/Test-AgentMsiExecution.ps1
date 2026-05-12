[CmdletBinding()]
param(
    [string]$MsiPath = '.\agent\installer\wix\bin\Release\EmployeeBehavior.Agent.Installer.msi',
    [string]$HelperTaskUser = ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name),
    [string]$InstallRoot = 'C:\Program Files\EmployeeBehaviorAgent-MsiProbe',
    [string]$DataDirectory = 'C:\ProgramData\EmployeeBehaviorAgent-MsiProbe',
    [string]$EmployeeCode = 'E-001',
    [string]$ReportDirectory = '.\agent\installer\msi-execution-report',
    [switch]$Cleanup
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

function Test-IsAdministrator {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-Msiexec {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments,
        [Parameter(Mandatory)]
        [string]$LogPath
    )

    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $Arguments -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0) {
        throw "msiexec exited with code $($process.ExitCode). See log: $LogPath"
    }
}

if (-not (Test-IsAdministrator)) {
    throw 'Test-AgentMsiExecution.ps1 must be run from an elevated PowerShell session.'
}

$resolvedMsiPath = Resolve-FullPath -Path $MsiPath
if (-not (Test-Path -LiteralPath $resolvedMsiPath -PathType Leaf)) {
    throw "MSI not found: $resolvedMsiPath"
}

$resolvedReportDirectory = Resolve-FullPath -Path $ReportDirectory
New-Item -ItemType Directory -Path $resolvedReportDirectory -Force | Out-Null

$installLogPath = Join-Path $resolvedReportDirectory 'msiexec-install.log'
$validateLogPath = Join-Path $resolvedReportDirectory 'packaged-validate.log'
$uninstallLogPath = Join-Path $resolvedReportDirectory 'msiexec-uninstall.log'
$deploymentReportPath = Join-Path $resolvedReportDirectory 'deployment-report.json'
$lifecycleReportPath = Join-Path $resolvedReportDirectory 'lifecycle-result.json'
$summaryPath = Join-Path $resolvedReportDirectory 'msi-execution-summary.json'

$packageRoot = Join-Path $InstallRoot 'InstallerPackage'
$validateScriptPath = Join-Path $packageRoot 'Validate-AgentInstallerPackage.ps1'

$summary = [ordered]@{
    MsiPath = $resolvedMsiPath
    HelperTaskUser = $HelperTaskUser
    InstallRoot = $InstallRoot
    DataDirectory = $DataDirectory
    ReportDirectory = $resolvedReportDirectory
    StartedAt = (Get-Date).ToString('O')
    InstallSucceeded = $false
    ValidateSucceeded = $false
    UninstallSucceeded = $false
}

try {
    Invoke-Msiexec -Arguments @(
        '/i', $resolvedMsiPath,
        '/qn',
        '/norestart',
        'RUNPACKAGEDINSTALL=1',
        "HELPERTASKUSER=$HelperTaskUser",
        "AGENTINSTALLROOT=$InstallRoot",
        "AGENTDATADIR=$DataDirectory",
        "AGENTLOGDIR=$(Join-Path $DataDirectory 'logs')",
        '/l*v', $installLogPath
    ) -LogPath $installLogPath
    $summary.InstallSucceeded = $true

    if (-not (Test-Path -LiteralPath $validateScriptPath -PathType Leaf)) {
        throw "Packaged validate script not found after MSI install: $validateScriptPath"
    }

    & $validateScriptPath `
        -PackageRoot $packageRoot `
        -InstallRoot $InstallRoot `
        -DataDirectory $DataDirectory `
        -RequireInstalledHelperTask `
        -RunLifecycleSmoke `
        -EmployeeCode $EmployeeCode `
        -DeploymentReportPath $deploymentReportPath `
        -LifecycleReportPath $lifecycleReportPath 2>&1 | Tee-Object -FilePath $validateLogPath | Out-Host
    $summary.ValidateSucceeded = $true
}
finally {
    if ($Cleanup) {
        try {
            Invoke-Msiexec -Arguments @(
                '/x', $resolvedMsiPath,
                '/qn',
                '/norestart',
                'RUNPACKAGEDUNINSTALL=1',
                "AGENTINSTALLROOT=$InstallRoot",
                "AGENTDATADIR=$DataDirectory",
                'REMOVEINSTALLEDFILES=1',
                '/l*v', $uninstallLogPath
            ) -LogPath $uninstallLogPath
            $summary.UninstallSucceeded = $true
        }
        catch {
            $summary.UninstallSucceeded = $false
            throw
        }
    }

    $summary.CompletedAt = (Get-Date).ToString('O')
    $summary.InstallLogPath = $installLogPath
    $summary.ValidateLogPath = $validateLogPath
    $summary.DeploymentReportPath = $deploymentReportPath
    $summary.LifecycleReportPath = $lifecycleReportPath
    $summary.UninstallLogPath = $uninstallLogPath
    [pscustomobject]$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
}
