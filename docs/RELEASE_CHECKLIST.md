# Release Checklist

Run these checks before rollout:

```powershell
python -m compileall backend\app backend\tests
python -m pytest backend\tests -q
Set-Location backend; python .\scripts\smoke_attendance_flow.py; Set-Location ..
Set-Location frontend; npm run smoke:routes; npm run build; Set-Location ..
& "$env:USERPROFILE\.dotnet\dotnet.exe" build .\agent\EmployeeBehavior.Agent.sln -c Release --no-restore
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

Use `Set-AgentProductionConfig.ps1` after publish and before strict validation. It switches the service config to `DryRun=false`, writes the production `ApiBaseUrl`, points `ProtectedTokenPath` at the DPAPI token file, and can clear the plaintext `ApiToken` fallback with `-ClearApiToken`.

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
- Runtime smoke validation shows the launcher opens without starting Service or SessionHelper before clock-in.
- Local attendance smoke validation proves agent clock submission, admin attendance listing, anomaly classification, and review still work as one flow.
- Web console route smoke validation proves the review queue, attendance, devices, screenshot detail, GitHub risk, and access-role menus still have matching routes, permissions, pages, and API hooks.
- Screenshot capture guard validation prevents the invalid `SourceCopy | CaptureBlt` enum combination from returning.
- Screenshot retention cleanup is exercised with `POST /api/admin/screenshots/retention/cleanup` by a `screenshots.retention.manage` user, and the resulting `screenshots.retention.cleaned` audit log includes `job_id`, success counts, missing-file counts, and failure counts.
- Users launch `EmployeeBehavior.Agent.Launcher.exe`, not the service or session helper directly.
- Review queue, attendance, devices, screenshot activity summaries, GitHub risk, and access-role menus have been checked in the web console.
- Employee-facing disclosure states the collected data, purpose, retention, authorized viewers, and appeal channel before rollout; `Test-LauncherDisclosure.ps1` must pass.
