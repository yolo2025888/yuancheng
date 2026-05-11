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

Both processes must use the same named pipe value:

- `AgentService:SessionHelperPipeName`
- `SessionHelper:PipeName`

If the helper is not running in the real signed-in session, screenshots and input/session metadata can degrade to empty or zero values by design.

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

The current code hard-codes only the device identity path. It does not yet write its own Event Log or file sink entries. For pilot deployments, keep a simple and explicit layout:

```text
C:\Program Files\EmployeeBehaviorAgent\Service\
  EmployeeBehavior.Agent.Service.exe
  appsettings.json

C:\Program Files\EmployeeBehaviorAgent\SessionHelper\
  EmployeeBehavior.Agent.SessionHelper.exe
  appsettings.json

C:\ProgramData\EmployeeBehaviorAgent\
  device-id.json
  upload-queue.jsonl
  upload-queue-payloads\
  logs\
    service.log
    helper.log
```

Log note:

- The current code configures console logging only.
- During local dry-run, logs appear in the console window.
- For installed pilots, use your service/task wrapper or installer to redirect stdout/stderr into `C:\ProgramData\EmployeeBehaviorAgent\logs\`.
- Do not claim Windows Event Log coverage yet; the code has a TODO for future Event Log or file sink wiring.

## Configuration checklist

### Service config

Start from `agent/src/EmployeeBehavior.Agent.Service/appsettings.json.example` and fill these fields:

- `ApiBaseUrl`
  Absolute backend base URL, for example `https://monitoring.internal.example`.
- `ApiToken`
  Service deployments use the backend agent signing secret and derive device-scoped bearer tokens locally. Launcher-only deployments may use a pre-issued device-scoped `v1:<device_id>:<signature>` token. Production backends reject the raw signing secret itself.
- `DryRun`
  Keep `true` for initial validation. Switch to `false` only after local and backend checks pass.
- `EmployeeId`
  Optional employee binding for the pilot.
- `DeviceIdPath`
  Recommended: `C:\ProgramData\EmployeeBehaviorAgent\device-id.json`
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

### Session helper config

Start from `agent/src/EmployeeBehavior.Agent.SessionHelper/appsettings.json.example` and fill these fields:

- `PipeName`
  Must match `AgentService:SessionHelperPipeName`.
- `EnableTrayIcon`
  Useful for interactive pilot validation.
- `RunInConsole`
  Set `true` for operator-observed dry-runs if you do not want the tray icon.
- `EnableInputActivityHooks`
  Leave `true` unless you intentionally want aggregate counts disabled.
- `EnableDesktopStateInspection`
  Leave `true` unless desktop inspection is blocked in the environment.
- `InputHookStartupTimeoutSeconds`
  Current default is `5`.
- `SampleLogIntervalSeconds`
  Liveness logging only. This does not change upload cadence and does not reset counters.

## Build and package basics

Example framework-dependent publish commands:

```powershell
dotnet publish .\agent\src\EmployeeBehavior.Agent.Service\EmployeeBehavior.Agent.Service.csproj `
  -c Release -r win-x64 --self-contained false

dotnet publish .\agent\src\EmployeeBehavior.Agent.SessionHelper\EmployeeBehavior.Agent.SessionHelper.csproj `
  -c Release -r win-x64 --self-contained false
```

If the target device does not already have the required runtime installed, publish self-contained packages for both projects instead.

For pilot deployment, you can build or publish elsewhere, then copy the resulting artifact folders onto the target device and install them with the PowerShell scripts below.

## Dry-run validation flow

Use `DryRun=true` first. This validates local capture, named-pipe wiring, and contract shape without sending live heartbeat or screenshot payloads to the backend.

1. Copy both example config files into their real `appsettings.json` locations.
2. Set a shared pipe name in both files.
3. Set `DeviceIdPath` to a writable location under `C:\ProgramData`.
4. Start the helper inside the signed-in desktop session:

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
3. Copy the published service and helper artifacts onto the device.
4. Install `EmployeeBehavior.Agent.Service` as a Windows service and register the helper logon task with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Install-AgentPilot.ps1 `
  -ServiceSourceDirectory C:\staging\EmployeeBehaviorAgent\Service `
  -HelperSourceDirectory C:\staging\EmployeeBehaviorAgent\SessionHelper `
  -ServiceConfigPath C:\staging\configs\service.appsettings.json `
  -HelperConfigPath C:\staging\configs\helper.appsettings.json `
  -HelperTaskUser CONTOSO\pilot.user `
  -StartService
```

5. If the installer is being run by an admin on behalf of another user, set `-HelperTaskUser` explicitly to the pilot account instead of relying on the current user default.
6. Redirect both process outputs to the recommended `logs\` directory during pilot rollout if you wrap the binaries. The current code still emits console logging only.
7. Start the helper task or have the pilot user sign in so the logon trigger fires.
8. Confirm backend reachability with `/health` and confirm the agent receives `200 OK` from:
   - `POST /api/agent/heartbeat`
   - `GET /api/agent/policy`
   - `POST /api/agent/screenshots/upload`
   All three requests must include a device-scoped `Authorization: Bearer v1:<device_id>:<signature>` token.
9. Restart the service once and confirm any queued screenshots retry from `UploadQueuePath`.

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

2. Backend secret and storage posture:
   - Production sets `EBM_ENVIRONMENT=production`.
   - Production sets non-default `EBM_AUTH_SECRET` and `EBM_AGENT_API_TOKEN`.
   - Screenshot files are not exposed through a public `/storage` mount; admin UI reads them through `/api/screenshots/{id}/image` or `/thumbnail` with `screenshots.view`.

3. Device identity:
   - `DeviceIdPath` parent directory exists and is writable by the service account.
   - `device-id.json` exists after first successful service start.
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
7. Session behavior:
   - `is_locked` changes when the workstation is locked.
   - `is_remote_session` and `is_rdp_session` change as expected during remote access.
   - `idle_seconds` increases when no input is present.
8. Operational logging:
   - `service.log` and `helper.log` exist if your wrapper redirects stdout/stderr.
   - If no files exist, do not assume logs are preserved elsewhere.

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

Optional destructive cleanup is explicit through `-RemoveServiceDirectory`, `-RemoveHelperDirectory`, `-RemoveLogDirectory`, `-RemoveUploadQueue`, and `-RemoveDeviceIdentity`.

## Known current limitations

- No built-in file sink or Windows Event Log sink is wired yet.
- No installer project is present in this repository yet.
- No self-updater is present yet.
- The upload queue is durable across restarts, but it is still a local JSONL file intended for one service instance per device.
- If operators delete the queue file or any future temp payload files referenced by queued entries, pending uploads can still be lost.
- Queue growth is bounded only by local disk availability while the backend is unavailable.

## Operator handoff notes

- Keep deployment limited to company-owned devices and authorized pilot users.
- Do not expand the agent to remote-control or covert-monitoring behavior.
- Treat dry-run as mandatory before switching a new environment to `DryRun=false`.
