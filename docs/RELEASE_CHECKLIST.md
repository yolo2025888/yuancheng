# Release Checklist

Run these checks before rollout:

Regenerate `agent\publish` immediately before these commands or use the matching CI artifact. The directory is ignored generated output, so a stale local copy is not release evidence.

Launcher lifecycle release evidence comes from the repo smoke scripts under `agent\scripts\`, especially `Test-AgentRuntimeSmoke.ps1`. Do not rely on older packaged script copies that still describe launcher-startup monitoring.

```powershell
python -m compileall backend\app backend\tests
python -m pytest backend\tests -q
Set-Location backend; python .\scripts\smoke_attendance_flow.py; Set-Location ..
Set-Location frontend; npm run smoke:routes; npm run build; Set-Location ..
& "$env:USERPROFILE\.dotnet\dotnet.exe" build .\agent\EmployeeBehavior.Agent.sln -c Release --no-restore
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentPublish.ps1 -PublishRoot .\agent\publish
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentRuntimeSmoke.ps1 -PublishRoot .\agent\publish -CleanupStartedProcesses
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\installer\Build-AgentInstallerPackage.ps1 -CreateZip
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentInstallerPackage.ps1 -RequireZip
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Install-AgentPilot.ps1 -ServiceSourceDirectory .\agent\publish\Service -HelperSourceDirectory .\agent\publish\SessionHelper -ServiceConfigPath .\agent\publish\Service\appsettings.json -HelperConfigPath .\agent\publish\SessionHelper\appsettings.json -HelperTaskUser CONTOSO\pilot.user -StartService
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Uninstall-AgentPilot.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\publish\Service\Write-AgentProtectedToken.ps1 -Token 'v2:replace-with-issued-device-token' -Path 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json' -Scope LocalMachine -Force
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Set-AgentProductionConfig.ps1 -ConfigPath .\agent\publish\Service\appsettings.json -ApiBaseUrl 'https://monitoring-api.your-company.com' -ProtectedTokenPath 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json' -ClearApiToken
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-LauncherDisclosure.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-ScreenshotCaptureGuard.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentPublish.ps1 -PublishRoot .\agent\publish -StrictProduction
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentDeployment.ps1 -ServiceConfigPath .\agent\publish\Service\appsettings.json -HelperConfigPath .\agent\publish\SessionHelper\appsettings.json
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentDeployment.ps1 -ServiceConfigPath 'C:\Program Files\EmployeeBehaviorAgent\Service\appsettings.json' -HelperConfigPath 'C:\Program Files\EmployeeBehaviorAgent\SessionHelper\appsettings.json' -RequireInstalledHelperTask
```

Use `Set-AgentProductionConfig.ps1` after publish and before strict validation. It switches the service config to `DryRun=false`, writes the production `ApiBaseUrl`, points `ProtectedTokenPath` at the DPAPI token file, and can clear the plaintext `ApiToken` fallback with `-ClearApiToken`.

Run the GitHub Actions `Security Audit` workflow before promoting a release candidate. It performs backend Python, frontend npm, and agent .NET dependency audits separately from ordinary PR CI.

Production gates:

- `ApiBaseUrl` is the production API URL.
- `DryRun` is `false`.
- `ProtectedTokenPath` points to an existing DPAPI token file.
- The publish package root validates with `Test-AgentPublish.ps1`.
- The installer package project builds from `agent\publish` and validates with `Test-AgentInstallerPackage.ps1`.
- Strict production validation expects the nested `Launcher\` publish output to be present.
- The launcher opens from `agent\publish\EmployeeBehavior.Agent.Launcher.exe`, not from the installed service or helper directories.
- `WorkSessionStatePath` is either left at the default ProgramData location or explicitly aligned with the launcher on the same machine.
- `Logging:File:Path` is either left at the default ProgramData location or overridden to another writable persistent file path for both service and helper.
- Device tokens use issued v2 device-scoped tokens.
- `SessionHelper.EnableTrayIcon` is `true`.
- `SessionHelper.RunInConsole` is `false`.
- No process/user/machine environment override sets `SESSION_HELPER_SessionHelper__EnableTrayIcon=false`.
- No process/user/machine environment override sets `SESSION_HELPER_SessionHelper__RunInConsole=true`.
- Installed deployment validation uses `-RequireInstalledHelperTask`.
- The installed Windows service `EmployeeBehavior.Agent.Service` exists and is reported by `Test-AgentDeployment.ps1`.
- The installed Windows service binary path resolves to `EmployeeBehavior.Agent.Service.exe`.
- Installed deployment validation reports the Windows service start mode and current state.
- The installed helper scheduled task exists and can be inspected by `Test-AgentDeployment.ps1`.
- The installed helper scheduled task does not include `--console`.
- Runtime smoke or pilot validation confirms the expected log files are created at the default ProgramData paths or the configured `Logging:File:Path` overrides.
- `Test-AgentDeployment.ps1` only passes API reachability when `GET /health` returns a 2xx response.
- Installed endpoints can pass `Test-AgentInstalledLifecycle.ps1` against the installed launcher path.
- Strict production validation uses real `appsettings.json`; example config fallback must fail.
- Runtime smoke validation shows the launcher opens without starting Service or SessionHelper before clock-in.
- Installed lifecycle validation confirms clock-in on a service/task-managed endpoint records attendance and shows current background status without directly starting local Service or SessionHelper executables.
- Local attendance smoke validation proves agent clock submission, admin attendance listing, anomaly classification, and review still work as one flow.
- Web console route smoke validation proves the review queue, attendance, devices, screenshot detail, GitHub risk, and access-role menus still have matching routes, permissions, pages, and API hooks.
- Screenshot capture guard validation prevents the invalid `SourceCopy | CaptureBlt` enum combination from returning.
- Screenshot retention cleanup is exercised with `POST /api/admin/screenshots/retention/cleanup` by a `screenshots.retention.manage` user, and the resulting `screenshots.retention.cleaned` audit log includes `job_id`, success counts, missing-file counts, and failure counts.
- Users launch `EmployeeBehavior.Agent.Launcher.exe` for the punch clock UI, not the service or session helper directly.
- Opening the launcher alone is not release-approved evidence of monitoring start; clock-in is the lifecycle boundary for launcher-driven monitoring, and installed endpoints keep lifecycle control with the Windows service plus helper task.
- Review queue, attendance, devices, screenshot activity summaries, GitHub risk, and access-role menus have been checked in the web console.
- Employee-facing disclosure states the collected data, purpose, retention, authorized viewers, and appeal channel before rollout; `Test-LauncherDisclosure.ps1` must pass.
