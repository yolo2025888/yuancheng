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
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentDeployment.ps1 -ServiceConfigPath 'C:\Program Files\EmployeeBehaviorAgent\Service\appsettings.json' -HelperConfigPath 'C:\Program Files\EmployeeBehaviorAgent\SessionHelper\appsettings.json' -RequireInstalledHelperTask
```

Run the GitHub Actions `Security Audit` workflow before promoting a release candidate. It performs backend Python, frontend npm, and agent .NET dependency audits separately from ordinary PR CI.

Production gates:

- `ApiBaseUrl` is the production API URL.
- `DryRun` is `false`.
- `ProtectedTokenPath` points to an existing DPAPI token file.
- Device tokens use issued v2 device-scoped tokens.
- `SessionHelper.EnableTrayIcon` is `true`.
- `SessionHelper.RunInConsole` is `false`.
- No process/user/machine environment override sets `SESSION_HELPER_SessionHelper__EnableTrayIcon=false`.
- No process/user/machine environment override sets `SESSION_HELPER_SessionHelper__RunInConsole=true`.
- Installed deployment validation uses `-RequireInstalledHelperTask`.
- The installed helper scheduled task exists and can be inspected by `Test-AgentDeployment.ps1`.
- The installed helper scheduled task does not include `--console`.
- Strict production validation uses real `appsettings.json`; example config fallback must fail.
- Screenshot retention cleanup is exercised with `POST /api/admin/screenshots/retention/cleanup` by a `screenshots.retention.manage` user, and the resulting `screenshots.retention.cleaned` audit log includes `job_id`, success counts, missing-file counts, and failure counts.
- Users launch `EmployeeBehavior.Agent.Launcher.exe`, not the service or session helper directly.
- Review queue, attendance, devices, screenshot activity summaries, and GitHub risk menus have been checked in the web console.
- Employee-facing disclosure states the collected data, purpose, retention, authorized viewers, and appeal channel before rollout.
