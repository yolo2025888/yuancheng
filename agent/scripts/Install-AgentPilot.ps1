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
    [string]$DataDirectory = 'C:\ProgramData\EmployeeBehaviorAgent',
    [string]$LogDirectory = 'C:\ProgramData\EmployeeBehaviorAgent\logs',
    [string]$ServiceExeName = 'EmployeeBehavior.Agent.Service.exe',
    [string]$HelperExeName = 'EmployeeBehavior.Agent.SessionHelper.exe',
    [string]$ServiceConfigPath,
    [string]$HelperConfigPath,
    [string]$HelperArguments = '',
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

if (-not (Test-IsAdministrator)) {
    throw 'Install-AgentPilot.ps1 must be run from an elevated PowerShell session.'
}

$resolvedServiceSourceDirectory = Resolve-FullPath -Path $ServiceSourceDirectory
$resolvedHelperSourceDirectory = Resolve-FullPath -Path $HelperSourceDirectory
$resolvedServiceTargetDirectory = Resolve-FullPath -Path $ServiceTargetDirectory
$resolvedHelperTargetDirectory = Resolve-FullPath -Path $HelperTargetDirectory
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
    DataDirectory          = $resolvedDataDirectory
    LogDirectory           = $resolvedLogDirectory
    DeviceIdentityPath     = Join-Path -Path $resolvedDataDirectory -ChildPath 'device-id.json'
    UploadQueuePath        = Join-Path -Path $resolvedDataDirectory -ChildPath 'upload-queue.jsonl'
}
