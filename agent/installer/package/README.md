# Employee Behavior Agent Installer Package

This package assembles the Windows agent payloads plus direct install, uninstall, and package verification entry scripts without using any external GUI installer tool.

## Package layout

- `payload\Service\`
- `payload\SessionHelper\`
- `payload\Launcher\`
- `Install-AgentInstallerPackage.ps1`
- `Uninstall-AgentInstallerPackage.ps1`
- `Test-AgentInstallerPackage.ps1`
- `tools\Install-AgentPilot.ps1`
- `tools\Uninstall-AgentPilot.ps1`
- `tools\Test-AgentDeployment.ps1`
- `tools\Test-AgentInstalledLifecycle.ps1`

## Validate package contents

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-AgentInstallerPackage.ps1
```

## Install payloads

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-AgentInstallerPackage.ps1 -HelperTaskUser CONTOSO\pilot.user -StartService
```

`Install-AgentInstallerPackage.ps1` wraps the bundled `tools\Install-AgentPilot.ps1`, installs `Service` plus `SessionHelper`, and copies the launcher payload into `C:\Program Files\EmployeeBehaviorAgent\Launcher\` by default.

## Uninstall registrations

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-AgentInstallerPackage.ps1
```

Add `-RemoveServiceDirectory`, `-RemoveHelperDirectory`, or `-RemoveLauncherDirectory` only when you intentionally want to delete installed payload folders.

## Post-install validation

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-AgentDeployment.ps1 -ServiceConfigPath 'C:\Program Files\EmployeeBehaviorAgent\Service\appsettings.json' -HelperConfigPath 'C:\Program Files\EmployeeBehaviorAgent\SessionHelper\appsettings.json' -RequireInstalledHelperTask
```

Installed lifecycle smoke:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\Test-AgentInstalledLifecycle.ps1 -LauncherExecutablePath 'C:\Program Files\EmployeeBehaviorAgent\Launcher\EmployeeBehavior.Agent.Launcher.exe' -EmployeeCode 'E-001'
```
