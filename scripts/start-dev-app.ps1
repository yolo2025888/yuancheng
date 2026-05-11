Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Get-FreePort {
    param([Parameter(Mandatory = $true)][int]$Start)

    $port = $Start
    while ($true) {
        $used = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $used) {
            return $port
        }
        $port++
    }
}

$backendPort = Get-FreePort 8010
$frontendPort = Get-FreePort 5173

$backendOut = Join-Path $logDir "backend-dev-$backendPort.out.log"
$backendErr = Join-Path $logDir "backend-dev-$backendPort.err.log"
$frontendOut = Join-Path $logDir "frontend-dev-$frontendPort.out.log"
$frontendErr = Join-Path $logDir "frontend-dev-$frontendPort.err.log"

$previousBackendEnvironment = $env:EBM_ENVIRONMENT
$previousBackendDatabaseUrl = $env:EBM_DATABASE_URL
$previousBackendAuthSecret = $env:EBM_AUTH_SECRET
$previousBackendAgentToken = $env:EBM_AGENT_API_TOKEN
$previousFrontendApiBaseUrl = $env:VITE_API_BASE_URL

$env:EBM_ENVIRONMENT = "development"
$env:EBM_DATABASE_URL = "sqlite:///./employee_behavior.db"
$env:EBM_AUTH_SECRET = "local-auth-secret-with-enough-entropy-2026"
$env:EBM_AGENT_API_TOKEN = "local-agent-token-with-enough-entropy-2026"
$env:VITE_API_BASE_URL = "http://127.0.0.1:$backendPort"

Start-Process `
    -FilePath "python" `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$backendPort") `
    -WorkingDirectory (Join-Path $root "backend") `
    -RedirectStandardOutput $backendOut `
    -RedirectStandardError $backendErr `
    -WindowStyle Hidden

Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$frontendPort") `
    -WorkingDirectory (Join-Path $root "frontend") `
    -RedirectStandardOutput $frontendOut `
    -RedirectStandardError $frontendErr `
    -WindowStyle Hidden

$env:EBM_ENVIRONMENT = $previousBackendEnvironment
$env:EBM_DATABASE_URL = $previousBackendDatabaseUrl
$env:EBM_AUTH_SECRET = $previousBackendAuthSecret
$env:EBM_AGENT_API_TOKEN = $previousBackendAgentToken
$env:VITE_API_BASE_URL = $previousFrontendApiBaseUrl

[PSCustomObject]@{
    BackendUrl = "http://127.0.0.1:$backendPort"
    FrontendUrl = "http://127.0.0.1:$frontendPort"
    BackendLog = $backendErr
    FrontendLog = $frontendOut
} | Format-List
