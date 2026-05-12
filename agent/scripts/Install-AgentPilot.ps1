[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$ServiceSourceDirectory,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$HelperSourceDirectory,

    [string]$ServiceName = 'EmployeeBehavior.Agent.Service',
    [string]$ServiceDisplayName = 'Employee Behavior Agent Service',
    [string]$HelperTaskName = 'EmployeeBehavior.Agent.SessionHelper',
    [string]$HelperTaskUser = ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name),
    [string]$ServiceTargetDirectory = 'C:\Program Files\EmployeeBehaviorAgent\Service',
    [string]$HelperTargetDirectory = 'C:\Program Files\EmployeeBehaviorAgent\SessionHelper',
    [string]$LauncherSourceDirectory = '',
    [string]$LauncherTargetDirectory = 'C:\Program Files\EmployeeBehaviorAgent\Launcher',
    [string]$DataDirectory = 'C:\ProgramData\EmployeeBehaviorAgent',
    [string]$LogDirectory = 'C:\ProgramData\EmployeeBehaviorAgent\logs',
    [string]$ServiceExeName = 'EmployeeBehavior.Agent.Service.exe',
    [string]$HelperExeName = 'EmployeeBehavior.Agent.SessionHelper.exe',
    [string]$LauncherExeName = 'EmployeeBehavior.Agent.Launcher.exe',
    [string]$ServiceConfigPath,
    [string]$HelperConfigPath,
    [string]$HelperArguments = '',
    [switch]$SkipLauncherInstall,
    [switch]$StartService,
    [switch]$StartHelperTask
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

function Assert-HelperArgumentsSafe {
    param(
        [string]$Arguments
    )

    if ($Arguments -match '(^|\s)--console(\s|$)') {
        throw 'HelperArguments must not include --console. Use direct operator-observed dry-run commands for console validation; installed helper tasks must keep the tray indicator visible.'
    }
}

function Test-LauncherPayloadPresent {
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$ExecutableName
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return $false
    }

    if (Test-Path -LiteralPath (Join-Path -Path $Path -ChildPath $ExecutableName) -PathType Leaf) {
        return $true
    }

    $nestedLauncherDirectory = Join-Path -Path $Path -ChildPath 'Launcher'
    return Test-Path -LiteralPath (Join-Path -Path $nestedLauncherDirectory -ChildPath $ExecutableName) -PathType Leaf
}

function Resolve-LauncherSourceDirectory {
    param(
        [string]$ExplicitPath,
        [Parameter(Mandatory)]
        [string]$ServiceSourceDirectory,
        [Parameter(Mandatory)]
        [string]$HelperSourceDirectory,
        [Parameter(Mandatory)]
        [string]$ExecutableName
    )

    $candidatePaths = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $candidatePaths.Add((Resolve-FullPath -Path $ExplicitPath))
    }
    else {
        $serviceParentDirectory = Split-Path -Path $ServiceSourceDirectory -Parent
        $helperParentDirectory = Split-Path -Path $HelperSourceDirectory -Parent

        foreach ($candidate in @(
            (Join-Path -Path $serviceParentDirectory -ChildPath 'Launcher'),
            (Join-Path -Path $helperParentDirectory -ChildPath 'Launcher'),
            $serviceParentDirectory,
            $helperParentDirectory
        )) {
            $resolvedCandidate = Resolve-FullPath -Path $candidate
            if (-not ($candidatePaths -contains $resolvedCandidate)) {
                $candidatePaths.Add($resolvedCandidate)
            }
        }
    }

    foreach ($candidatePath in $candidatePaths) {
        if (Test-LauncherPayloadPresent -Path $candidatePath -ExecutableName $ExecutableName) {
            return $candidatePath
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        throw "Launcher source directory '$ExplicitPath' does not contain '$ExecutableName' directly or under a nested 'Launcher' directory."
    }

    return $null
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

function Stop-ServiceIfPresent {
    param(
        [Parameter(Mandatory)]
        [string]$Name
    )

    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $service -or $service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
        return
    }

    if ($PSCmdlet.ShouldProcess($Name, 'Stop Windows service')) {
        Stop-Service -Name $Name -Force
        $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
    }
}

function Stop-ScheduledTaskIfPresent {
    param(
        [Parameter(Mandatory)]
        [string]$TaskName
    )

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task -or $task.State -ne 'Running') {
        return
    }

    if ($PSCmdlet.ShouldProcess($TaskName, 'Stop scheduled task')) {
        Stop-ScheduledTask -TaskName $TaskName
    }
}

function Copy-DeploymentPayload {
    param(
        [Parameter(Mandatory)]
        [string]$SourceDirectory,
        [Parameter(Mandatory)]
        [string]$TargetDirectory,
        [string[]]$ExcludeNames = @()
    )

    Ensure-Directory -Path $TargetDirectory

    Get-ChildItem -LiteralPath $SourceDirectory -Force | ForEach-Object {
        if (-not ($ExcludeNames -contains $_.Name)) {
            $destinationPath = Join-Path -Path $TargetDirectory -ChildPath $_.Name
            if ($PSCmdlet.ShouldProcess($destinationPath, "Copy '$($_.FullName)'")) {
                Copy-Item -LiteralPath $_.FullName -Destination $destinationPath -Recurse -Force
            }
        }
    }
}

function Copy-LauncherDeploymentPayload {
    param(
        [Parameter(Mandatory)]
        [string]$SourceDirectory,
        [Parameter(Mandatory)]
        [string]$TargetDirectory,
        [Parameter(Mandatory)]
        [string]$ExecutableName
    )

    $effectiveSourceDirectory = $SourceDirectory
    $nestedLauncherDirectory = Join-Path -Path $SourceDirectory -ChildPath 'Launcher'
    if ((-not (Test-Path -LiteralPath (Join-Path -Path $SourceDirectory -ChildPath $ExecutableName) -PathType Leaf)) -and
        (Test-Path -LiteralPath (Join-Path -Path $nestedLauncherDirectory -ChildPath $ExecutableName) -PathType Leaf)) {
        $effectiveSourceDirectory = $nestedLauncherDirectory
    }

    Ensure-Directory -Path $TargetDirectory

    Get-ChildItem -LiteralPath $effectiveSourceDirectory -Force | ForEach-Object {
        if ($effectiveSourceDirectory -eq $SourceDirectory -and $_.PSIsContainer -and $_.Name -in @('Service', 'SessionHelper', 'Launcher')) {
            return
        }

        $destinationPath = Join-Path -Path $TargetDirectory -ChildPath $_.Name
        if ($PSCmdlet.ShouldProcess($destinationPath, "Copy launcher asset '$($_.FullName)'")) {
            Copy-Item -LiteralPath $_.FullName -Destination $destinationPath -Recurse -Force
        }
    }
}

function Copy-ConfigIfRequested {
    param(
        [string]$ConfigPath,
        [Parameter(Mandatory)]
        [string]$SourceDirectory,
        [Parameter(Mandatory)]
        [string]$TargetDirectory
    )

    $targetConfigPath = Join-Path -Path $TargetDirectory -ChildPath 'appsettings.json'

    if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
        $resolvedConfigPath = Resolve-FullPath -Path $ConfigPath
        Assert-FileExists -Path $resolvedConfigPath -Label 'Config file'

        if ($PSCmdlet.ShouldProcess($targetConfigPath, "Copy config '$resolvedConfigPath'")) {
            Copy-Item -LiteralPath $resolvedConfigPath -Destination $targetConfigPath -Force
        }

        return
    }

    if (Test-Path -LiteralPath $targetConfigPath -PathType Leaf) {
        Write-Verbose "Preserving existing config '$targetConfigPath'."
        return
    }

    $sourceConfigPath = Join-Path -Path $SourceDirectory -ChildPath 'appsettings.json'
    if (Test-Path -LiteralPath $sourceConfigPath -PathType Leaf) {
        if ($PSCmdlet.ShouldProcess($targetConfigPath, "Seed config from '$sourceConfigPath'")) {
            Copy-Item -LiteralPath $sourceConfigPath -Destination $targetConfigPath -Force
        }
    }
}

function Set-ServiceRegistration {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [Parameter(Mandatory)]
        [string]$DisplayName,
        [Parameter(Mandatory)]
        [string]$BinaryPath
    )

    $quotedBinaryPath = '"' + $BinaryPath + '"'
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue

    if ($null -eq $service) {
        if ($PSCmdlet.ShouldProcess($Name, "Create Windows service for '$BinaryPath'")) {
            New-Service -Name $Name -DisplayName $DisplayName -BinaryPathName $quotedBinaryPath -StartupType Automatic | Out-Null
        }

        return
    }

    if ($PSCmdlet.ShouldProcess($Name, "Update Windows service binary path to '$BinaryPath'")) {
        $null = & sc.exe config $Name binPath= $quotedBinaryPath start= auto
        if ($LASTEXITCODE -ne 0) {
            throw "sc.exe config failed for service '$Name' with exit code $LASTEXITCODE."
        }
    }
}

function Register-HelperScheduledTask {
    param(
        [Parameter(Mandatory)]
        [string]$TaskName,
        [Parameter(Mandatory)]
        [string]$UserId,
        [Parameter(Mandatory)]
        [string]$ExecutablePath,
        [string]$Arguments,
        [Parameter(Mandatory)]
        [string]$WorkingDirectory
    )

    $action = if ([string]::IsNullOrWhiteSpace($Arguments)) {
        New-ScheduledTaskAction -Execute $ExecutablePath -WorkingDirectory $WorkingDirectory
    }
    else {
        New-ScheduledTaskAction -Execute $ExecutablePath -Argument $Arguments -WorkingDirectory $WorkingDirectory
    }

    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserId
    $principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

    if ($PSCmdlet.ShouldProcess($TaskName, "Register logon scheduled task for '$ExecutablePath'")) {
        Register-ScheduledTask `
            -TaskName $TaskName `
            -Action $action `
            -Trigger $trigger `
            -Principal $principal `
            -Settings $settings `
            -Description 'Starts the Employee Behavior Agent session helper in the interactive user session.' `
            -Force | Out-Null
    }
}

Assert-HelperArgumentsSafe -Arguments $HelperArguments

if (-not (Test-IsAdministrator)) {
    throw 'Install-AgentPilot.ps1 must be run from an elevated PowerShell session.'
}

$resolvedServiceSourceDirectory = Resolve-FullPath -Path $ServiceSourceDirectory
$resolvedHelperSourceDirectory = Resolve-FullPath -Path $HelperSourceDirectory
$resolvedServiceTargetDirectory = Resolve-FullPath -Path $ServiceTargetDirectory
$resolvedHelperTargetDirectory = Resolve-FullPath -Path $HelperTargetDirectory
$resolvedLauncherTargetDirectory = Resolve-FullPath -Path $LauncherTargetDirectory
$resolvedDataDirectory = Resolve-FullPath -Path $DataDirectory
$resolvedLogDirectory = Resolve-FullPath -Path $LogDirectory

Assert-DirectoryExists -Path $resolvedServiceSourceDirectory -Label 'Service source directory'
Assert-DirectoryExists -Path $resolvedHelperSourceDirectory -Label 'Helper source directory'
Assert-FileExists -Path (Join-Path -Path $resolvedServiceSourceDirectory -ChildPath $ServiceExeName) -Label 'Service executable'
Assert-FileExists -Path (Join-Path -Path $resolvedHelperSourceDirectory -ChildPath $HelperExeName) -Label 'Helper executable'

Ensure-Directory -Path $resolvedDataDirectory
Ensure-Directory -Path $resolvedLogDirectory

Stop-ServiceIfPresent -Name $ServiceName
Stop-ScheduledTaskIfPresent -TaskName $HelperTaskName

Copy-DeploymentPayload `
    -SourceDirectory $resolvedServiceSourceDirectory `
    -TargetDirectory $resolvedServiceTargetDirectory `
    -ExcludeNames @('appsettings.json')
Copy-DeploymentPayload `
    -SourceDirectory $resolvedHelperSourceDirectory `
    -TargetDirectory $resolvedHelperTargetDirectory `
    -ExcludeNames @('appsettings.json')

$resolvedLauncherSourceDirectory = $null
$launcherInstallStatus = if ($SkipLauncherInstall) { 'Skipped by parameter.' } else { 'Launcher source not yet resolved.' }
if (-not $SkipLauncherInstall) {
    $resolvedLauncherSourceDirectory = Resolve-LauncherSourceDirectory `
        -ExplicitPath $LauncherSourceDirectory `
        -ServiceSourceDirectory $resolvedServiceSourceDirectory `
        -HelperSourceDirectory $resolvedHelperSourceDirectory `
        -ExecutableName $LauncherExeName

    if ($null -ne $resolvedLauncherSourceDirectory) {
        Copy-LauncherDeploymentPayload `
            -SourceDirectory $resolvedLauncherSourceDirectory `
            -TargetDirectory $resolvedLauncherTargetDirectory `
            -ExecutableName $LauncherExeName
        $launcherInstallStatus = "Installed from '$resolvedLauncherSourceDirectory'."
    }
    else {
        $launcherInstallStatus = 'No launcher payload was found; skipped launcher installation.'
        Write-Warning $launcherInstallStatus
    }
}

Copy-ConfigIfRequested `
    -ConfigPath $ServiceConfigPath `
    -SourceDirectory $resolvedServiceSourceDirectory `
    -TargetDirectory $resolvedServiceTargetDirectory
Copy-ConfigIfRequested `
    -ConfigPath $HelperConfigPath `
    -SourceDirectory $resolvedHelperSourceDirectory `
    -TargetDirectory $resolvedHelperTargetDirectory

$serviceExeTargetPath = Join-Path -Path $resolvedServiceTargetDirectory -ChildPath $ServiceExeName
$helperExeTargetPath = Join-Path -Path $resolvedHelperTargetDirectory -ChildPath $HelperExeName

Set-ServiceRegistration -Name $ServiceName -DisplayName $ServiceDisplayName -BinaryPath $serviceExeTargetPath
Register-HelperScheduledTask `
    -TaskName $HelperTaskName `
    -UserId $HelperTaskUser `
    -ExecutablePath $helperExeTargetPath `
    -Arguments $HelperArguments `
    -WorkingDirectory $resolvedHelperTargetDirectory

if ($StartService -and $PSCmdlet.ShouldProcess($ServiceName, 'Start Windows service')) {
    Start-Service -Name $ServiceName
}

if ($StartHelperTask -and $PSCmdlet.ShouldProcess($HelperTaskName, 'Start scheduled task')) {
    Start-ScheduledTask -TaskName $HelperTaskName
}

[pscustomobject]@{
    ServiceName            = $ServiceName
    ServiceTargetDirectory = $resolvedServiceTargetDirectory
    HelperTaskName         = $HelperTaskName
    HelperTaskUser         = $HelperTaskUser
    HelperTargetDirectory  = $resolvedHelperTargetDirectory
    LauncherInstalled      = ($null -ne $resolvedLauncherSourceDirectory -and -not $SkipLauncherInstall)
    LauncherInstallStatus  = $launcherInstallStatus
    LauncherSourceDirectory = $resolvedLauncherSourceDirectory
    LauncherTargetDirectory = $resolvedLauncherTargetDirectory
    LauncherExecutablePath = Join-Path -Path $resolvedLauncherTargetDirectory -ChildPath $LauncherExeName
    DataDirectory          = $resolvedDataDirectory
    LogDirectory           = $resolvedLogDirectory
    DeviceIdentityPath     = Join-Path -Path $resolvedDataDirectory -ChildPath 'device-id.json'
    UploadQueuePath        = Join-Path -Path $resolvedDataDirectory -ChildPath 'upload-queue.jsonl'
    LauncherClockInMode    = 'Installed service/task detected by Launcher; clock-in records attendance and shows background status without local Process.Start.'
}
