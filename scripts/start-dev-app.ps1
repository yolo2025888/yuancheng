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

$backendEnv = "EBM_DATABASE_URL=sqlite:///./employee_behavior.db"

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

[PSCustomObject]@{
    BackendUrl = "http://127.0.0.1:$backendPort"
    FrontendUrl = "http://127.0.0.1:$frontendPort"
    BackendLog = $backendErr
    FrontendLog = $frontendOut
} | Format-List
