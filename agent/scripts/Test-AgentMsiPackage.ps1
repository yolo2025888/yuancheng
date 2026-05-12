[CmdletBinding()]
param(
    [string]$WixProjectPath = '.\agent\installer\wix\EmployeeBehavior.Agent.Installer.wixproj',
    [string]$Configuration = 'Release'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedWixProjectPath = [System.IO.Path]::GetFullPath($WixProjectPath)
if (-not (Test-Path -LiteralPath $resolvedWixProjectPath -PathType Leaf)) {
    throw "WiX project not found: $resolvedWixProjectPath"
}

$projectDirectory = Split-Path -Parent $resolvedWixProjectPath
$candidateDirectories = @(
    (Join-Path $projectDirectory ("bin\$Configuration\en-US")),
    (Join-Path $projectDirectory ("bin\$Configuration"))
)

$resolvedOutputDirectory = $null
foreach ($candidateDirectory in $candidateDirectories) {
    if (Test-Path -LiteralPath (Join-Path $candidateDirectory 'EmployeeBehavior.Agent.Installer.msi') -PathType Leaf) {
        $resolvedOutputDirectory = $candidateDirectory
        break
    }
}

if ($null -eq $resolvedOutputDirectory) {
    throw "Expected WiX MSI output not found under: $($candidateDirectories -join ', ')"
}

$msiPath = Join-Path $resolvedOutputDirectory 'EmployeeBehavior.Agent.Installer.msi'
$wixPdbPath = Join-Path $resolvedOutputDirectory 'EmployeeBehavior.Agent.Installer.wixpdb'

foreach ($path in @($msiPath, $wixPdbPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Expected WiX output not found: $path"
    }
}

[pscustomobject]@{
    Status = 'PASS'
    WixProjectPath = $resolvedWixProjectPath
    OutputDirectory = [System.IO.Path]::GetFullPath($resolvedOutputDirectory)
    MsiPath = [System.IO.Path]::GetFullPath($msiPath)
    WixPdbPath = [System.IO.Path]::GetFullPath($wixPdbPath)
}
