Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-Tool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$VersionCommand
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        [PSCustomObject]@{
            Tool = $Name
            Installed = $false
            Version = "not found"
        }
        return
    }

    $version = try {
        Invoke-Expression $VersionCommand 2>&1 | Select-Object -First 1
    }
    catch {
        $_.Exception.Message
    }

    [PSCustomObject]@{
        Tool = $Name
        Installed = $true
        Version = "$version"
    }
}

$tools = @(
    Test-Tool -Name "dotnet" -VersionCommand "dotnet --version"
    Test-Tool -Name "python" -VersionCommand "python --version"
    Test-Tool -Name "node" -VersionCommand "node --version"
    Test-Tool -Name "npm" -VersionCommand "npm --version"
    Test-Tool -Name "docker" -VersionCommand "docker --version"
)

$tools | Format-Table -AutoSize

