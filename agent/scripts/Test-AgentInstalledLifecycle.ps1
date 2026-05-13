[CmdletBinding()]
param(
    [string]$LauncherExecutablePath = 'C:\Program Files\EmployeeBehaviorAgent\Launcher\EmployeeBehavior.Agent.Launcher.exe',
    [string]$DataDirectory = 'C:\ProgramData\EmployeeBehaviorAgent',
    [string]$EmployeeCode = 'E-001',
    [int]$StartupTimeoutSeconds = 10,
    [int]$ClockInTimeoutSeconds = 20,
    [switch]$RequireInstalledService,
    [switch]$RequireInstalledHelperTask,
    [string]$ReportPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$launcherProcessName = 'EmployeeBehavior.Agent.Launcher'
$backgroundProcessNames = @(
    'EmployeeBehavior.Agent.Service',
    'EmployeeBehavior.Agent.SessionHelper'
)
$attendanceLogPath = Join-Path $DataDirectory 'attendance-log.jsonl'
$attendancePendingPath = Join-Path $DataDirectory 'attendance-pending.jsonl'
$workSessionStatePath = Join-Path $DataDirectory 'work-session-state.json'

function Test-IsAdministrator {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-ServiceRegistrationPresent {
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName
    )

    return $null -ne (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
}

function Test-ScheduledTaskRegistrationPresent {
    param(
        [Parameter(Mandatory)]
        [string]$TaskName
    )

    if ($null -eq (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) {
        return $false
    }

    return $null -ne (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
}

function Get-ProcessIdsByName {
    param([string]$Name)
    return @(Get-Process -Name $Name -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}

function Wait-ForProcessStart {
    param(
        [string]$Name,
        [int[]]$BeforeIds,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
    do {
        $newIds = @(Get-ProcessIdsByName -Name $Name | Where-Object { $BeforeIds -notcontains $_ })
        if ($newIds.Count -gt 0) {
            return $newIds[0]
        }

        Start-Sleep -Milliseconds 500
    }
    while ((Get-Date) -lt $deadline)

    throw "Timed out waiting for process '$Name' to start."
}

function Wait-ForProcessExit {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds
    )

    if ($Process.WaitForExit([Math]::Max(1000, $TimeoutSeconds * 1000))) {
        return
    }

    throw "Timed out waiting for process '$($Process.ProcessName)' to exit."
}

function Backup-OptionalFile {
    param(
        [string]$Path,
        [string]$BackupDirectory
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    $target = Join-Path $BackupDirectory ([System.IO.Path]::GetFileName($Path) + '.bak')
    Copy-Item -LiteralPath $Path -Destination $target -Force
    return $target
}

function Restore-OptionalFile {
    param(
        [string]$Path,
        [string]$BackupPath
    )

    if ([string]::IsNullOrWhiteSpace($BackupPath)) {
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            Remove-Item -LiteralPath $Path -Force
        }
        return
    }

    Copy-Item -LiteralPath $BackupPath -Destination $Path -Force
}

function Read-OptionalContent {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return ''
    }

    return Get-Content -LiteralPath $Path -Raw
}

$resolvedLauncherPath = [System.IO.Path]::GetFullPath($LauncherExecutablePath)
if (-not (Test-Path -LiteralPath $resolvedLauncherPath -PathType Leaf)) {
    throw "Launcher executable not found: $resolvedLauncherPath"
}

if (-not (Test-IsAdministrator)) {
    throw 'Test-AgentInstalledLifecycle.ps1 must be run from an elevated PowerShell session. The installed acceptance flow reads protected files under C:\ProgramData\EmployeeBehaviorAgent\ and requires Administrator rights.'
}

$serviceRegistered = Test-ServiceRegistrationPresent -ServiceName 'EmployeeBehavior.Agent.Service'
$helperTaskRegistered = Test-ScheduledTaskRegistrationPresent -TaskName 'EmployeeBehavior.Agent.SessionHelper'
if ($RequireInstalledService -and -not $serviceRegistered) {
    throw 'Installed lifecycle smoke requires EmployeeBehavior.Agent.Service registration, but it was not found.'
}
if ($RequireInstalledHelperTask -and -not $helperTaskRegistered) {
    throw 'Installed lifecycle smoke requires EmployeeBehavior.Agent.SessionHelper scheduled task registration, but it was not found.'
}

$backgroundBefore = @{}
foreach ($name in $backgroundProcessNames) {
    $backgroundBefore[$name] = @(Get-ProcessIdsByName -Name $name)
}

$launcherBefore = @(Get-ProcessIdsByName -Name $launcherProcessName)
$backupDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('agent-installed-lifecycle-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backupDirectory | Out-Null

$attendanceLogBackup = Backup-OptionalFile -Path $attendanceLogPath -BackupDirectory $backupDirectory
$attendancePendingBackup = Backup-OptionalFile -Path $attendancePendingPath -BackupDirectory $backupDirectory
$workSessionStateBackup = Backup-OptionalFile -Path $workSessionStatePath -BackupDirectory $backupDirectory

try {
    $preClockInLauncher = Start-Process -FilePath $resolvedLauncherPath -WorkingDirectory (Split-Path -Parent $resolvedLauncherPath) -PassThru
    $preClockInLauncherId = Wait-ForProcessStart -Name $launcherProcessName -BeforeIds $launcherBefore -TimeoutSeconds $StartupTimeoutSeconds

    foreach ($name in $backgroundProcessNames) {
        $newIds = @((Get-ProcessIdsByName -Name $name) | Where-Object { $backgroundBefore[$name] -notcontains $_ })
        if ($newIds.Count -gt 0) {
            throw "Opening the installed launcher started background process '$name' before clock-in."
        }
    }

    Stop-Process -Id $preClockInLauncherId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    $clockInProcess = Start-Process `
        -FilePath $resolvedLauncherPath `
        -WorkingDirectory (Split-Path -Parent $resolvedLauncherPath) `
        -ArgumentList '--auto-clock-in', $EmployeeCode, '--exit-after-clock-in' `
        -PassThru
    Wait-ForProcessExit -Process $clockInProcess -TimeoutSeconds $ClockInTimeoutSeconds
    if ($clockInProcess.ExitCode -ne 0) {
        throw "Launcher automation clock-in exited with code $($clockInProcess.ExitCode)."
    }

    foreach ($name in $backgroundProcessNames) {
        $newIds = @((Get-ProcessIdsByName -Name $name) | Where-Object { $backgroundBefore[$name] -notcontains $_ })
        if ($newIds.Count -gt 0) {
            throw "Installed launcher clock-in started new background process '$name', which should remain service/task-managed."
        }
    }

    $workSessionStateRaw = Read-OptionalContent -Path $workSessionStatePath
    if ([string]::IsNullOrWhiteSpace($workSessionStateRaw)) {
        throw "Work session state file was not written at '$workSessionStatePath'."
    }

    $workSessionState = $workSessionStateRaw | ConvertFrom-Json
    if ($workSessionState.SessionStatus -ne 'clocked_in') {
        throw "Expected SessionStatus 'clocked_in', got '$($workSessionState.SessionStatus)'."
    }

    $attendanceLogRaw = Read-OptionalContent -Path $attendanceLogPath
    if ($attendanceLogRaw -notmatch [regex]::Escape($EmployeeCode) -or $attendanceLogRaw -notmatch 'clock_in') {
        throw "Attendance log did not record a clock_in entry for '$EmployeeCode'."
    }

    $attendancePendingRaw = Read-OptionalContent -Path $attendancePendingPath
    if ($attendancePendingRaw -notmatch [regex]::Escape($EmployeeCode) -or $attendancePendingRaw -notmatch 'clock_in') {
        throw "Attendance pending queue did not record a clock_in entry for '$EmployeeCode'."
    }

    $result = [pscustomobject]@{
        Status = 'PASS'
        LauncherExecutablePath = $resolvedLauncherPath
        ServiceRegistered = $serviceRegistered
        HelperTaskRegistered = $helperTaskRegistered
        WorkSessionStatePath = $workSessionStatePath
        AttendanceLogPath = $attendanceLogPath
        AttendancePendingPath = $attendancePendingPath
        EmployeeCode = $EmployeeCode
    }
    if (-not [string]::IsNullOrWhiteSpace($ReportPath)) {
        $resolvedReportPath = [System.IO.Path]::GetFullPath($ReportPath)
        $reportDirectory = Split-Path -Parent $resolvedReportPath
        if (-not [string]::IsNullOrWhiteSpace($reportDirectory)) {
            New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
        }

        $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8
    }
    $result
}
finally {
    foreach ($name in @($launcherProcessName) + $backgroundProcessNames) {
        $currentIds = @(Get-ProcessIdsByName -Name $name)
        foreach ($id in $currentIds) {
            $keepIds = if ($name -eq $launcherProcessName) { $launcherBefore } else { $backgroundBefore[$name] }
            if ($keepIds -notcontains $id) {
                Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Restore-OptionalFile -Path $attendanceLogPath -BackupPath $attendanceLogBackup
    Restore-OptionalFile -Path $attendancePendingPath -BackupPath $attendancePendingBackup
    Restore-OptionalFile -Path $workSessionStatePath -BackupPath $workSessionStateBackup

    if (Test-Path -LiteralPath $backupDirectory) {
        Remove-Item -LiteralPath $backupDirectory -Recurse -Force
    }
}
