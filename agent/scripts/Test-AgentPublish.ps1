[CmdletBinding()]
param(
    [string]$PublishRoot = '',
    [string]$ApiTokenSample = 'v2:publish-check:temporary-secret',
    [switch]$StrictProduction
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$results = New-Object System.Collections.Generic.List[object]
$hasFailure = $false
$validationMode = if ($StrictProduction) { 'StrictProduction' } else { 'Pilot' }

function Add-CheckResult {
    param(
        [string]$Check,
        [string]$Status,
        [string]$Detail
    )

    $script:results.Add([pscustomobject]@{
        Check  = $Check
        Status = $Status
        Detail = $Detail
    })

    if ($Status -eq 'FAIL') {
        $script:hasFailure = $true
    }
}

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

function Test-PlaceholderValue {
    param(
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $true
    }

    $normalized = $Value.Trim().ToLowerInvariant()
    return $normalized.Contains('replace-') -or
        $normalized.Contains('example.internal') -or
        $normalized.Contains('127.0.0.1') -or
        $normalized.Contains('localhost')
}

function Get-ModeStatus {
    param(
        [string]$PilotStatus,
        [string]$StrictStatus = 'FAIL'
    )

    if ($StrictProduction) {
        return $StrictStatus
    }

    return $PilotStatus
}

function Test-BooleanValue {
    param(
        [string]$Check,
        [object]$Value
    )

    if ($Value -is [bool]) {
        Add-CheckResult -Check $Check -Status 'PASS' -Detail "Value '$Value' is a boolean."
        return $true
    }

    Add-CheckResult -Check $Check -Status 'FAIL' -Detail "Value '$Value' must be a boolean."
    return $false
}

function Test-SessionHelperVisibility {
    param(
        [object]$EnableTrayIcon,
        [object]$RunInConsole,
        [bool]$DryRun
    )

    if ($EnableTrayIcon -isnot [bool] -or $RunInConsole -isnot [bool]) {
        Add-CheckResult -Check 'SessionHelper visibility' -Status 'FAIL' -Detail 'EnableTrayIcon and RunInConsole must be boolean values before visibility can be validated.'
        return
    }

    if ($StrictProduction -and $RunInConsole -eq $true) {
        Add-CheckResult -Check 'SessionHelper visibility' -Status 'FAIL' -Detail 'RunInConsole must be false for production release gating; use the tray icon as the employee-visible indicator.'
        return
    }

    if ($EnableTrayIcon -eq $true) {
        Add-CheckResult -Check 'SessionHelper visibility' -Status 'PASS' -Detail 'Tray icon is enabled for transparent interactive monitoring.'
        return
    }

    if (-not $StrictProduction -and $DryRun -and $RunInConsole -eq $true) {
        Add-CheckResult -Check 'SessionHelper visibility' -Status 'WARN' -Detail 'Tray icon is disabled only for operator-observed DryRun console validation.'
        return
    }

    Add-CheckResult -Check 'SessionHelper visibility' -Status 'FAIL' -Detail 'EnableTrayIcon must be true for production release gating and installed deployments.'
}

function Get-AgentTokenShape {
    param(
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return 'empty'
    }

    if (Test-PlaceholderValue -Value $Value) {
        return 'placeholder'
    }

    $normalized = $Value.Trim()
    if ($normalized.StartsWith('v2:', [System.StringComparison]::OrdinalIgnoreCase)) {
        return 'v2'
    }

    if ($normalized.StartsWith('v1:', [System.StringComparison]::OrdinalIgnoreCase)) {
        return 'v1'
    }

    return 'raw'
}

function Resolve-ConfigCandidate {
    param(
        [string]$Directory,
        [string]$Check
    )

    $settingsPath = Join-Path $Directory 'appsettings.json'
    if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
        Add-CheckResult -Check $Check -Status 'PASS' -Detail "Found '$settingsPath'."
        return (Resolve-Path -LiteralPath $settingsPath).Path
    }

    $examplePath = Join-Path $Directory 'appsettings.json.example'
    if (Test-Path -LiteralPath $examplePath -PathType Leaf) {
        if ($StrictProduction) {
            Add-CheckResult -Check $Check -Status 'FAIL' -Detail "Missing '$settingsPath'. Strict production validation cannot use example file '$examplePath'."
            return $null
        }

        Add-CheckResult -Check $Check -Status 'WARN' -Detail "Missing '$settingsPath'. Falling back to example file '$examplePath'."
        return (Resolve-Path -LiteralPath $examplePath).Path
    }

    Add-CheckResult -Check $Check -Status 'FAIL' -Detail "Missing both '$settingsPath' and '$examplePath'."
    return $null
}

function Read-JsonFile {
    param(
        [string]$Path,
        [string]$Label
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    try {
        $raw = Get-Content -LiteralPath $Path -Raw
        $json = $raw | ConvertFrom-Json
        Add-CheckResult -Check $Label -Status 'PASS' -Detail "Loaded JSON from '$Path'."
        return $json
    }
    catch {
        Add-CheckResult -Check $Label -Status 'FAIL' -Detail "Could not parse JSON from '$Path': $($_.Exception.Message)"
        return $null
    }
}

function Test-Executable {
    param(
        [string]$Path,
        [string]$Check
    )

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Add-CheckResult -Check $Check -Status 'PASS' -Detail "Found '$Path'."
        return $true
    }

    Add-CheckResult -Check $Check -Status 'FAIL' -Detail "Missing '$Path'."
    return $false
}

function Test-OptionalExecutable {
    param(
        [string]$Path,
        [string]$Check
    )

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Add-CheckResult -Check $Check -Status 'PASS' -Detail "Found '$Path'."
        return $true
    }

    Add-CheckResult -Check $Check -Status 'WARN' -Detail "Missing optional file '$Path'."
    return $false
}

function Test-ConfiguredTokenFile {
    param(
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Add-CheckResult -Check 'Configured protected token file' -Status (Get-ModeStatus -PilotStatus 'WARN') -Detail 'ProtectedTokenPath is empty. Provision a DPAPI token before launching the agent, or use a temporary v2 ApiToken fallback for pilot-only validation.'
        return $false
    }

    $resolvedPath = [System.IO.Path]::GetFullPath([System.Environment]::ExpandEnvironmentVariables($Path))
    if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
        Add-CheckResult -Check 'Configured protected token file' -Status (Get-ModeStatus -PilotStatus 'WARN') -Detail "Protected token file '$resolvedPath' does not exist yet."
        return $false
    }

    try {
        $payload = Get-Content -LiteralPath $resolvedPath -Raw | ConvertFrom-Json
        $scope = [string]$payload.scope
        $protectedToken = [string]$payload.protectedToken

        if ([string]::IsNullOrWhiteSpace($scope)) {
            Add-CheckResult -Check 'Configured protected token file' -Status 'FAIL' -Detail "Protected token file '$resolvedPath' has an invalid DPAPI scope."
            return $false
        }

        try {
            $scopeValue = [System.Enum]::Parse([System.Security.Cryptography.DataProtectionScope], $scope, $true)
        }
        catch {
            Add-CheckResult -Check 'Configured protected token file' -Status 'FAIL' -Detail "Protected token file '$resolvedPath' has an invalid DPAPI scope."
            return $false
        }

        $bytes = [Convert]::FromBase64String($protectedToken)
        $tokenBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scopeValue)
        $token = [System.Text.Encoding]::UTF8.GetString($tokenBytes)

        if ([string]::IsNullOrWhiteSpace($token)) {
            Add-CheckResult -Check 'Configured protected token file' -Status 'FAIL' -Detail "Protected token file '$resolvedPath' decrypted to an empty token."
            return $false
        }

        Add-CheckResult -Check 'Configured protected token file' -Status 'PASS' -Detail "Protected token file '$resolvedPath' is readable and decryptable."
        return $true
    }
    catch {
        Add-CheckResult -Check 'Configured protected token file' -Status 'FAIL' -Detail "Could not read protected token file '$resolvedPath': $($_.Exception.Message)"
        return $false
    }
}

function Test-DpapiRoundTrip {
    param(
        [string]$WriterScriptPath,
        [string]$ConfiguredTokenPath,
        [string]$Token
    )

    $tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("EmployeeBehaviorAgent-PublishCheck-" + [Guid]::NewGuid().ToString('N'))
    $probeDirectory = $tempDirectory
    $probeDirectorySource = 'temporary workspace'
    $probePath = $null

    try {
        New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null

        if (-not [string]::IsNullOrWhiteSpace($ConfiguredTokenPath)) {
            $resolvedConfiguredPath = [System.IO.Path]::GetFullPath([System.Environment]::ExpandEnvironmentVariables($ConfiguredTokenPath))
            $configuredDirectory = Split-Path -Path $resolvedConfiguredPath -Parent

            if ([string]::IsNullOrWhiteSpace($configuredDirectory)) {
                Add-CheckResult -Check 'Protected token target directory' -Status 'WARN' -Detail "Could not resolve the parent directory for '$resolvedConfiguredPath'. Falling back to a temporary workspace."
            }
            elseif (Test-Path -LiteralPath $configuredDirectory -PathType Container) {
                $probeDirectory = $configuredDirectory
                $probeDirectorySource = 'configured ProtectedTokenPath parent'
                Add-CheckResult -Check 'Protected token target directory' -Status 'PASS' -Detail "Directory '$configuredDirectory' exists and will be probed with a temporary file."
            }
            else {
                Add-CheckResult -Check 'Protected token target directory' -Status 'WARN' -Detail "Directory '$configuredDirectory' does not exist yet. Falling back to a temporary workspace for the DPAPI round-trip check."
            }
        }
        else {
            Add-CheckResult -Check 'Protected token target directory' -Status 'WARN' -Detail 'ProtectedTokenPath is empty. Falling back to a temporary workspace for the DPAPI round-trip check.'
        }

        $probePath = Join-Path $probeDirectory ("agent-token.publish-check." + [Guid]::NewGuid().ToString('N') + '.json')
        & $WriterScriptPath -Token $Token -Path $probePath -Scope LocalMachine -Force | Out-Null

        if (-not (Test-Path -LiteralPath $probePath -PathType Leaf)) {
            Add-CheckResult -Check 'DPAPI token round-trip' -Status 'FAIL' -Detail "Token writer did not create '$probePath'."
            return
        }

        $payload = Get-Content -LiteralPath $probePath -Raw | ConvertFrom-Json
        if ([string]$payload.format -ne 'dpapi/v1') {
            Add-CheckResult -Check 'DPAPI token round-trip' -Status 'FAIL' -Detail "Probe token file '$probePath' used unsupported format '$([string]$payload.format)'."
            return
        }

        $scope = [System.Enum]::Parse([System.Security.Cryptography.DataProtectionScope], [string]$payload.scope, $true)
        $protectedBytes = [Convert]::FromBase64String([string]$payload.protectedToken)
        $tokenBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $null, $scope)
        $decodedToken = [System.Text.Encoding]::UTF8.GetString($tokenBytes)

        if ($decodedToken -ne $Token) {
            Add-CheckResult -Check 'DPAPI token round-trip' -Status 'FAIL' -Detail "Probe token decrypted successfully but did not match the original sample token in the $probeDirectorySource."
            return
        }

        Add-CheckResult -Check 'DPAPI token round-trip' -Status 'PASS' -Detail "Temporary token file in '$probeDirectory' was written, read, and decrypted successfully."
    }
    catch {
        Add-CheckResult -Check 'DPAPI token round-trip' -Status 'FAIL' -Detail "Could not complete the DPAPI token probe: $($_.Exception.Message)"
    }
    finally {
        if ($probePath -and (Test-Path -LiteralPath $probePath -PathType Leaf)) {
            Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
        }

        if (Test-Path -LiteralPath $tempDirectory -PathType Container) {
            Remove-Item -LiteralPath $tempDirectory -Force -Recurse -ErrorAction SilentlyContinue
        }
    }
}

$effectivePublishRoot = if ([string]::IsNullOrWhiteSpace($PublishRoot)) {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $PSScriptRoot
    }
    else {
        Split-Path -Parent $MyInvocation.MyCommand.Path
    }
}
else {
    $PublishRoot
}

$resolvedPublishRoot = [System.IO.Path]::GetFullPath($effectivePublishRoot)
if (Test-Path -LiteralPath $resolvedPublishRoot -PathType Container) {
    Add-CheckResult -Check 'Publish root' -Status 'PASS' -Detail "Using publish root '$resolvedPublishRoot'."
}
else {
    Add-CheckResult -Check 'Publish root' -Status 'FAIL' -Detail "Publish root '$resolvedPublishRoot' does not exist."
}
Add-CheckResult -Check 'Validation mode' -Status 'PASS' -Detail "Running publish validation in $validationMode mode."

$serviceDirectory = Join-Path $resolvedPublishRoot 'Service'
$helperDirectory = Join-Path $resolvedPublishRoot 'SessionHelper'
$launcherDirectory = Join-Path $resolvedPublishRoot 'Launcher'
$serviceExe = Join-Path $serviceDirectory 'EmployeeBehavior.Agent.Service.exe'
$helperExe = Join-Path $helperDirectory 'EmployeeBehavior.Agent.SessionHelper.exe'
$launcherExe = Join-Path $resolvedPublishRoot 'EmployeeBehavior.Agent.Launcher.exe'
$nestedLauncherExe = Join-Path $launcherDirectory 'EmployeeBehavior.Agent.Launcher.exe'
$writerScript = Join-Path $serviceDirectory 'Write-AgentProtectedToken.ps1'

$serviceExists = Test-Executable -Path $serviceExe -Check 'Service executable'
$helperExists = Test-Executable -Path $helperExe -Check 'Session helper executable'
$launcherExists = Test-Executable -Path $launcherExe -Check 'Launcher executable'
$nestedLauncherExists = Test-OptionalExecutable -Path $nestedLauncherExe -Check 'Nested launcher executable'

if ($launcherExists -and $serviceExists -and $helperExists) {
    Add-CheckResult -Check 'Launcher package layout' -Status 'PASS' -Detail 'Launcher root EXE and sibling Service/SessionHelper EXEs are present.'
}
else {
    Add-CheckResult -Check 'Launcher package layout' -Status 'FAIL' -Detail 'Launcher validation requires the root launcher EXE plus sibling Service and SessionHelper EXEs.'
}

if ($launcherExists -and -not $nestedLauncherExists) {
    Add-CheckResult -Check 'Nested launcher packaging' -Status (Get-ModeStatus -PilotStatus 'WARN') -Detail "The package can still start from '$launcherExe', but the nested Launcher copy is missing."
}

if (Test-Path -LiteralPath $writerScript -PathType Leaf) {
    Add-CheckResult -Check 'Protected token writer script' -Status 'PASS' -Detail "Found '$writerScript'."
}
else {
    Add-CheckResult -Check 'Protected token writer script' -Status 'FAIL' -Detail "Missing '$writerScript'."
}

$serviceConfigPath = Resolve-ConfigCandidate -Directory $serviceDirectory -Check 'Service appsettings file'
$serviceConfig = Read-JsonFile -Path $serviceConfigPath -Label 'Service appsettings JSON'
$helperConfigPath = Resolve-ConfigCandidate -Directory $helperDirectory -Check 'SessionHelper appsettings file'
$helperConfig = Read-JsonFile -Path $helperConfigPath -Label 'SessionHelper appsettings JSON'
$serviceSection = $null
$helperSection = $null

if (Test-PropertyExists -InputObject $serviceConfig -Name 'AgentService') {
    $serviceSection = $serviceConfig.AgentService
    Add-CheckResult -Check 'AgentService section' -Status 'PASS' -Detail 'AgentService section is present.'
}
else {
    Add-CheckResult -Check 'AgentService section' -Status 'FAIL' -Detail 'Missing AgentService section.'
}

if (Test-PropertyExists -InputObject $helperConfig -Name 'SessionHelper') {
    $helperSection = $helperConfig.SessionHelper
    Add-CheckResult -Check 'SessionHelper section' -Status 'PASS' -Detail 'SessionHelper section is present.'
}
else {
    Add-CheckResult -Check 'SessionHelper section' -Status 'FAIL' -Detail 'Missing SessionHelper section.'
}

$protectedTokenPath = ''
$protectedTokenUsable = $false
$apiTokenUsable = $false
$servicePipeName = ''
$helperPipeName = ''
if ($null -ne $serviceSection) {
    foreach ($requiredProperty in @('ApiBaseUrl', 'ProtectedTokenPath', 'ApiToken', 'DryRun', 'SessionHelperPipeName')) {
        if (Test-PropertyExists -InputObject $serviceSection -Name $requiredProperty) {
            Add-CheckResult -Check "AgentService.$requiredProperty" -Status 'PASS' -Detail 'Property is present.'
        }
        else {
            Add-CheckResult -Check "AgentService.$requiredProperty" -Status 'FAIL' -Detail 'Missing required property.'
        }
    }

    $apiBaseUrl = [string]$serviceSection.ApiBaseUrl
    $serviceUri = $null
    if ([Uri]::TryCreate($apiBaseUrl, [System.UriKind]::Absolute, [ref]$serviceUri)) {
        $status = if (Test-PlaceholderValue -Value $apiBaseUrl) { Get-ModeStatus -PilotStatus 'WARN' } else { 'PASS' }
        $detail = if ($status -eq 'PASS') {
            "ApiBaseUrl '$apiBaseUrl' is ready for publish validation."
        }
        else {
            "ApiBaseUrl '$apiBaseUrl' still looks like a local or placeholder endpoint and cannot be used for a production release gate."
        }
        Add-CheckResult -Check 'AgentService.ApiBaseUrl value' -Status $status -Detail $detail
    }
    else {
        Add-CheckResult -Check 'AgentService.ApiBaseUrl value' -Status 'FAIL' -Detail "Value '$apiBaseUrl' is not a valid absolute URI."
    }

    $protectedTokenPath = [string]$serviceSection.ProtectedTokenPath
    if ([string]::IsNullOrWhiteSpace($protectedTokenPath)) {
        Add-CheckResult -Check 'AgentService.ProtectedTokenPath value' -Status (Get-ModeStatus -PilotStatus 'WARN') -Detail 'ProtectedTokenPath is empty.'
    }
    else {
        $resolvedProtectedTokenPath = [System.IO.Path]::GetFullPath([System.Environment]::ExpandEnvironmentVariables($protectedTokenPath))
        $status = if ([System.IO.Path]::IsPathRooted($protectedTokenPath)) { 'PASS' } else { Get-ModeStatus -PilotStatus 'WARN' }
        $detail = if ($status -eq 'PASS') {
            "ProtectedTokenPath resolves to '$resolvedProtectedTokenPath'."
        }
        else {
            "ProtectedTokenPath '$protectedTokenPath' is relative; resolved as '$resolvedProtectedTokenPath'."
        }
        Add-CheckResult -Check 'AgentService.ProtectedTokenPath value' -Status $status -Detail $detail
    }

    if (Test-BooleanValue -Check 'AgentService.DryRun value' -Value $serviceSection.DryRun) {
        if ($serviceSection.DryRun -eq $true) {
            Add-CheckResult -Check 'AgentService.DryRun release posture' -Status (Get-ModeStatus -PilotStatus 'WARN') -Detail 'DryRun=true is acceptable for pilot validation only and must be false for production release gating.'
        }
        else {
            Add-CheckResult -Check 'AgentService.DryRun release posture' -Status 'PASS' -Detail 'DryRun=false is ready for production release gating.'
        }
    }

    $servicePipeName = [string]$serviceSection.SessionHelperPipeName
    if ([string]::IsNullOrWhiteSpace($servicePipeName)) {
        Add-CheckResult -Check 'AgentService.SessionHelperPipeName value' -Status 'FAIL' -Detail 'SessionHelperPipeName is empty.'
    }
    else {
        Add-CheckResult -Check 'AgentService.SessionHelperPipeName value' -Status 'PASS' -Detail "Service pipe name is '$servicePipeName'."
    }

    $apiToken = [string]$serviceSection.ApiToken
    $apiTokenShape = Get-AgentTokenShape -Value $apiToken
    switch ($apiTokenShape) {
        'v2' {
            $apiTokenUsable = $true
            Add-CheckResult -Check 'AgentService.ApiToken value' -Status 'PASS' -Detail 'ApiToken is an issued v2 device-scoped token.'
        }
        'empty' {
            Add-CheckResult -Check 'AgentService.ApiToken value' -Status 'WARN' -Detail 'ApiToken fallback is empty.'
        }
        'placeholder' {
            Add-CheckResult -Check 'AgentService.ApiToken value' -Status 'WARN' -Detail 'ApiToken fallback is still a placeholder value.'
        }
        'v1' {
            Add-CheckResult -Check 'AgentService.ApiToken value' -Status (Get-ModeStatus -PilotStatus 'WARN') -Detail 'ApiToken is a legacy v1 token. Use a protected token file or issued v2 token for production.'
        }
        default {
            Add-CheckResult -Check 'AgentService.ApiToken value' -Status (Get-ModeStatus -PilotStatus 'WARN') -Detail 'ApiToken is a raw signing secret or unknown token shape. Use a protected token file or issued v2 token for production.'
        }
    }
}

if ($null -ne $helperSection) {
    foreach ($requiredProperty in @('PipeName', 'EnableTrayIcon', 'RunInConsole', 'EnableInputActivityHooks', 'EnableDesktopStateInspection')) {
        if (Test-PropertyExists -InputObject $helperSection -Name $requiredProperty) {
            Add-CheckResult -Check "SessionHelper.$requiredProperty" -Status 'PASS' -Detail 'Property is present.'
        }
        else {
            Add-CheckResult -Check "SessionHelper.$requiredProperty" -Status 'FAIL' -Detail 'Missing required property.'
        }
    }

    $helperPipeName = [string]$helperSection.PipeName
    if ([string]::IsNullOrWhiteSpace($helperPipeName)) {
        Add-CheckResult -Check 'SessionHelper.PipeName value' -Status 'FAIL' -Detail 'PipeName is empty.'
    }
    else {
        Add-CheckResult -Check 'SessionHelper.PipeName value' -Status 'PASS' -Detail "Helper pipe name is '$helperPipeName'."
    }

    Test-BooleanValue -Check 'SessionHelper.EnableInputActivityHooks value' -Value $helperSection.EnableInputActivityHooks | Out-Null
    Test-BooleanValue -Check 'SessionHelper.EnableDesktopStateInspection value' -Value $helperSection.EnableDesktopStateInspection | Out-Null
    Test-BooleanValue -Check 'SessionHelper.EnableTrayIcon value' -Value $helperSection.EnableTrayIcon | Out-Null
    Test-BooleanValue -Check 'SessionHelper.RunInConsole value' -Value $helperSection.RunInConsole | Out-Null

    $dryRunForVisibility = $false
    if ($null -ne $serviceSection) {
        $dryRunForVisibility = $serviceSection.DryRun -eq $true
    }

    Test-SessionHelperVisibility `
        -EnableTrayIcon $helperSection.EnableTrayIcon `
        -RunInConsole $helperSection.RunInConsole `
        -DryRun $dryRunForVisibility
}

if ($null -ne $serviceSection -and $null -ne $helperSection) {
    if (
        -not [string]::IsNullOrWhiteSpace($servicePipeName) -and
        -not [string]::IsNullOrWhiteSpace($helperPipeName) -and
        [string]::Equals($servicePipeName, $helperPipeName, [System.StringComparison]::Ordinal)
    ) {
        Add-CheckResult -Check 'Service/helper config agreement' -Status 'PASS' -Detail 'Service and SessionHelper appsettings agree on the named pipe.'
    }
    else {
        Add-CheckResult -Check 'Service/helper config agreement' -Status (Get-ModeStatus -PilotStatus 'WARN') -Detail "Service pipe '$servicePipeName' does not match helper pipe '$helperPipeName'."
    }
}

if (Test-Path -LiteralPath $writerScript -PathType Leaf) {
    Test-DpapiRoundTrip -WriterScriptPath $writerScript -ConfiguredTokenPath $protectedTokenPath -Token $ApiTokenSample
}

$protectedTokenUsable = Test-ConfiguredTokenFile -Path $protectedTokenPath

if ($protectedTokenUsable -or $apiTokenUsable) {
    $detail = if ($protectedTokenUsable -and $apiTokenUsable) {
        'ProtectedTokenPath and ApiToken fallback are both usable.'
    }
    elseif ($protectedTokenUsable) {
        'ProtectedTokenPath is usable for agent authentication.'
    }
    else {
        'ApiToken fallback is usable for agent authentication.'
    }
    Add-CheckResult -Check 'AgentService authentication readiness' -Status 'PASS' -Detail $detail
}
else {
    Add-CheckResult -Check 'AgentService authentication readiness' -Status (Get-ModeStatus -PilotStatus 'WARN') -Detail 'No usable ProtectedTokenPath file or issued v2 ApiToken is available. Pilot mode can continue with a warning, but production release gating must fail closed.'
}

$results | Format-Table -AutoSize

if ($hasFailure) {
    exit 1
}

exit 0
