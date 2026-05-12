[CmdletBinding()]
param(
    [string]$CaptureSourcePath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
}
else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}

if ([string]::IsNullOrWhiteSpace($CaptureSourcePath)) {
    $CaptureSourcePath = Join-Path $scriptRoot '..\src\EmployeeBehavior.Agent.SessionHelper\Capture\WindowsScreenshotCapture.cs'
}

$resolvedPath = (Resolve-Path -LiteralPath $CaptureSourcePath).Path
$content = Get-Content -LiteralPath $resolvedPath -Raw

if ($content -match 'CaptureBlt') {
    Write-Error "Do not use CopyPixelOperation.CaptureBlt with Graphics.CopyFromScreen in $resolvedPath. The SourceCopy|CaptureBlt composite is not a valid CopyPixelOperation enum value."
}

if ($content -notmatch 'CopyPixelOperation\.SourceCopy') {
    Write-Error "Expected Windows screenshot capture to use CopyPixelOperation.SourceCopy in $resolvedPath."
}

[pscustomobject]@{
    Status = 'PASS'
    CaptureSourcePath = $resolvedPath
    Guard = 'CopyFromScreen uses SourceCopy without CaptureBlt'
}
