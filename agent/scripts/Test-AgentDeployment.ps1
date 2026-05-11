[CmdletBinding()]
param(
    [string]$ServiceConfigPath = ".\agent\src\EmployeeBehavior.Agent.Service\appsettings.json",
    [string]$HelperConfigPath = ".\agent\src\EmployeeBehavior.Agent.SessionHelper\appsettings.json",
    [string]$ApiHealthPath = "/health",
    [string]$LogRootPath = "C:\ProgramData\EmployeeBehaviorAgent\logs",
    [int]$TimeoutSeconds = 5
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

    if ($Value -is [int] -and $Value -gt 0) {
        Add-CheckResult -Check $Check -Status "PASS" -Detail "Value '$Value' is a positive integer."
    }
    else {
        Add-CheckResult -Check $Check -Status "FAIL" -Detail "Value '$Value' must be a positive integer."
    }
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

function Test-PlaceholderValue {
    param(
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $true
    }

    $normalized = $Value.Trim().ToLowerInvariant()
    return $normalized.Contains("replace-") -or $normalized.Contains("example.internal")
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
            Add-CheckResult -Check "API reachability" -Status "PASS" -Detail "Reached '$healthUri' and received HTTP $([int]$webResponse.StatusCode)."
            return
        }

        Add-CheckResult -Check "API reachability" -Status "WARN" -Detail "Could not confirm '$healthUri': $($_.Exception.Message)"
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

    if (Test-PlaceholderValue -Value ([string]$serviceSection.ApiToken)) {
        if ($serviceSection.DryRun -eq $true) {
            Add-CheckResult -Check "AgentService.ApiToken" -Status "WARN" -Detail "ApiToken still looks like a placeholder, which is acceptable only while DryRun=true."
        }
        else {
            Add-CheckResult -Check "AgentService.ApiToken" -Status "FAIL" -Detail "ApiToken still looks like a placeholder while DryRun=false."
        }
    }
    else {
        Add-CheckResult -Check "AgentService.ApiToken" -Status "PASS" -Detail "ApiToken is populated."
    }

    Test-BooleanValue -Check "AgentService.DryRun" -Value $serviceSection.DryRun
    Test-PositiveInteger -Check "AgentService.SessionHelperConnectTimeoutSeconds" -Value $serviceSection.SessionHelperConnectTimeoutSeconds
    Test-PositiveInteger -Check "AgentService.SessionHelperRequestTimeoutSeconds" -Value $serviceSection.SessionHelperRequestTimeoutSeconds
    Test-PositiveInteger -Check "AgentService.HeartbeatIntervalSeconds" -Value $serviceSection.HeartbeatIntervalSeconds
    Test-PositiveInteger -Check "AgentService.PolicyRefreshIntervalSeconds" -Value $serviceSection.PolicyRefreshIntervalSeconds
    Test-PositiveInteger -Check "AgentService.UploadPollIntervalSeconds" -Value $serviceSection.UploadPollIntervalSeconds
    Test-PositiveInteger -Check "AgentService.UploadBatchSize" -Value $serviceSection.UploadBatchSize

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
