[CmdletBinding()]
param(
    [string]$PublishRoot = '',
    [int]$StartupTimeoutSeconds = 10,
    [switch]$AllowExistingBackgroundProcesses,
    [switch]$CleanupStartedProcesses
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$launcherProcessName = 'EmployeeBehavior.Agent.Launcher'
$backgroundProcessNames = @(
    'EmployeeBehavior.Agent.Service',
    'EmployeeBehavior.Agent.SessionHelper'
)
$processNames = @($launcherProcessName) + $backgroundProcessNames

function Resolve-PublishRoot {
    param([string]$Value)

    if (-not [string]::IsNullOrWhiteSpace($Value)) {
        return [System.IO.Path]::GetFullPath($Value)
    }

    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $scriptParent = Split-Path -Parent $PSScriptRoot
        $candidate = Join-Path $scriptParent 'publish'
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    return [System.IO.Directory]::GetCurrentDirectory()
}

function Get-ProcessIdsByName {
    param([string]$Name)

    return @(Get-Process -Name $Name -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}

function Stop-NewProcesses {
    param(
        [hashtable]$Before,
        [string[]]$Names
    )

    foreach ($name in $Names) {
        $existingIds = @($Before[$name])
        $processes = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
        foreach ($process in $processes) {
            if ($existingIds -notcontains $process.Id) {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

$resolvedPublishRoot = Resolve-PublishRoot -Value $PublishRoot
$launcherPath = Join-Path $resolvedPublishRoot 'EmployeeBehavior.Agent.Launcher.exe'

if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw "Launcher executable not found at '$launcherPath'."
}

$before = @{}
foreach ($name in $processNames) {
    $before[$name] = @(Get-ProcessIdsByName -Name $name)
}

$existingBackgroundProcesses = @(
    foreach ($name in $backgroundProcessNames) {
        if (@($before[$name]).Count -gt 0) {
            $name
        }
    }
)
if ($existingBackgroundProcesses.Count -gt 0 -and -not $AllowExistingBackgroundProcesses) {
    throw "Runtime smoke requires a clean state before launch. Stop existing background process(es) first: $($existingBackgroundProcesses -join ', ')."
}

$startedLauncher = $null
try {
    $startedLauncher = Start-Process -FilePath $launcherPath -WorkingDirectory $resolvedPublishRoot -PassThru
    $deadline = (Get-Date).AddSeconds([Math]::Max(1, $StartupTimeoutSeconds))
    $results = @()
    $launcherStartedForTest = $false

    do {
        Start-Sleep -Milliseconds 500
        $results = foreach ($name in $processNames) {
            $current = @(Get-ProcessIdsByName -Name $name)
            $newIds = @($current | Where-Object { @($before[$name]) -notcontains $_ })
            [pscustomobject]@{
                Process = $name
                Running = $current.Count -gt 0
                CurrentPids = ($current -join ',')
                NewPids = ($newIds -join ',')
                StartedByThisSmoke = ($newIds -contains $startedLauncher.Id)
            }
        }

        $launcherStartedForTest = @(
            $results |
                Where-Object { $_.Process -eq $launcherProcessName -and $_.StartedByThisSmoke }
        ).Count -gt 0
    }
    while (-not $launcherStartedForTest -and (Get-Date) -lt $deadline)

    $results | Format-Table -AutoSize

    if (-not $launcherStartedForTest) {
        throw "Runtime smoke failed. Launcher did not start and remain running for this smoke test."
    }

    $backgroundStarted = @(
        $results |
            Where-Object { $backgroundProcessNames -contains $_.Process -and -not [string]::IsNullOrWhiteSpace($_.NewPids) }
    )
    if ($backgroundStarted.Count -gt 0) {
        $startedNames = @($backgroundStarted | Select-Object -ExpandProperty Process)
        throw "Runtime smoke failed. Opening the launcher started background monitoring before clock-in: $($startedNames -join ', ')."
    }

    Write-Output "Runtime smoke passed. Launcher starts without starting Service or SessionHelper before clock-in."
}
finally {
    if ($CleanupStartedProcesses) {
        Stop-NewProcesses -Before $before -Names $processNames
    }
}
