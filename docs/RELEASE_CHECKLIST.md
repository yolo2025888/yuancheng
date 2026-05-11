# Release Checklist

Run these checks before rollout:

```powershell
python -m compileall backend\app backend\tests
python -m pytest backend\tests -q
Set-Location frontend; npm run build
& "$env:USERPROFILE\.dotnet\dotnet.exe" build .\agent\EmployeeBehavior.Agent.sln -c Release --no-restore
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentPublish.ps1 -PublishRoot .\agent\publish
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentPublish.ps1 -PublishRoot .\agent\publish -StrictProduction
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentDeployment.ps1 -ServiceConfigPath .\agent\publish\Service\appsettings.json -HelperConfigPath .\agent\publish\SessionHelper\appsettings.json
```

Production gates:

- `ApiBaseUrl` is the production API URL.
- `DryRun` is `false`.
- `ProtectedTokenPath` points to an existing DPAPI token file.
- Device tokens use issued v2 device-scoped tokens.
- `SessionHelper.EnableTrayIcon` is `true`.
- `SessionHelper.RunInConsole` is `false`.
- No process/user/machine environment override sets `SESSION_HELPER_SessionHelper__EnableTrayIcon=false`.
- No process/user/machine environment override sets `SESSION_HELPER_SessionHelper__RunInConsole=true`.
- The installed helper scheduled task does not include `--console`.
- Strict production validation uses real `appsettings.json`; example config fallback must fail.
- Users launch `EmployeeBehavior.Agent.Launcher.exe`, not the service or session helper directly.
- Review queue, attendance, devices, screenshot activity summaries, and GitHub risk menus have been checked in the web console.
- Employee-facing disclosure states the collected data, purpose, retention, authorized viewers, and appeal channel before rollout.
