# Operations and Demo Guide

Open `agent\publish\EmployeeBehavior.Agent.Launcher.exe` for the Windows client. The launcher shows the punch clock UI; the approved service and session helper start only after the employee clocks in:

- `EmployeeBehavior.Agent.Service.exe` handles API calls, heartbeats, uploads, token auth, and attendance submission.
- `EmployeeBehavior.Agent.SessionHelper.exe` runs in the interactive user session for screenshots and input/session activity capture.

Before a pilot or production demo, confirm the employee-facing disclosure covers full multi-display screenshots, active window title, process name/path, session/lock/RDP/idle metadata, aggregate input counts, purpose, access roles, retention, and appeal channel.

Provision production tokens with a DPAPI protected token file, then validate the publish package and deployment config:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentPublish.ps1 -PublishRoot .\agent\publish
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentPublish.ps1 -PublishRoot .\agent\publish -StrictProduction
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentDeployment.ps1 -ServiceConfigPath .\agent\publish\Service\appsettings.json -HelperConfigPath .\agent\publish\SessionHelper\appsettings.json
```

Strict production validation must fail on localhost API URLs, `DryRun=true`, missing protected token files, placeholder credentials, example config fallback, hidden tray configuration, console-only production helper mode, or incomplete launcher packaging.
