# Operations and Demo Guide

Open `agent\publish\EmployeeBehavior.Agent.Launcher.exe` for the Windows client. The launcher shows the punch clock UI; the approved service and session helper start only after the employee clocks in:

- `EmployeeBehavior.Agent.Service.exe` handles API calls, heartbeats, uploads, token auth, and attendance submission.
- `EmployeeBehavior.Agent.SessionHelper.exe` runs in the interactive user session for screenshots and input/session activity capture.

Before a pilot or production demo, confirm the employee-facing disclosure covers full multi-display screenshots, active window title, process name/path, session/lock/RDP/idle metadata, aggregate input counts, purpose, access roles, retention, and appeal channel.

Provision the DPAPI protected token file first, then switch the published service config to production mode before validation:

Regenerate `agent\publish` for the exact commit being demoed, or download the matching CI artifact before running these commands.

```powershell
Set-Location backend; python .\scripts\smoke_attendance_flow.py; Set-Location ..
Set-Location frontend; npm run smoke:routes; npm run build; Set-Location ..
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\publish\Service\Write-AgentProtectedToken.ps1 -Token 'v2:replace-with-issued-device-token' -Path 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json' -Scope LocalMachine -Force
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Set-AgentProductionConfig.ps1 -ConfigPath .\agent\publish\Service\appsettings.json -ApiBaseUrl 'https://monitoring-api.your-company.com' -ProtectedTokenPath 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json' -ClearApiToken
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-LauncherDisclosure.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-ScreenshotCaptureGuard.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentPublish.ps1 -PublishRoot .\agent\publish
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentPublish.ps1 -PublishRoot .\agent\publish -StrictProduction
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentRuntimeSmoke.ps1 -PublishRoot .\agent\publish -CleanupStartedProcesses
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentDeployment.ps1 -ServiceConfigPath .\agent\publish\Service\appsettings.json -HelperConfigPath .\agent\publish\SessionHelper\appsettings.json
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentDeployment.ps1 -ServiceConfigPath 'C:\Program Files\EmployeeBehaviorAgent\Service\appsettings.json' -HelperConfigPath 'C:\Program Files\EmployeeBehaviorAgent\SessionHelper\appsettings.json' -RequireInstalledHelperTask
```

If the installed service config needs the same production rewrite after deployment, rerun `Set-AgentProductionConfig.ps1` with `-ConfigPath 'C:\Program Files\EmployeeBehaviorAgent\Service\appsettings.json'`.

Strict production validation must fail on localhost API URLs, `DryRun=true`, missing protected token files, placeholder credentials, example config fallback, hidden tray configuration, console-only production helper mode, missing or uninspectable installed helper task, or incomplete launcher packaging. Runtime smoke validation must show the launcher opens without starting Service or SessionHelper before clock-in. Web console smoke validation must pass before demoing review queue, attendance, devices, screenshot detail, access roles, or GitHub risk screens.
