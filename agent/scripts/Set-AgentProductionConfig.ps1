[CmdletBinding()]
param(
    [string]$ConfigPath = '',

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$ApiBaseUrl,

    [string]$ProtectedTokenPath = 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json',

    [string]$ApiToken,

    [switch]$ClearApiToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-PropertyExists {
    param(
        [object]$InputObject,
        [string]$Name
    )

    if ($null -eq $InputObject) {
        return $false
    }

    return $null -ne $InputObject.PSObject.Properties[$Name]
}

function Test-UnsafeProductionHost {
    param(
        [string]$HostName
    )

    if ([string]::IsNullOrWhiteSpace($HostName)) {
        return $true
    }

    $normalizedHost = $HostName.Trim().ToLowerInvariant()
    return $normalizedHost -eq 'localhost' -or
        $normalizedHost -eq '127.0.0.1' -or
        $normalizedHost -eq '::1' -or
        $normalizedHost.EndsWith('.local') -or
        $normalizedHost.Contains('example.internal') -or
        $normalizedHost.Contains('replace-')
}

if ($ClearApiToken -and $PSBoundParameters.ContainsKey('ApiToken')) {
    throw 'Specify either -ApiToken or -ClearApiToken, not both.'
}

$scriptRoot = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
}
else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}

if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $scriptRoot '..\publish\Service\appsettings.json'
}

$resolvedConfigPath = [System.IO.Path]::GetFullPath([System.Environment]::ExpandEnvironmentVariables($ConfigPath))
if (-not (Test-Path -LiteralPath $resolvedConfigPath -PathType Leaf)) {
    throw "Config file not found: $resolvedConfigPath"
}

$normalizedApiBaseUrl = $ApiBaseUrl.Trim().TrimEnd('/')
$apiUri = $null
if (-not [Uri]::TryCreate($normalizedApiBaseUrl, [System.UriKind]::Absolute, [ref]$apiUri)) {
    throw "ApiBaseUrl must be a valid absolute URI: $normalizedApiBaseUrl"
}

if (Test-UnsafeProductionHost -HostName $apiUri.Host) {
    throw "ApiBaseUrl host '$($apiUri.Host)' is not suitable for production."
}

if ($apiUri.Scheme -ne [System.Uri]::UriSchemeHttps) {
    throw "ApiBaseUrl must use HTTPS for production: $normalizedApiBaseUrl"
}

$resolvedProtectedTokenPath = [System.IO.Path]::GetFullPath(
    [System.Environment]::ExpandEnvironmentVariables($ProtectedTokenPath))
if (-not [System.IO.Path]::IsPathRooted($resolvedProtectedTokenPath)) {
    throw "ProtectedTokenPath must resolve to a rooted path: $ProtectedTokenPath"
}

if ($ClearApiToken -and -not (Test-Path -LiteralPath $resolvedProtectedTokenPath -PathType Leaf)) {
    throw "ProtectedTokenPath must point to an existing protected token file when -ClearApiToken is used: $resolvedProtectedTokenPath"
}

if ($ClearApiToken) {
    $tokenFileStream = $null
    try {
        $tokenFileStream = [System.IO.File]::OpenRead($resolvedProtectedTokenPath)
    }
    catch {
        throw "ProtectedTokenPath must be readable when -ClearApiToken is used: $resolvedProtectedTokenPath"
    }
    finally {
        if ($null -ne $tokenFileStream) {
            $tokenFileStream.Dispose()
        }
    }
}

$rawConfig = Get-Content -LiteralPath $resolvedConfigPath -Raw
$config = $rawConfig | ConvertFrom-Json

if (-not (Test-PropertyExists -InputObject $config -Name 'AgentService')) {
    throw "Config file '$resolvedConfigPath' does not contain an AgentService section."
}

$agentService = $config.AgentService
foreach ($requiredProperty in @('ApiBaseUrl', 'ProtectedTokenPath', 'ApiToken', 'DryRun')) {
    if (-not (Test-PropertyExists -InputObject $agentService -Name $requiredProperty)) {
        throw "AgentService.$requiredProperty is missing from '$resolvedConfigPath'."
    }
}

$agentService.ApiBaseUrl = $normalizedApiBaseUrl
$agentService.ProtectedTokenPath = $resolvedProtectedTokenPath
$agentService.DryRun = $false

$apiTokenMode = 'preserved'
if ($ClearApiToken) {
    $agentService.ApiToken = ''
    $apiTokenMode = 'cleared'
}
elseif ($PSBoundParameters.ContainsKey('ApiToken')) {
    $normalizedApiToken = $ApiToken.Trim()
    if ([string]::IsNullOrWhiteSpace($normalizedApiToken)) {
        throw 'ApiToken must not be empty when provided. Use -ClearApiToken to remove the plaintext fallback.'
    }

    if (-not $normalizedApiToken.StartsWith('v2:', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'ApiToken must be an issued device-scoped v2:<device_id>:<secret> token.'
    }

    $agentService.ApiToken = $normalizedApiToken
    $apiTokenMode = 'updated'
}

$config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resolvedConfigPath -Encoding UTF8

[pscustomobject]@{
    ConfigPath = $resolvedConfigPath
    ApiBaseUrl = $agentService.ApiBaseUrl
    ProtectedTokenPath = $agentService.ProtectedTokenPath
    DryRun = $agentService.DryRun
    ApiTokenMode = $apiTokenMode
}
