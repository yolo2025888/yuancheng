# Windows Agent Deployment Runbook

## Scope

This runbook covers the current C#/.NET Windows agent MVP on company-owned Windows devices only.

- The service remains non-interactive.
- The session helper runs in the signed-in user session.
- The agent records screenshots, session metadata, and aggregate input counts only.
- Do not add remote-control, stealth, raw keystroke, clipboard, webcam, or microphone features.

## Deployment model

The agent is split into two processes:

1. `EmployeeBehavior.Agent.Service`
   Runs as a Windows service and handles device identity, heartbeat, policy refresh, upload scheduling, and API calls.
2. `EmployeeBehavior.Agent.SessionHelper`
   Runs inside the interactive user session and captures screenshots, foreground window metadata, session state, and aggregate keyboard/mouse/window-switch counts.

If you also ship `EmployeeBehavior.Agent.Launcher.exe`, treat it as the employee-facing clock-in UI, not as the bootstrapper for these installed processes. In the publish/runtime smoke gate, opening the launcher must not start `EmployeeBehavior.Agent.Service` or `EmployeeBehavior.Agent.SessionHelper` before clock-in. In installed deployments, lifecycle ownership stays with the Windows service plus helper logon task, so clock-in records attendance and shows current background status instead of calling `Process.Start` on local copies.

Both processes must use the same named pipe value:

- `AgentService:SessionHelperPipeName`
- `SessionHelper:PipeName`

If the helper is not running in the real signed-in session, screenshots and input/session metadata can degrade to empty or zero values by design.

## Publish package and installer layout

The checked-in `agent\publish\` directory remains the validated payload surface. `agent\installer\` now builds the script-driven installer package from that payload.

```text
agent\publish\
  EmployeeBehavior.Agent.Launcher.exe
  Service\
    EmployeeBehavior.Agent.Service.exe
    appsettings.json
    Write-AgentProtectedToken.ps1
    Set-AgentProductionConfig.ps1
  SessionHelper\
    EmployeeBehavior.Agent.SessionHelper.exe
    appsettings.json
  Launcher\
    # nested launcher publish output used by package validation
```

- `EmployeeBehavior.Agent.Launcher.exe` is the package entry point.
- `Service\` and `SessionHelper\` are the source folders used by `Install-AgentPilot.ps1`.
- `Launcher\` is a nested copy of the launcher publish output. `Test-AgentPublish.ps1` treats it as a warning in pilot mode, but strict production validation fails if it is missing.
- `Install-AgentPilot.ps1` installs the service into `C:\Program Files\EmployeeBehaviorAgent\Service`, the helper into `C:\Program Files\EmployeeBehaviorAgent\SessionHelper`, and can install the launcher into `C:\Program Files\EmployeeBehaviorAgent\Launcher`.
- `agent\installer\Build-AgentInstallerPackage.ps1` assembles `agent\installer\artifacts\EmployeeBehavior.Agent.InstallerPackage\` and can also emit a zip archive for delivery.

## Prerequisites

Minimum operational prerequisites:

- Windows 10 or Windows 11 company-owned device
- Local administrator rights for service installation
- An interactive test user account for helper validation
- Network access from the device to the backend `ApiBaseUrl`
- TLS trust for the backend certificate chain

.NET prerequisites:

- Source-based local runs need the .NET 8 SDK.
- Framework-dependent publishes need the .NET 8 runtime, and the helper also needs the Windows desktop runtime because it uses Windows Forms.
- If the target device does not have the runtime installed, publish self-contained binaries instead of assuming `dotnet` is present.
- The install scripts in `agent\scripts\` deploy prebuilt artifacts and do not require a local .NET SDK on the target device.

## Recommended filesystem layout

The current code persists device identity, upload queue state, and built-in file logs under `ProgramData` by default. For pilot deployments, keep a simple and explicit layout:

```text
C:\Program Files\EmployeeBehaviorAgent\Service\
  EmployeeBehavior.Agent.Service.exe
  appsettings.json

C:\Program Files\EmployeeBehaviorAgent\SessionHelper\
  EmployeeBehavior.Agent.SessionHelper.exe
  appsettings.json

C:\ProgramData\EmployeeBehaviorAgent\
  device-id.json
  work-session-state.json
  upload-queue.jsonl
  upload-queue-payloads\
  logs\
    service.log
    helper.log
```

Log note:

- Both processes keep console logging and also append to built-in file logs by default.
- Default file paths:
  - `C:\ProgramData\EmployeeBehaviorAgent\logs\service.log`
  - `C:\ProgramData\EmployeeBehaviorAgent\logs\helper.log`
- Override either path with `Logging:File:Path` when the pilot needs a different persistent location.
- Do not claim Windows Event Log coverage yet; this change adds only a minimal file sink.

## Configuration checklist

### Service config

Start from `agent/src/EmployeeBehavior.Agent.Service/appsettings.json.example` and fill these fields:

- `ApiBaseUrl`
  Absolute backend base URL, for example `https://monitoring.internal.example`.
- `ProtectedTokenPath`
  Preferred path to a DPAPI-protected JSON token file, for example `C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json`. The service checks this file before `ApiToken`.
- `ApiToken`
  Dev fallback only. Use an issued device-scoped `v2:<device_id>:<secret>` bearer token from `POST /api/devices/{device_id}/agent-token` if you intentionally keep local plaintext or inject it with `AGENT_AgentService__ApiToken`. The plaintext token is returned once; the backend stores only a hash and can revoke that one device without affecting the fleet. Raw signing secrets and legacy `v1:` tokens are development/test compatibility paths only and are rejected by production backends.
- `DryRun`
  Keep `true` for initial validation. Switch to `false` only after local and backend checks pass.
- `EmployeeId`
  Optional employee binding for the pilot.
- `DeviceIdPath`
  Recommended: `C:\ProgramData\EmployeeBehaviorAgent\device-id.json`
- `WorkSessionStatePath`
  Recommended: `C:\ProgramData\EmployeeBehaviorAgent\work-session-state.json`. Launcher clock-in/out updates this shared state file, and the service uses it to pause monitoring before clock-in and after clock-out.
- `SessionHelperPipeName`
  Must match the helper pipe name exactly.
- `SessionHelperConnectTimeoutSeconds`
  Short connect timeout for helper availability.
- `SessionHelperRequestTimeoutSeconds`
  Must be long enough for multi-screen capture on slower devices.
- `HeartbeatIntervalSeconds`
  Current default is `30`.
- `PolicyRefreshIntervalSeconds`
  Current default is `300`.
- `UploadPollIntervalSeconds`
  Current default is `5`.
- `UploadBatchSize`
  Current default is `2`.
- `UploadQueuePath`
  Recommended: `C:\ProgramData\EmployeeBehaviorAgent\upload-queue.jsonl`
- `UploadQueueLeaseDurationSeconds`
  Lease expiry for in-flight queue items after service interruption. Current default is `300`.
- `DefaultPolicy`
  Bootstrap policy used before the backend returns a newer one.
- `Logging:File:Path`
  Optional full file path override. Leave it unset or keep the default to append to `C:\ProgramData\EmployeeBehaviorAgent\logs\service.log`.

Protected token provisioning:

- Helper script: `agent\publish\Service\Write-AgentProtectedToken.ps1`
- Direct EXE command: `agent\publish\Service\EmployeeBehavior.Agent.Service.exe --write-protected-token --token ... --path ... --scope ...`
- Recommended default for Windows service deployments: `-Scope LocalMachine`
- Use `-Scope CurrentUser` only when the same Windows user both writes and reads the token, and the service is not expected to decrypt it under another account.
- If the launcher must call backend endpoints too, grant that desktop user read access to the protected token file or keep launcher features on the dev fallback path.

Example:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\publish\Service\Write-AgentProtectedToken.ps1 `
  -Token 'v2:replace-with-issued-device-token' `
  -Path 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json' `
  -Scope LocalMachine
```

Equivalent direct EXE invocation:

```powershell
.\agent\publish\Service\EmployeeBehavior.Agent.Service.exe `
  --write-protected-token `
  --token 'v2:replace-with-issued-device-token' `
  --path 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json' `
  --scope LocalMachine
```

Equivalent PowerShell without the helper script:

```powershell
$path = 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json'
$token = 'v2:replace-with-issued-device-token'
$directory = Split-Path -Parent $path
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$protected = [System.Security.Cryptography.ProtectedData]::Protect(
  [System.Text.Encoding]::UTF8.GetBytes($token),
  $null,
  [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
[ordered]@{
  format = 'dpapi/v1'
  scope = 'LocalMachine'
  protectedToken = [Convert]::ToBase64String($protected)
} | ConvertTo-Json | Set-Content -LiteralPath $path -Encoding UTF8
```

### Session helper config

Start from `agent/src/EmployeeBehavior.Agent.SessionHelper/appsettings.json.example` and fill these fields:

- `PipeName`
  Must match `AgentService:SessionHelperPipeName`.
- `EnableTrayIcon`
  Keep `true` for installed and production deployments so employees have a visible session indicator. The deployment validator fails when this is `false` unless `DryRun=true` and `RunInConsole=true`.
- `RunInConsole`
  Set `true` only for operator-observed dry-runs. Do not use console-only visibility as a production replacement for the tray icon.
  Production installs must not pass `--console` through helper scheduled-task arguments or set `SESSION_HELPER_SessionHelper__RunInConsole=true`.
- `EnableInputActivityHooks`
  Leave `true` unless you intentionally want aggregate counts disabled.
- `EnableDesktopStateInspection`
  Leave `true` unless desktop inspection is blocked in the environment.
- `InputHookStartupTimeoutSeconds`
  Current default is `5`.
- `SampleLogIntervalSeconds`
  Liveness logging only. This does not change upload cadence and does not reset counters.
- `Logging:File:Path`
  Optional full file path override. Leave it unset or keep the default to append to `C:\ProgramData\EmployeeBehaviorAgent\logs\helper.log`.

## Build and package basics

Example framework-dependent publish commands:

```powershell
dotnet publish .\agent\src\EmployeeBehavior.Agent.Service\EmployeeBehavior.Agent.Service.csproj `
  -c Release -r win-x64 --self-contained false --output .\agent\publish\Service

dotnet publish .\agent\src\EmployeeBehavior.Agent.SessionHelper\EmployeeBehavior.Agent.SessionHelper.csproj `
  -c Release -r win-x64 --self-contained false --output .\agent\publish\SessionHelper

dotnet publish .\agent\src\EmployeeBehavior.Agent.Launcher\EmployeeBehavior.Agent.Launcher.csproj `
  -c Release -r win-x64 --self-contained false --output .\agent\publish\Launcher

Copy-Item -Path (Join-Path .\agent\publish\Launcher '*') -Destination .\agent\publish -Recurse -Force
```

If the target device does not already have the required runtime installed, publish self-contained packages for the service, helper, and launcher instead.

For pilot deployment, you can build or publish elsewhere, then copy the resulting artifact folders onto the target device and install them with the PowerShell scripts below.

Package validation should use the publish root before installation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentPublish.ps1 -PublishRoot .\agent\publish
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentRuntimeSmoke.ps1 -PublishRoot .\agent\publish -CleanupStartedProcesses
```

Installer package build and validation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\installer\Build-AgentInstallerPackage.ps1 -CreateZip
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentInstallerPackage.ps1 -RequireZip
```

The install and uninstall scripts work against the published service and helper folders:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Install-AgentPilot.ps1 `
  -ServiceSourceDirectory .\agent\publish\Service `
  -HelperSourceDirectory .\agent\publish\SessionHelper `
  -ServiceConfigPath .\agent\publish\Service\appsettings.json `
  -HelperConfigPath .\agent\publish\SessionHelper\appsettings.json `
  -HelperTaskUser CONTOSO\pilot.user `
  -StartService

powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Uninstall-AgentPilot.ps1
```

The packaged installer entry points wrap those same scripts with a fixed payload layout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\installer\artifacts\EmployeeBehavior.Agent.InstallerPackage\Install-AgentInstallerPackage.ps1 `
  -HelperTaskUser CONTOSO\pilot.user `
  -StartService

powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\installer\artifacts\EmployeeBehavior.Agent.InstallerPackage\Validate-AgentInstallerPackage.ps1 `
  -RequireInstalledHelperTask
```

Installed lifecycle smoke:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\installer\artifacts\EmployeeBehavior.Agent.InstallerPackage\tools\Test-AgentInstalledLifecycle.ps1 `
  -LauncherExecutablePath 'C:\Program Files\EmployeeBehaviorAgent\Launcher\EmployeeBehavior.Agent.Launcher.exe' `
  -EmployeeCode 'E-001'
```

## Dry-run validation flow

Use `DryRun=true` first. This validates local capture, named-pipe wiring, and contract shape without sending live heartbeat or screenshot payloads to the backend.

1. Copy both example config files into their real `appsettings.json` locations.
2. Set a shared pipe name in both files.
3. Set `DeviceIdPath` to a writable location under `C:\ProgramData`.
4. Either provision `ProtectedTokenPath` with the helper script above or set a dev fallback token with `AGENT_AgentService__ApiToken`.
5. Start the helper inside the signed-in desktop session:

```powershell
dotnet run --project .\agent\src\EmployeeBehavior.Agent.SessionHelper\EmployeeBehavior.Agent.SessionHelper.csproj -- --console
```

5. Start the service process in a second console:

```powershell
dotnet run --project .\agent\src\EmployeeBehavior.Agent.Service\EmployeeBehavior.Agent.Service.csproj
```

6. Confirm the service logs show:
   - `Agent service started for device ...`
   - `DryRun heartbeat to /api/agent/heartbeat ...`
   - `DryRun policy fetch from /api/agent/policy ...`
   - `DryRun screenshot upload ...`
7. Confirm the helper logs show:
   - `Session helper alive ...`
   - realistic desktop, lock, remote-session, and idle-state values
8. Lock and unlock the desktop, then test a remote session if the deployment supports RDP.

## Installed deployment flow

After dry-run passes:

1. Keep the same `device-id.json` path so the device identity remains stable across restarts and upgrades.
2. Switch `DryRun` to `false`.
3. Keep `SessionHelper:EnableTrayIcon=true` so the interactive helper remains visible to the signed-in employee. Do not set `SESSION_HELPER_SessionHelper__EnableTrayIcon=false` at process, user, or machine scope.
4. Copy the published service and helper artifacts onto the device.
5. Install `EmployeeBehavior.Agent.Service` as a Windows service and register the helper logon task with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Install-AgentPilot.ps1 `
  -ServiceSourceDirectory C:\staging\EmployeeBehaviorAgent\Service `
  -HelperSourceDirectory C:\staging\EmployeeBehaviorAgent\SessionHelper `
  -ServiceConfigPath C:\staging\configs\service.appsettings.json `
  -HelperConfigPath C:\staging\configs\helper.appsettings.json `
  -HelperTaskUser CONTOSO\pilot.user `
  -StartService
```

6. If the installer is being run by an admin on behalf of another user, set `-HelperTaskUser` explicitly to the pilot account instead of relying on the current user default.
7. If you keep service/task wrappers, stdout/stderr redirection is optional. The binaries now append to the recommended `logs\` directory by default unless `Logging:File:Path` overrides it.
8. Start the helper task or have the pilot user sign in so the logon trigger fires.
9. Run `Test-AgentDeployment.ps1` against the installed target directories with `-RequireInstalledHelperTask`, and confirm it does not report hidden tray, console-mode, environment override, missing helper task, missing `EmployeeBehavior.Agent.Service` registration, wrong service binary path, or scheduled-task argument failures. Also record the reported Windows service start mode and current state.
10. Validate the launcher lifecycle on the installed endpoint: opening the launcher still must not start new background processes before clock-in, and clock-in must record attendance while showing the current service/helper status instead of directly starting local background executables. Use `Test-AgentInstalledLifecycle.ps1` when the endpoint is fully installed.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentDeployment.ps1 `
  -ServiceConfigPath 'C:\Program Files\EmployeeBehaviorAgent\Service\appsettings.json' `
  -HelperConfigPath 'C:\Program Files\EmployeeBehaviorAgent\SessionHelper\appsettings.json' `
  -RequireInstalledHelperTask
```

11. Confirm backend reachability with `/health` and confirm the agent receives `200 OK` from:
   - `POST /api/agent/heartbeat`
   - `GET /api/agent/policy`
   - `POST /api/agent/screenshots/upload`
   All three requests must include a device-scoped `Authorization: Bearer v2:<device_id>:<secret>` token.
12. Restart the service once and confirm any queued screenshots retry from `UploadQueuePath`.

Helper task notes:

- The helper must not run in Session 0.
- `Install-AgentPilot.ps1` supports `-WhatIf` and `-Confirm`.
- The script preserves `device-id.json` and does not remove old data by default.

## Health checks

Run these checks before broad rollout and after every upgrade:

1. Configuration sanity:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentDeployment.ps1 `
  -ServiceConfigPath .\agent\src\EmployeeBehavior.Agent.Service\appsettings.json `
  -HelperConfigPath .\agent\src\EmployeeBehavior.Agent.SessionHelper\appsettings.json
```

For an already installed pilot or production endpoint, add `-RequireInstalledHelperTask` and point the config paths at the installed `Program Files` directories so the validation fails if the helper logon task cannot be inspected or is missing.

2. Backend secret and storage posture:
   - Production sets `EBM_ENVIRONMENT=production`.
   - Production sets non-default `EBM_AUTH_SECRET` and `EBM_AGENT_API_TOKEN`.
   - Screenshot files are not exposed through a public `/storage` mount; admin UI reads metadata with `screenshots.metadata.view`, while `/api/screenshots/{id}/image` and `/thumbnail` require `screenshots.image.view` plus an audited access reason.

3. Device identity:
   - `DeviceIdPath` parent directory exists and is writable by the service account.
   - `device-id.json` exists after first successful service start.
   - `WorkSessionStatePath` is shared with the launcher path expectation, or both are left on the default ProgramData location.
4. Upload queue:
   - `UploadQueuePath` parent directory exists and is writable by the service account.
   - `upload-queue.jsonl` appears when captures are queued and drains after successful uploads.
   - `upload-queue-payloads\` contains encrypted pending screenshot payload files while uploads are waiting.
   - Queue and payload files fail closed if Windows EFS protection cannot be applied.
5. API reachability:
   - `GET /health` responds from the configured backend host.
   - Service can reach the agent endpoints over the same base URL.
6. Capture path:
   - Helper is running in the real signed-in session.
   - Named pipe values match.
   - Dry-run uploads log realistic screen counts and metadata.
7. Retention enforcement:
   - A `screenshots.retention.manage` user runs `POST /api/admin/screenshots/retention/cleanup` after policy changes and on the production maintenance cadence.
   - The cleanup removes expired screenshot image and thumbnail files, clears only successfully handled image URIs, keeps metadata records for audit/trend continuity, and writes per-screenshot audit logs plus a `screenshots.retention.cleaned` summary audit log with `job_id`.
   - Any `files_missing` or `files_failed` count is an investigation signal, not a silent success.
   - After cleanup, expired screenshots must no longer return image or thumbnail content through `/api/screenshots/{id}/image` or `/thumbnail`.
8. Session behavior:
   - `is_locked` changes when the workstation is locked.
   - `is_remote_session` and `is_rdp_session` change as expected during remote access.
   - `idle_seconds` increases when no input is present.
9. Operational logging:
   - `service.log` and `helper.log` exist at the default ProgramData paths, or at the configured `Logging:File:Path` overrides.
   - If no files exist after startup, verify the configured file paths are writable and do not assume logs are preserved elsewhere.

## Upgrade and rollback

Current upgrade behavior is operator-driven. The code does not yet include a self-updater.

Upgrade basics:

1. Export or back up both `appsettings.json` files.
2. Preserve `C:\ProgramData\EmployeeBehaviorAgent\device-id.json`.
3. Preserve `C:\ProgramData\EmployeeBehaviorAgent\upload-queue.jsonl` if uploads are still pending.
4. Stop the Windows service.
5. Stop the helper task or log off the test user.
6. Replace binaries with the new published version, or rerun `Install-AgentPilot.ps1` against the new artifact directories.
7. Re-run `Test-AgentDeployment.ps1`.
8. Start the helper, then start the service.
9. Confirm dry-run or live heartbeat/upload logs before widening rollout.

Rollback basics:

1. Stop the service and helper.
2. Restore the previous binary set and previous config files.
3. Keep the same `device-id.json` and `upload-queue.jsonl` unless the rollback plan explicitly requires queue or identity reset.
4. Re-run the health checks.
5. Restart helper and service.

If you need to unregister the pilot installation without deleting identity data or binaries, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Uninstall-AgentPilot.ps1
```

Optional destructive cleanup is explicit through `-RemoveServiceDirectory`, `-RemoveHelperDirectory`, `-RemoveLogDirectory`, `-RemoveUploadQueue`, and `-RemoveDeviceIdentity`. `-RemoveUploadQueue` removes both `upload-queue.jsonl` and `upload-queue-payloads\` so queued screenshot payloads do not remain after rollback.

## Known current limitations

- No Windows Event Log sink is wired yet.
- The current installer path is script-driven through `agent\installer\`. A dedicated MSI/MSIX project is not checked in yet.
- No self-updater is present yet.
- The upload queue is durable across restarts, but it is still a local JSONL file intended for one service instance per device.
- If operators delete only selected queue payload files referenced by queued entries, pending uploads can still be lost.
- Queue growth is bounded only by local disk availability while the backend is unavailable.

## Operator handoff notes

- Keep deployment limited to company-owned devices and authorized pilot users.
- Do not expand the agent to remote-control or covert-monitoring behavior.
- Treat dry-run as mandatory before switching a new environment to `DryRun=false`.
