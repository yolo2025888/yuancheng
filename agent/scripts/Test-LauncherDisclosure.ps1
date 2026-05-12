[CmdletBinding()]
param(
    [string]$LauncherSourcePath = '',
    [string]$ProcessManagerSourcePath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
}
else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}

if ([string]::IsNullOrWhiteSpace($LauncherSourcePath)) {
    $LauncherSourcePath = Join-Path $scriptRoot '..\src\EmployeeBehavior.Agent.Launcher\LauncherForm.cs'
}

if ([string]::IsNullOrWhiteSpace($ProcessManagerSourcePath)) {
    $ProcessManagerSourcePath = Join-Path $scriptRoot '..\src\EmployeeBehavior.Agent.Launcher\AgentProcessManager.cs'
}

$resolvedPath = (Resolve-Path -LiteralPath $LauncherSourcePath).Path
$resolvedProcessManagerPath = (Resolve-Path -LiteralPath $ProcessManagerSourcePath).Path
$content = Get-Content -LiteralPath $resolvedPath -Raw
$processManagerContent = Get-Content -LiteralPath $resolvedProcessManagerPath -Raw

$requiredFragments = @(
    'Clock in records attendance and enables company-device monitoring for this work session',
    'Portable packages start the local background agent after clock-in',
    'installed devices keep the Windows service/session helper under system control',
    'full screenshots on all displays',
    'active window title',
    'process name/path',
    'session/lock/RDP/idle metadata',
    'aggregate keyboard/mouse counts',
    'Purpose: attendance, work-risk review, and code/data leakage investigation by authorized admins',
    'Retention and appeal follow company HR/IT policy',
    'No raw keystrokes, clipboard, camera, microphone, or remote control'
)

$missing = @(
    foreach ($fragment in $requiredFragments) {
        if ($content.IndexOf($fragment, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
            $fragment
        }
    }
)

if ($missing.Count -gt 0) {
    Write-Error "Launcher disclosure is missing required fragment(s): $($missing -join '; ')"
}

$processStartCalls = @([regex]::Matches($content, 'await\s+StartAgentProcessesAsync\s*\('))
if ($processStartCalls.Count -ne 1) {
    Write-Error "Launcher must start Service/SessionHelper exactly once, after clock-in. Found $($processStartCalls.Count) awaited StartAgentProcessesAsync call(s)."
}

if ($content -match 'StartAgentOnShownAsync') {
    Write-Error 'Launcher must not contain a startup process launch path. Service/SessionHelper start only after clock-in.'
}

$shownHandlerMatch = [regex]::Match($content, '(?s)Shown\s*\+=\s*\([^)]*\)\s*=>\s*\{(?<Body>.*?)\};')
if ($shownHandlerMatch.Success -and $shownHandlerMatch.Groups['Body'].Value -match 'StartAgentProcesses') {
    Write-Error 'Launcher Shown handler must not start Service/SessionHelper before clock-in.'
}

if ($content -notmatch '(?s)private\s+async\s+Task\s+ClockInAsync\s*\(\s*\).*?await\s+StartAgentProcessesAsync\s*\(') {
    Write-Error 'Launcher must start Service/SessionHelper from ClockInAsync after the employee submits clock-in.'
}

if ($processManagerContent -notmatch 'DetectInstallationState') {
    Write-Error 'AgentProcessManager must detect installed service/task state before deciding whether to start local background processes.'
}

if ($processManagerContent -notmatch 'sc\.exe' -or $processManagerContent -notmatch 'schtasks\.exe') {
    Write-Error 'AgentProcessManager must inspect both Windows service and scheduled task registrations for installed deployments.'
}

if ($processManagerContent -notmatch '(?s)if\s*\(installationState\.IsInstalledDeployment\)\s*\{.*?return\s+CreateStatus\s*\(.*?\);\s*\}\s*var\s+service\s*=\s*StartIfMissing') {
    Write-Error 'Installed deployments must return current background status without calling StartIfMissing before the portable launch path.'
}

[pscustomobject]@{
    Status = 'PASS'
    LauncherSourcePath = $resolvedPath
    ProcessManagerSourcePath = $resolvedProcessManagerPath
    RequiredFragments = $requiredFragments.Count
    BehaviorGuards = 'ClockInAsync only; installed service/task suppresses direct Process.Start'
}
