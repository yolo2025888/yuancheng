[CmdletBinding()]
param(
    [string]$ServiceConfigPath = ".\agent\src\EmployeeBehavior.Agent.Service\appsettings.json",
    [string]$HelperConfigPath = ".\agent\src\EmployeeBehavior.Agent.SessionHelper\appsettings.json",
    [string]$HelperTaskName = "EmployeeBehavior.Agent.SessionHelper",
    [string]$ApiHealthPath = "/health",
    [string]$LogRootPath = "C:\ProgramData\EmployeeBehaviorAgent\logs",
    [int]$TimeoutSeconds = 5,
    [switch]$RequireInstalledHelperTask
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$results = New-Object System.Collections.Generic.List[object]
$hasFailure = $false

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

    if ($Status -eq "FAIL") {
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

function Resolve-ConfigCandidate {
    param(
        [string]$Path,
        [string]$Label
    )

    if (Test-Path -LiteralPath $Path) {
        return (Resolve-Path -LiteralPath $Path).Path
    }

    if (-not $Path.EndsWith(".example", [System.StringComparison]::OrdinalIgnoreCase)) {
        $examplePath = "$Path.example"
        if (Test-Path -LiteralPath $examplePath) {
            Add-CheckResult -Check $Label -Status "WARN" -Detail "Config file not found at '$Path'. Falling back to example file '$examplePath'."
            return (Resolve-Path -LiteralPath $examplePath).Path
        }
    }

    Add-CheckResult -Check $Label -Status "FAIL" -Detail "Config file not found at '$Path'."
    return $null
}

function Read-JsonFile {
    param(
        [string]$Path,
        [string]$Label
    )

    if ($null -eq $Path) {
        return $null
    }

    try {
        $raw = Get-Content -LiteralPath $Path -Raw
        $json = $raw | ConvertFrom-Json
        Add-CheckResult -Check $Label -Status "PASS" -Detail "Loaded JSON from '$Path'."
        return $json
    }
    catch {
        Add-CheckResult -Check $Label -Status "FAIL" -Detail "Could not parse JSON from '$Path': $($_.Exception.Message)"
        return $null
    }
}

function Test-PositiveInteger {
    param(
        [string]$Check,
        [object]$Value
    )

    try {
        $number = [int64]$Value
        if ($number -gt 0 -and ([double]$Value -eq [double]$number)) {
            Add-CheckResult -Check $Check -Status "PASS" -Detail "Value '$Value' is a positive integer."
            return
        }
    }
    catch {
        # Fall through to the common failure result.
    }

    Add-CheckResult -Check $Check -Status "FAIL" -Detail "Value '$Value' must be a positive integer."
}

function Test-BooleanValue {
    param(
        [string]$Check,
        [object]$Value
    )

    if ($Value -is [bool]) {
        Add-CheckResult -Check $Check -Status "PASS" -Detail "Value '$Value' is a boolean."
    }
    else {
        Add-CheckResult -Check $Check -Status "FAIL" -Detail "Value '$Value' must be a boolean."
    }
}

function Test-SessionHelperVisibility {
    param(
        [object]$EnableTrayIcon,
        [object]$RunInConsole,
        [bool]$DryRun
    )

    if ($EnableTrayIcon -isnot [bool] -or $RunInConsole -isnot [bool]) {
        Add-CheckResult -Check "SessionHelper visibility" -Status "FAIL" -Detail "EnableTrayIcon and RunInConsole must be boolean values before visibility can be validated."
        return
    }

    if ($EnableTrayIcon -eq $true) {
        Add-CheckResult -Check "SessionHelper visibility" -Status "PASS" -Detail "Tray icon is enabled for transparent interactive monitoring."
        return
    }

    if ($DryRun -and $RunInConsole -eq $true) {
        Add-CheckResult -Check "SessionHelper visibility" -Status "WARN" -Detail "Tray icon is disabled only for operator-observed DryRun console validation."
        return
    }

    Add-CheckResult -Check "SessionHelper visibility" -Status "FAIL" -Detail "EnableTrayIcon must be true unless DryRun=true and RunInConsole=true for an operator-observed console dry-run."
}

function Test-SessionHelperVisibilityOverrides {
    param(
        [bool]$DryRun
    )

    $unsafeOverrideCount = 0
    $checks = @(
        @{
            Name = "SESSION_HELPER_SessionHelper__EnableTrayIcon"
            UnsafeValue = "false"
            Failure = "Environment override disables the tray icon."
            Warning = "Environment override disables the tray icon only during DryRun validation."
        },
        @{
            Name = "SESSION_HELPER_SessionHelper__RunInConsole"
            UnsafeValue = "true"
            Failure = "Environment override forces console mode."
            Warning = "Environment override forces console mode only during DryRun validation."
        }
    )

    foreach ($target in @("Process", "User", "Machine")) {
        $environmentTarget = [System.Enum]::Parse([EnvironmentVariableTarget], $target)
        foreach ($check in $checks) {
            $value = [Environment]::GetEnvironmentVariable(
                $check.Name,
                $environmentTarget)
            if ([string]::IsNullOrWhiteSpace($value)) {
                continue
            }

            if ($value.Trim().Equals($check.UnsafeValue, [System.StringComparison]::OrdinalIgnoreCase)) {
                $unsafeOverrideCount++
                $status = if ($DryRun) { "WARN" } else { "FAIL" }
                $detail = if ($DryRun) { $check.Warning } else { $check.Failure }
                Add-CheckResult -Check "SessionHelper environment override" -Status $status -Detail "$detail Scope=$target; Name=$($check.Name); Value=$value."
            }
        }
    }

    if ($unsafeOverrideCount -eq 0) {
        Add-CheckResult -Check "SessionHelper environment override" -Status "PASS" -Detail "No process, user, or machine environment override disables tray visibility or forces console mode."
    }
}

function Test-HelperScheduledTaskArguments {
    param(
        [string]$TaskName,
        [bool]$DryRun,
        [bool]$RequireInstalledTask
    )

    if ($null -eq (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) {
        $status = if ($RequireInstalledTask) { "FAIL" } else { "WARN" }
        Add-CheckResult -Check "SessionHelper scheduled task arguments" -Status $status -Detail "Get-ScheduledTask is not available in this shell; installed helper task arguments were not inspected."
        return
    }

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        $status = if ($RequireInstalledTask) { "FAIL" } else { "WARN" }
        Add-CheckResult -Check "SessionHelper scheduled task arguments" -Status $status -Detail "Scheduled task '$TaskName' was not found; run this check after installation to inspect effective helper arguments."
        return
    }

    foreach ($action in $task.Actions) {
        $arguments = [string]$action.Arguments
        if ($arguments -match '(^|\s)--console(\s|$)') {
            $status = if ($DryRun -and -not $RequireInstalledTask) { "WARN" } else { "FAIL" }
            Add-CheckResult -Check "SessionHelper scheduled task arguments" -Status $status -Detail "Scheduled task '$TaskName' includes --console. Installed helper tasks must keep the tray indicator visible outside operator-observed DryRun validation."
            return
        }
    }

    Add-CheckResult -Check "SessionHelper scheduled task arguments" -Status "PASS" -Detail "Scheduled task '$TaskName' does not force --console."
}

function Test-PlaceholderValue {
    param(
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $true
    }

    $normalized = $Value.Trim().ToLowerInvariant()
    return $normalized.Contains("replace-") -or
        $normalized.Contains("example.internal") -or
        $normalized.Contains(".example") -or
        $normalized.Contains("example.com") -or
        $normalized.Contains("example.net") -or
        $normalized.Contains("example.org") -or
        $normalized.Contains(".test") -or
        $normalized.Contains(".invalid")
}

function Get-AgentTokenShape {
    param(
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return "empty"
    }

    if (Test-PlaceholderValue -Value $Value) {
        return "placeholder"
    }

    $normalized = $Value.Trim()
    if ($normalized.StartsWith("v2:", [System.StringComparison]::OrdinalIgnoreCase)) {
        return "v2"
    }

    if ($normalized.StartsWith("v1:", [System.StringComparison]::OrdinalIgnoreCase)) {
        return "v1"
    }

    return "raw"
}

function Test-ProtectedTokenFile {
    param(
        [string]$Path,
        [bool]$DryRun
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Add-CheckResult -Check "AgentService.ProtectedTokenPath" -Status "WARN" -Detail "ProtectedTokenPath is empty. ApiToken fallback will be used."
        return $false
    }

    $resolvedPath = [System.IO.Path]::GetFullPath([System.Environment]::ExpandEnvironmentVariables($Path))
    if ([System.IO.Path]::IsPathRooted($Path)) {
        Add-CheckResult -Check "AgentService.ProtectedTokenPath" -Status "PASS" -Detail "Protected token path '$resolvedPath' is rooted."
    }
    else {
        Add-CheckResult -Check "AgentService.ProtectedTokenPath" -Status "WARN" -Detail "Protected token path '$Path' is relative; resolved as '$resolvedPath'."
    }

    if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
        $status = if ($DryRun) { "WARN" } else { "FAIL" }
        Add-CheckResult -Check "Protected token file" -Status $status -Detail "Protected token file '$resolvedPath' does not exist."
        return $false
    }

    try {
        $payload = Get-Content -LiteralPath $resolvedPath -Raw | ConvertFrom-Json
        $format = [string]$payload.format
        $scope = [string]$payload.scope
        $protectedToken = [string]$payload.protectedToken

        if ($format -ne "dpapi/v1") {
            Add-CheckResult -Check "Protected token format" -Status "FAIL" -Detail "Expected format 'dpapi/v1', got '$format'."
            return $false
        }

        if ($scope -notin @("LocalMachine", "CurrentUser")) {
            Add-CheckResult -Check "Protected token scope" -Status "FAIL" -Detail "Expected scope LocalMachine or CurrentUser, got '$scope'."
            return $false
        }

        try {
            [Convert]::FromBase64String($protectedToken) | Out-Null
        }
        catch {
            Add-CheckResult -Check "Protected token payload" -Status "FAIL" -Detail "Protected token payload is not valid base64."
            return $false
        }

        Add-CheckResult -Check "Protected token file" -Status "PASS" -Detail "Protected token metadata is valid at '$resolvedPath'."
        return $true
    }
    catch {
        Add-CheckResult -Check "Protected token file" -Status "FAIL" -Detail "Could not parse protected token file '$resolvedPath': $($_.Exception.Message)"
        return $false
    }
}

function Test-ApiReachability {
    param(
        [Uri]$BaseUri,
        [string]$HealthPath,
        [int]$Seconds
    )

    $healthUri = [Uri]::new($BaseUri, $HealthPath)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUri -Method Get -TimeoutSec $Seconds
        Add-CheckResult -Check "API reachability" -Status "PASS" -Detail "Reached '$healthUri' with HTTP $($response.StatusCode)."
    }
    catch {
        $webResponse = $_.Exception.Response
        if ($null -ne $webResponse) {
            $statusCode = [int]$webResponse.StatusCode
            Add-CheckResult -Check "API reachability" -Status "FAIL" -Detail "Reached '$healthUri' but received non-success HTTP $statusCode."
            return
        }

        Add-CheckResult -Check "API reachability" -Status "WARN" -Detail "Could not confirm '$healthUri': $($_.Exception.Message)"
    }
}

function Get-ServiceExecutablePath {
    param(
        [string]$PathName
    )

    if ([string]::IsNullOrWhiteSpace($PathName)) {
        return $null
    }

    $trimmed = $PathName.Trim()
    if ($trimmed.StartsWith('"', [System.StringComparison]::Ordinal)) {
        $closingQuoteIndex = $trimmed.IndexOf('"', 1)
        if ($closingQuoteIndex -gt 1) {
            return $trimmed.Substring(1, $closingQuoteIndex - 1)
        }
    }

    $match = [System.Text.RegularExpressions.Regex]::Match(
        $trimmed,
        '^(?<Executable>.+?\.exe)(?:\s|$)',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($match.Success) {
        return $match.Groups['Executable'].Value
    }

    return $trimmed
}

function Test-WindowsServiceRegistration {
    param(
        [bool]$RequireInstalledService
    )

    $serviceName = "EmployeeBehavior.Agent.Service"
    $expectedExecutableName = "EmployeeBehavior.Agent.Service.exe"

    if ($null -eq (Get-Command Get-Service -ErrorAction SilentlyContinue)) {
        $status = if ($RequireInstalledService) { "FAIL" } else { "WARN" }
        Add-CheckResult -Check "Windows service registration" -Status $status -Detail "Get-Service is not available in this shell; service registration was not inspected."
        return
    }

    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $service) {
        $status = if ($RequireInstalledService) { "FAIL" } else { "WARN" }
        Add-CheckResult -Check "Windows service registration" -Status $status -Detail "Windows service '$serviceName' was not found."
        return
    }

    Add-CheckResult -Check "Windows service registration" -Status "PASS" -Detail "Windows service '$serviceName' is registered."

    $scOutput = & sc.exe qc $serviceName 2>&1
    if ($LASTEXITCODE -eq 0) {
        $binaryPathLine = $scOutput | Where-Object { $_ -match 'BINARY_PATH_NAME' } | Select-Object -First 1
        if ($null -eq $binaryPathLine) {
            $status = if ($RequireInstalledService) { "FAIL" } else { "WARN" }
            Add-CheckResult -Check "Windows service binary path" -Status $status -Detail "Windows service '$serviceName' is registered, but sc.exe qc did not return BINARY_PATH_NAME."
        }
        else {
            $registeredExecutablePath = Get-ServiceExecutablePath -PathName ([string]($binaryPathLine -replace '^.*BINARY_PATH_NAME\s*:\s*', ''))
            if ([string]::IsNullOrWhiteSpace($registeredExecutablePath)) {
                $status = if ($RequireInstalledService) { "FAIL" } else { "WARN" }
                Add-CheckResult -Check "Windows service binary path" -Status $status -Detail "Windows service '$serviceName' does not expose a readable executable path."
            }
            elseif ([string]::Equals(
                [System.IO.Path]::GetFileName($registeredExecutablePath),
                $expectedExecutableName,
                [System.StringComparison]::OrdinalIgnoreCase)) {
                Add-CheckResult -Check "Windows service binary path" -Status "PASS" -Detail "Windows service '$serviceName' points to '$registeredExecutablePath'."
            }
            else {
                Add-CheckResult -Check "Windows service binary path" -Status "FAIL" -Detail "Windows service '$serviceName' points to '$registeredExecutablePath', expected '$expectedExecutableName'."
            }
        }
    }
    else {
        $status = if ($RequireInstalledService) { "FAIL" } else { "WARN" }
        $scMessage = (($scOutput | ForEach-Object { $_.ToString().Trim() }) -join ' ').Trim()
        Add-CheckResult -Check "Windows service binary path" -Status $status -Detail "sc.exe qc could not inspect Windows service '$serviceName': $scMessage"
    }

    $startMode = [string]$service.StartType
    $runtimeState = [string]$service.Status
    if ([string]::IsNullOrWhiteSpace($startMode) -or [string]::IsNullOrWhiteSpace($runtimeState)) {
        Add-CheckResult -Check "Windows service startup report" -Status "WARN" -Detail "Windows service '$serviceName' is registered, but startup mode/state could not be fully determined."
    }
    else {
        Add-CheckResult -Check "Windows service startup report" -Status "PASS" -Detail "Windows service '$serviceName' reports StartMode='$startMode'; State='$runtimeState'."
    }
}

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if ($null -eq $dotnet) {
    Add-CheckResult -Check ".NET availability" -Status "WARN" -Detail "dotnet is not on PATH. Source runs and framework-dependent publishes will not work until .NET is installed."
}
else {
    $runtimes = & dotnet --list-runtimes 2>$null
    $sdks = & dotnet --list-sdks 2>$null
    $hasNetCore8 = ($runtimes | Select-String -Pattern "^Microsoft\.NETCore\.App 8\.0\.")
    $hasWindowsDesktop8 = ($runtimes | Select-String -Pattern "^Microsoft\.WindowsDesktop\.App 8\.0\.")
    $hasSdk8 = ($sdks | Select-String -Pattern "^8\.0\.")

    if ($hasNetCore8 -and $hasWindowsDesktop8) {
        Add-CheckResult -Check ".NET availability" -Status "PASS" -Detail ".NET 8 runtime and Windows desktop runtime detected."
    }
    else {
        Add-CheckResult -Check ".NET availability" -Status "WARN" -Detail "dotnet is present, but the required .NET 8 runtime/Desktop runtime could not be confirmed."
    }

    if ($hasSdk8) {
        Add-CheckResult -Check ".NET SDK" -Status "PASS" -Detail ".NET 8 SDK detected."
    }
    else {
        Add-CheckResult -Check ".NET SDK" -Status "WARN" -Detail ".NET 8 SDK not detected. Source-based dotnet build and run commands may fail."
    }
}

$resolvedServiceConfig = Resolve-ConfigCandidate -Path $ServiceConfigPath -Label "Service config path"
$resolvedHelperConfig = Resolve-ConfigCandidate -Path $HelperConfigPath -Label "Helper config path"

$serviceConfig = Read-JsonFile -Path $resolvedServiceConfig -Label "Service config JSON"
$helperConfig = Read-JsonFile -Path $resolvedHelperConfig -Label "Helper config JSON"

$serviceSection = $null
if (Test-PropertyExists -InputObject $serviceConfig -Name "AgentService") {
    $serviceSection = $serviceConfig.AgentService
    Add-CheckResult -Check "AgentService section" -Status "PASS" -Detail "AgentService section is present."
}
else {
    Add-CheckResult -Check "AgentService section" -Status "FAIL" -Detail "Missing AgentService section."
}

$helperSection = $null
if (Test-PropertyExists -InputObject $helperConfig -Name "SessionHelper") {
    $helperSection = $helperConfig.SessionHelper
    Add-CheckResult -Check "SessionHelper section" -Status "PASS" -Detail "SessionHelper section is present."
}
else {
    Add-CheckResult -Check "SessionHelper section" -Status "FAIL" -Detail "Missing SessionHelper section."
}

$serviceUri = $null
if ($null -ne $serviceSection) {
    foreach ($requiredProperty in @(
        "ApiBaseUrl",
        "ProtectedTokenPath",
        "ApiToken",
        "DryRun",
        "DeviceIdPath",
        "SessionHelperPipeName",
        "SessionHelperConnectTimeoutSeconds",
        "SessionHelperRequestTimeoutSeconds",
        "HeartbeatIntervalSeconds",
        "PolicyRefreshIntervalSeconds",
        "UploadPollIntervalSeconds",
        "UploadBatchSize",
        "UploadQueuePath",
        "UploadQueueLeaseDurationSeconds",
        "DefaultPolicy"
    )) {
        if (Test-PropertyExists -InputObject $serviceSection -Name $requiredProperty) {
            Add-CheckResult -Check "AgentService.$requiredProperty" -Status "PASS" -Detail "Property is present."
        }
        else {
            Add-CheckResult -Check "AgentService.$requiredProperty" -Status "FAIL" -Detail "Missing required property."
        }
    }

    $apiBaseUrl = [string]$serviceSection.ApiBaseUrl
    if ([Uri]::TryCreate($apiBaseUrl, [System.UriKind]::Absolute, [ref]$serviceUri)) {
        Add-CheckResult -Check "AgentService.ApiBaseUrl" -Status "PASS" -Detail "Absolute URI '$apiBaseUrl' is valid."
    }
    else {
        Add-CheckResult -Check "AgentService.ApiBaseUrl" -Status "FAIL" -Detail "Value '$apiBaseUrl' is not a valid absolute URI."
    }

    $dryRun = $serviceSection.DryRun -eq $true
    $protectedTokenPath = if (Test-PropertyExists -InputObject $serviceSection -Name "ProtectedTokenPath") {
        [string]$serviceSection.ProtectedTokenPath
    }
    else {
        ""
    }
    $protectedTokenConfigured = Test-ProtectedTokenFile -Path $protectedTokenPath -DryRun $dryRun
    $apiToken = [string]$serviceSection.ApiToken
    $apiTokenShape = Get-AgentTokenShape -Value $apiToken

    if ($apiTokenShape -eq "v2") {
        Add-CheckResult -Check "AgentService.ApiToken" -Status "PASS" -Detail "ApiToken is an issued v2 device-scoped token."
    }
    elseif ($apiTokenShape -in @("empty", "placeholder")) {
        if ($protectedTokenConfigured) {
            Add-CheckResult -Check "AgentService.ApiToken" -Status "PASS" -Detail "ApiToken fallback is empty/placeholder because ProtectedTokenPath is valid."
        }
        elseif ($dryRun) {
            Add-CheckResult -Check "AgentService.ApiToken" -Status "WARN" -Detail "ApiToken is empty/placeholder and ProtectedTokenPath is not available. This is acceptable only while DryRun=true."
        }
        else {
            Add-CheckResult -Check "AgentService.ApiToken" -Status "FAIL" -Detail "DryRun=false requires either a valid ProtectedTokenPath file or an issued v2 ApiToken."
        }
    }
    elseif ($apiTokenShape -eq "v1") {
        $status = if ($dryRun) { "WARN" } else { "FAIL" }
        Add-CheckResult -Check "AgentService.ApiToken" -Status $status -Detail "ApiToken is a legacy v1 token. Production backends reject v1 tokens."
    }
    else {
        $status = if ($dryRun) { "WARN" } else { "FAIL" }
        Add-CheckResult -Check "AgentService.ApiToken" -Status $status -Detail "ApiToken is a raw signing secret or unknown token shape. Use issued v2 tokens for production."
    }

    Test-BooleanValue -Check "AgentService.DryRun" -Value $serviceSection.DryRun
    Test-PositiveInteger -Check "AgentService.SessionHelperConnectTimeoutSeconds" -Value $serviceSection.SessionHelperConnectTimeoutSeconds
    Test-PositiveInteger -Check "AgentService.SessionHelperRequestTimeoutSeconds" -Value $serviceSection.SessionHelperRequestTimeoutSeconds
    Test-PositiveInteger -Check "AgentService.HeartbeatIntervalSeconds" -Value $serviceSection.HeartbeatIntervalSeconds
    Test-PositiveInteger -Check "AgentService.PolicyRefreshIntervalSeconds" -Value $serviceSection.PolicyRefreshIntervalSeconds
    Test-PositiveInteger -Check "AgentService.UploadPollIntervalSeconds" -Value $serviceSection.UploadPollIntervalSeconds
    Test-PositiveInteger -Check "AgentService.UploadBatchSize" -Value $serviceSection.UploadBatchSize
    Test-PositiveInteger -Check "AgentService.UploadQueueLeaseDurationSeconds" -Value $serviceSection.UploadQueueLeaseDurationSeconds

    if ($serviceSection.SessionHelperRequestTimeoutSeconds -ge $serviceSection.SessionHelperConnectTimeoutSeconds) {
        Add-CheckResult -Check "Service/helper timeout relationship" -Status "PASS" -Detail "Request timeout is not shorter than connect timeout."
    }
    else {
        Add-CheckResult -Check "Service/helper timeout relationship" -Status "FAIL" -Detail "SessionHelperRequestTimeoutSeconds must be greater than or equal to SessionHelperConnectTimeoutSeconds."
    }

    $deviceIdPath = [string]$serviceSection.DeviceIdPath
    if ([System.IO.Path]::IsPathRooted($deviceIdPath)) {
        Add-CheckResult -Check "Device identity path" -Status "PASS" -Detail "DeviceIdPath '$deviceIdPath' is rooted."
    }
    else {
        Add-CheckResult -Check "Device identity path" -Status "WARN" -Detail "DeviceIdPath '$deviceIdPath' is not rooted."
    }

    $uploadQueuePath = [string]$serviceSection.UploadQueuePath
    if ([System.IO.Path]::IsPathRooted($uploadQueuePath)) {
        Add-CheckResult -Check "Upload queue path" -Status "PASS" -Detail "UploadQueuePath '$uploadQueuePath' is rooted."
    }
    else {
        Add-CheckResult -Check "Upload queue path" -Status "WARN" -Detail "UploadQueuePath '$uploadQueuePath' is not rooted."
    }

    $deviceIdDirectory = Split-Path -Path $deviceIdPath -Parent
    if ([string]::IsNullOrWhiteSpace($deviceIdDirectory)) {
        Add-CheckResult -Check "Device identity directory" -Status "FAIL" -Detail "Could not resolve the DeviceIdPath parent directory."
    }
    elseif (Test-Path -LiteralPath $deviceIdDirectory) {
        Add-CheckResult -Check "Device identity directory" -Status "PASS" -Detail "Directory '$deviceIdDirectory' exists."
    }
    else {
        Add-CheckResult -Check "Device identity directory" -Status "WARN" -Detail "Directory '$deviceIdDirectory' does not exist yet. The service will attempt to create it on first start."
    }

    if (Test-Path -LiteralPath $deviceIdPath) {
        try {
            $deviceDocument = Get-Content -LiteralPath $deviceIdPath -Raw | ConvertFrom-Json
            $deviceId = [string]$deviceDocument.DeviceId
            if ($deviceId -match "^[0-9a-f]{32}$") {
                Add-CheckResult -Check "Device identity file" -Status "PASS" -Detail "Existing device identity file contains a valid 32-character lowercase device id."
            }
            else {
                Add-CheckResult -Check "Device identity file" -Status "WARN" -Detail "Existing device identity file was found, but DeviceId did not match the expected 32-character lowercase format."
            }
        }
        catch {
            Add-CheckResult -Check "Device identity file" -Status "WARN" -Detail "Existing device identity file could not be parsed: $($_.Exception.Message)"
        }
    }
    else {
        Add-CheckResult -Check "Device identity file" -Status "WARN" -Detail "Device identity file does not exist yet. It will be created on first successful service start."
    }

    $uploadQueueDirectory = Split-Path -Path $uploadQueuePath -Parent
    if ([string]::IsNullOrWhiteSpace($uploadQueueDirectory)) {
        Add-CheckResult -Check "Upload queue directory" -Status "FAIL" -Detail "Could not resolve the UploadQueuePath parent directory."
    }
    elseif (Test-Path -LiteralPath $uploadQueueDirectory) {
        Add-CheckResult -Check "Upload queue directory" -Status "PASS" -Detail "Directory '$uploadQueueDirectory' exists."
    }
    else {
        Add-CheckResult -Check "Upload queue directory" -Status "WARN" -Detail "Directory '$uploadQueueDirectory' does not exist yet. The service will attempt to create it on first start."
    }

    if (Test-PropertyExists -InputObject $serviceSection.DefaultPolicy -Name "ScreenshotIntervalSeconds") {
        Test-PositiveInteger -Check "AgentService.DefaultPolicy.ScreenshotIntervalSeconds" -Value $serviceSection.DefaultPolicy.ScreenshotIntervalSeconds
    }

    if (Test-PropertyExists -InputObject $serviceSection.DefaultPolicy -Name "NoChangeThreshold") {
        Test-PositiveInteger -Check "AgentService.DefaultPolicy.NoChangeThreshold" -Value $serviceSection.DefaultPolicy.NoChangeThreshold
    }
}

if ($null -ne $helperSection) {
    foreach ($requiredProperty in @(
        "PipeName",
        "EnableTrayIcon",
        "RunInConsole",
        "EnableInputActivityHooks",
        "EnableDesktopStateInspection",
        "InputHookStartupTimeoutSeconds",
        "SampleLogIntervalSeconds"
    )) {
        if (Test-PropertyExists -InputObject $helperSection -Name $requiredProperty) {
            Add-CheckResult -Check "SessionHelper.$requiredProperty" -Status "PASS" -Detail "Property is present."
        }
        else {
            Add-CheckResult -Check "SessionHelper.$requiredProperty" -Status "FAIL" -Detail "Missing required property."
        }
    }

    Test-BooleanValue -Check "SessionHelper.EnableTrayIcon" -Value $helperSection.EnableTrayIcon
    Test-BooleanValue -Check "SessionHelper.RunInConsole" -Value $helperSection.RunInConsole
    Test-BooleanValue -Check "SessionHelper.EnableInputActivityHooks" -Value $helperSection.EnableInputActivityHooks
    Test-BooleanValue -Check "SessionHelper.EnableDesktopStateInspection" -Value $helperSection.EnableDesktopStateInspection
    Test-PositiveInteger -Check "SessionHelper.InputHookStartupTimeoutSeconds" -Value $helperSection.InputHookStartupTimeoutSeconds
    Test-PositiveInteger -Check "SessionHelper.SampleLogIntervalSeconds" -Value $helperSection.SampleLogIntervalSeconds

    $dryRunForVisibility = $false
    if ($null -ne $serviceSection) {
        $dryRunForVisibility = $serviceSection.DryRun -eq $true
    }

    Test-SessionHelperVisibility `
        -EnableTrayIcon $helperSection.EnableTrayIcon `
        -RunInConsole $helperSection.RunInConsole `
        -DryRun $dryRunForVisibility
    Test-SessionHelperVisibilityOverrides -DryRun $dryRunForVisibility
    Test-HelperScheduledTaskArguments `
        -TaskName $HelperTaskName `
        -DryRun $dryRunForVisibility `
        -RequireInstalledTask $RequireInstalledHelperTask.IsPresent
}

if ($null -ne $serviceSection -and $null -ne $helperSection) {
    if ([string]::Equals([string]$serviceSection.SessionHelperPipeName, [string]$helperSection.PipeName, [System.StringComparison]::Ordinal)) {
        Add-CheckResult -Check "Named pipe agreement" -Status "PASS" -Detail "Service and helper pipe names match."
    }
    else {
        Add-CheckResult -Check "Named pipe agreement" -Status "FAIL" -Detail "Service pipe '$($serviceSection.SessionHelperPipeName)' does not match helper pipe '$($helperSection.PipeName)'."
    }
}

Add-CheckResult -Check "Machine identity" -Status "PASS" -Detail "MachineName='$([System.Environment]::MachineName)'; UserInteractive=$([System.Environment]::UserInteractive)."

Test-WindowsServiceRegistration -RequireInstalledService $RequireInstalledHelperTask.IsPresent

if (Test-Path -LiteralPath $LogRootPath) {
    Add-CheckResult -Check "Log root path" -Status "PASS" -Detail "Log directory '$LogRootPath' exists."
}
else {
    Add-CheckResult -Check "Log root path" -Status "WARN" -Detail "Log directory '$LogRootPath' does not exist. Current agent code only emits console logs, so deployed log capture depends on wrapper or installer redirection."
}

if ($null -ne $serviceUri) {
    if (Test-PlaceholderValue -Value $serviceUri.Host) {
        Add-CheckResult -Check "API reachability" -Status "WARN" -Detail "ApiBaseUrl host '$($serviceUri.Host)' still looks like a placeholder. Reachability check skipped."
    }
    else {
        Test-ApiReachability -BaseUri $serviceUri -HealthPath $ApiHealthPath -Seconds $TimeoutSeconds
    }
}

$results | Format-Table -AutoSize

if ($hasFailure) {
    exit 1
}

exit 0
