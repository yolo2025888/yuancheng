[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$ServiceName = 'EmployeeBehavior.Agent.Service',
    [string]$HelperTaskName = 'EmployeeBehavior.Agent.SessionHelper',
    [string]$ServiceTargetDirectory = 'C:\Program Files\EmployeeBehaviorAgent\Service',
    [string]$HelperTargetDirectory = 'C:\Program Files\EmployeeBehaviorAgent\SessionHelper',
    [string]$DataDirectory = 'C:\ProgramData\EmployeeBehaviorAgent',
    [switch]$RemoveServiceDirectory,
    [switch]$RemoveHelperDirectory,
    [switch]$RemoveLogDirectory,
    [switch]$RemoveUploadQueue,
    [switch]$RemoveDeviceIdentity
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-FullPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    return [System.IO.Path]::GetFullPath($Path)
}

function Remove-DirectoryIfRequested {
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    if ($PSCmdlet.ShouldProcess($Path, "Remove $Label")) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function Remove-FileIfRequested {
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    if ($PSCmdlet.ShouldProcess($Path, "Remove $Label")) {
        Remove-Item -LiteralPath $Path -Force
    }
}

if (-not (Test-IsAdministrator)) {
    throw 'Uninstall-AgentPilot.ps1 must be run from an elevated PowerShell session.'
}

$resolvedServiceTargetDirectory = Resolve-FullPath -Path $ServiceTargetDirectory
$resolvedHelperTargetDirectory = Resolve-FullPath -Path $HelperTargetDirectory
$resolvedDataDirectory = Resolve-FullPath -Path $DataDirectory
$resolvedLogDirectory = Join-Path -Path $resolvedDataDirectory -ChildPath 'logs'
$resolvedUploadQueuePath = Join-Path -Path $resolvedDataDirectory -ChildPath 'upload-queue.jsonl'
$resolvedDeviceIdentityPath = Join-Path -Path $resolvedDataDirectory -ChildPath 'device-id.json'

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $service) {
    if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped -and
        $PSCmdlet.ShouldProcess($ServiceName, 'Stop Windows service')) {
        Stop-Service -Name $ServiceName -Force
        $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
    }

    if ($PSCmdlet.ShouldProcess($ServiceName, 'Delete Windows service registration')) {
        $null = & sc.exe delete $ServiceName
        if ($LASTEXITCODE -ne 0) {
            throw "sc.exe delete failed for service '$ServiceName' with exit code $LASTEXITCODE."
        }
    }
}

$task = Get-ScheduledTask -TaskName $HelperTaskName -ErrorAction SilentlyContinue
if ($null -ne $task) {
    if ($PSCmdlet.ShouldProcess($HelperTaskName, 'Stop scheduled task')) {
        Stop-ScheduledTask -TaskName $HelperTaskName -ErrorAction SilentlyContinue
    }

    if ($PSCmdlet.ShouldProcess($HelperTaskName, 'Unregister scheduled task')) {
        Unregister-ScheduledTask -TaskName $HelperTaskName -Confirm:$false
    }
}

if ($RemoveServiceDirectory) {
    Remove-DirectoryIfRequested -Path $resolvedServiceTargetDirectory -Label 'service install directory'
}

if ($RemoveHelperDirectory) {
    Remove-DirectoryIfRequested -Path $resolvedHelperTargetDirectory -Label 'helper install directory'
}

if ($RemoveLogDirectory) {
    Remove-DirectoryIfRequested -Path $resolvedLogDirectory -Label 'log directory'
}

if ($RemoveUploadQueue) {
    Remove-FileIfRequested -Path $resolvedUploadQueuePath -Label 'upload queue file'
}

if ($RemoveDeviceIdentity) {
    Remove-FileIfRequested -Path $resolvedDeviceIdentityPath -Label 'device identity file'
}

[pscustomobject]@{
    ServiceName        = $ServiceName
    HelperTaskName     = $HelperTaskName
    ServiceDirectory   = $resolvedServiceTargetDirectory
    HelperDirectory    = $resolvedHelperTargetDirectory
    DataDirectory      = $resolvedDataDirectory
    DeviceIdentityPath = $resolvedDeviceIdentityPath
    UploadQueuePath    = $resolvedUploadQueuePath
}
