[CmdletBinding()]
param(
    [string]$BackendDatabasePath = '.\backend\employee_behavior.db',
    [string]$ServiceConfigPath = 'C:\Program Files\EmployeeBehaviorAgent\Service\appsettings.json',
    [string]$DeviceIdPath = 'C:\ProgramData\EmployeeBehaviorAgent\device-id.json',
    [string]$ProtectedTokenPath = 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json',
    [string]$EmployeeNo = 'E-001',
    [string]$EmployeeName = 'Local Dev User',
    [string]$Department = 'Engineering',
    [string]$ApiBaseUrl = 'http://127.0.0.1:8010',
    [int]$TokenTtlDays = 30,
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

function Get-PythonCommand {
    foreach ($candidate in @('python', 'py')) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($null -ne $command -and -not [string]::IsNullOrWhiteSpace($command.Source)) {
            return $candidate
        }
    }

    throw 'Python was not found on PATH. Prepare-AgentLocalBackendTest.ps1 needs Python to update the local SQLite backend.'
}

if (-not (Test-IsAdministrator)) {
    throw 'Prepare-AgentLocalBackendTest.ps1 must be run from an elevated PowerShell session.'
}

$resolvedBackendDatabasePath = Resolve-FullPath -Path $BackendDatabasePath
$resolvedServiceConfigPath = Resolve-FullPath -Path $ServiceConfigPath
$resolvedDeviceIdPath = Resolve-FullPath -Path $DeviceIdPath
$resolvedProtectedTokenPath = Resolve-FullPath -Path $ProtectedTokenPath

if (-not (Test-Path -LiteralPath $resolvedBackendDatabasePath -PathType Leaf)) {
    throw "Backend database not found: $resolvedBackendDatabasePath"
}
if (-not (Test-Path -LiteralPath $resolvedServiceConfigPath -PathType Leaf)) {
    throw "Service config not found: $resolvedServiceConfigPath"
}
if (-not (Test-Path -LiteralPath $resolvedDeviceIdPath -PathType Leaf)) {
    throw "Device identity file not found: $resolvedDeviceIdPath"
}

$deviceIdentity = Get-Content -LiteralPath $resolvedDeviceIdPath -Raw | ConvertFrom-Json
$deviceId = [string]$deviceIdentity.DeviceId
if ([string]::IsNullOrWhiteSpace($deviceId)) {
    throw "Device identity file '$resolvedDeviceIdPath' does not contain DeviceId."
}

$secret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$token = "v2:${deviceId}:${secret}"
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $hashBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($secret))
}
finally {
    $sha256.Dispose()
}
$hash = [System.BitConverter]::ToString($hashBytes).Replace('-', '').ToLowerInvariant()
$agentTokenHash = "sha256:$hash"
$hostname = [System.Environment]::MachineName
$expiresAt = [DateTime]::UtcNow.AddDays($TokenTtlDays).ToString('o')
$updatedAt = [DateTime]::UtcNow.ToString('o')
$pythonCommand = Get-PythonCommand

$env:LOCAL_AGENT_DB_PATH = $resolvedBackendDatabasePath
$env:LOCAL_AGENT_DEVICE_ID = $deviceId
$env:LOCAL_AGENT_EMPLOYEE_NO = $EmployeeNo
$env:LOCAL_AGENT_EMPLOYEE_NAME = $EmployeeName
$env:LOCAL_AGENT_DEPARTMENT = $Department
$env:LOCAL_AGENT_HOSTNAME = $hostname
$env:LOCAL_AGENT_AGENT_TOKEN_HASH = $agentTokenHash
$env:LOCAL_AGENT_EXPIRES_AT = $expiresAt
$env:LOCAL_AGENT_UPDATED_AT = $updatedAt

try {
    if ($pythonCommand -eq 'py') {
        @'
import os, sqlite3, uuid
db_path = os.environ['LOCAL_AGENT_DB_PATH']
device_id = os.environ['LOCAL_AGENT_DEVICE_ID']
employee_no = os.environ['LOCAL_AGENT_EMPLOYEE_NO']
employee_name = os.environ['LOCAL_AGENT_EMPLOYEE_NAME']
department = os.environ['LOCAL_AGENT_DEPARTMENT']
hostname = os.environ['LOCAL_AGENT_HOSTNAME']
agent_token_hash = os.environ['LOCAL_AGENT_AGENT_TOKEN_HASH']
expires_at = os.environ['LOCAL_AGENT_EXPIRES_AT']
updated_at = os.environ['LOCAL_AGENT_UPDATED_AT']
created_at = updated_at

conn = sqlite3.connect(db_path)
cur = conn.cursor()
employee = cur.execute("select id from employees where employee_no = ?", (employee_no,)).fetchone()
if employee is None:
    employee_id = str(uuid.uuid4())
    cur.execute(
        "insert into employees (id, created_at, updated_at, name, employee_no, department, manager_id, github_username, status, manager_name, job_role) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (employee_id, created_at, updated_at, employee_name, employee_no, department, None, None, 'active', None, None)
    )
else:
    employee_id = employee[0]
    cur.execute(
        "update employees set updated_at = ?, name = ?, department = ?, status = 'active' where id = ?",
        (updated_at, employee_name, department, employee_id)
    )

device = cur.execute("select id from devices where id = ?", (device_id,)).fetchone()
if device is None:
    cur.execute(
        "insert into devices (id, created_at, updated_at, employee_id, hostname, os_type, agent_version, screen_count, last_heartbeat_at, status, last_foreground_window_json, last_session_state_json, last_input_activity_json, agent_token_hash, agent_token_revoked_at, agent_token_expires_at, agent_token_last_used_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (device_id, created_at, updated_at, employee_id, hostname, 'windows', '0.1.0-local', 1, None, 'offline', None, None, None, agent_token_hash, None, expires_at, None)
    )
else:
    cur.execute(
        "update devices set updated_at = ?, employee_id = ?, hostname = ?, os_type = 'windows', agent_version = '0.1.0-local', screen_count = 1, status = 'offline', agent_token_hash = ?, agent_token_revoked_at = null, agent_token_expires_at = ?, agent_token_last_used_at = null where id = ?",
        (updated_at, employee_id, hostname, agent_token_hash, expires_at, device_id)
    )

conn.commit()
conn.close()
'@ | py -3 -
    }
    else {
        @'
import os, sqlite3, uuid
db_path = os.environ['LOCAL_AGENT_DB_PATH']
device_id = os.environ['LOCAL_AGENT_DEVICE_ID']
employee_no = os.environ['LOCAL_AGENT_EMPLOYEE_NO']
employee_name = os.environ['LOCAL_AGENT_EMPLOYEE_NAME']
department = os.environ['LOCAL_AGENT_DEPARTMENT']
hostname = os.environ['LOCAL_AGENT_HOSTNAME']
agent_token_hash = os.environ['LOCAL_AGENT_AGENT_TOKEN_HASH']
expires_at = os.environ['LOCAL_AGENT_EXPIRES_AT']
updated_at = os.environ['LOCAL_AGENT_UPDATED_AT']
created_at = updated_at

conn = sqlite3.connect(db_path)
cur = conn.cursor()
employee = cur.execute("select id from employees where employee_no = ?", (employee_no,)).fetchone()
if employee is None:
    employee_id = str(uuid.uuid4())
    cur.execute(
        "insert into employees (id, created_at, updated_at, name, employee_no, department, manager_id, github_username, status, manager_name, job_role) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (employee_id, created_at, updated_at, employee_name, employee_no, department, None, None, 'active', None, None)
    )
else:
    employee_id = employee[0]
    cur.execute(
        "update employees set updated_at = ?, name = ?, department = ?, status = 'active' where id = ?",
        (updated_at, employee_name, department, employee_id)
    )

device = cur.execute("select id from devices where id = ?", (device_id,)).fetchone()
if device is None:
    cur.execute(
        "insert into devices (id, created_at, updated_at, employee_id, hostname, os_type, agent_version, screen_count, last_heartbeat_at, status, last_foreground_window_json, last_session_state_json, last_input_activity_json, agent_token_hash, agent_token_revoked_at, agent_token_expires_at, agent_token_last_used_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (device_id, created_at, updated_at, employee_id, hostname, 'windows', '0.1.0-local', 1, None, 'offline', None, None, None, agent_token_hash, None, expires_at, None)
    )
else:
    cur.execute(
        "update devices set updated_at = ?, employee_id = ?, hostname = ?, os_type = 'windows', agent_version = '0.1.0-local', screen_count = 1, status = 'offline', agent_token_hash = ?, agent_token_revoked_at = null, agent_token_expires_at = ?, agent_token_last_used_at = null where id = ?",
        (updated_at, employee_id, hostname, agent_token_hash, expires_at, device_id)
    )

conn.commit()
conn.close()
'@ | python -
    }
}
finally {
    Remove-Item Env:LOCAL_AGENT_DB_PATH,Env:LOCAL_AGENT_DEVICE_ID,Env:LOCAL_AGENT_EMPLOYEE_NO,Env:LOCAL_AGENT_EMPLOYEE_NAME,Env:LOCAL_AGENT_DEPARTMENT,Env:LOCAL_AGENT_HOSTNAME,Env:LOCAL_AGENT_AGENT_TOKEN_HASH,Env:LOCAL_AGENT_EXPIRES_AT,Env:LOCAL_AGENT_UPDATED_AT -ErrorAction SilentlyContinue
}

$serviceConfig = Get-Content -LiteralPath $resolvedServiceConfigPath -Raw | ConvertFrom-Json
$agentService = $serviceConfig.AgentService
$agentService.ApiBaseUrl = $ApiBaseUrl
$agentService.DryRun = $false
$agentService.ApiToken = ''
$agentService.ProtectedTokenPath = $resolvedProtectedTokenPath
if (-not $agentService.PSObject.Properties['AllowInsecureLoopbackForDevelopment']) {
    $agentService | Add-Member -NotePropertyName 'AllowInsecureLoopbackForDevelopment' -NotePropertyValue $true
}
else {
    $agentService.AllowInsecureLoopbackForDevelopment = $true
}
$serviceConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resolvedServiceConfigPath -Encoding UTF8

& "$PSScriptRoot\Write-AgentProtectedToken.ps1" -Token $token -Path $resolvedProtectedTokenPath -Scope LocalMachine -Force | Out-Null

if ($StartService) {
    Restart-Service -Name 'EmployeeBehavior.Agent.Service' -Force
}

if ($StartHelperTask) {
    Start-ScheduledTask -TaskName 'EmployeeBehavior.Agent.SessionHelper'
}

[pscustomobject]@{
    DeviceId = $deviceId
    EmployeeNo = $EmployeeNo
    ApiBaseUrl = $ApiBaseUrl
    ServiceConfigPath = $resolvedServiceConfigPath
    ProtectedTokenPath = $resolvedProtectedTokenPath
    StartService = [bool]$StartService
    StartHelperTask = [bool]$StartHelperTask
}
