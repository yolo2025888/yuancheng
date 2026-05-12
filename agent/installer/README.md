# Agent Installer Package

This directory contains the first in-repo installer package project for the Windows agent. It does not use any external GUI installer tooling.

Build the package directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\installer\Build-AgentInstallerPackage.ps1
```

If the current machine does not have `dotnet` on `PATH`, the build wrapper falls back to the existing `agent\publish\` payloads.

Build the package directory and zip:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\installer\Build-AgentInstallerPackage.ps1 -CreateZip
```

Direct MSBuild entry point:

```powershell
dotnet msbuild .\agent\installer\EmployeeBehavior.Agent.InstallerPackage.proj -t:BuildPackage -p:CreateZip=true
```

The assembled delivery directory contains:

- `payload\Service\`
- `payload\SessionHelper\`
- `payload\Launcher\`
- `Install-AgentInstallerPackage.ps1`
- `Validate-AgentInstallerPackage.ps1`
- `Uninstall-AgentInstallerPackage.ps1`
- `Test-AgentInstallerPackage.ps1`
- `tools\Install-AgentPilot.ps1`
- `tools\Uninstall-AgentPilot.ps1`
- `tools\Test-AgentDeployment.ps1`
- `tools\Test-AgentInstalledLifecycle.ps1`

Installed endpoint validation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Validate-AgentInstallerPackage.ps1 -RequireInstalledHelperTask
```

Installed lifecycle acceptance:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-AgentInstalledLifecycle.ps1 `
  -LauncherExecutablePath 'C:\Program Files\EmployeeBehaviorAgent\Launcher\EmployeeBehavior.Agent.Launcher.exe' `
  -EmployeeCode 'E-001'
```
