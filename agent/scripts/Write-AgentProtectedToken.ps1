[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$Token,

    [string]$Path = 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json',

    [ValidateSet('LocalMachine', 'CurrentUser')]
    [string]$Scope = 'LocalMachine',

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$normalizedToken = $Token.Trim()
if (-not $normalizedToken.StartsWith('v2:', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Token must be an issued device-scoped v2:<device_id>:<secret> token.'
}

$resolvedPath = [System.IO.Path]::GetFullPath([System.Environment]::ExpandEnvironmentVariables($Path))
$directory = Split-Path -Parent $resolvedPath

if ([string]::IsNullOrWhiteSpace($directory)) {
    throw "Could not resolve parent directory for '$resolvedPath'."
}

if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

if ((Test-Path -LiteralPath $resolvedPath -PathType Leaf) -and -not $Force) {
    throw "Protected token file already exists: $resolvedPath. Use -Force to overwrite it."
}

$scopeValue = [System.Enum]::Parse([System.Security.Cryptography.DataProtectionScope], $Scope)
$tokenBytes = [System.Text.Encoding]::UTF8.GetBytes($normalizedToken)
$protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
    $tokenBytes,
    $null,
    $scopeValue)

$payload = [ordered]@{
    format = 'dpapi/v1'
    scope = $Scope
    protectedToken = [Convert]::ToBase64String($protectedBytes)
} | ConvertTo-Json

Set-Content -LiteralPath $resolvedPath -Value $payload -Encoding UTF8

[pscustomobject]@{
    Path = $resolvedPath
    Scope = $Scope
    Bytes = $protectedBytes.Length
}
