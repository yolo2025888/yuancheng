# Windows Agent Skeleton

`agent/` contains the Windows-side MVP split into a non-interactive service and an interactive session helper.

- `EmployeeBehavior.Agent.Service` runs as the Windows service. It handles heartbeat, policy refresh, screenshot upload, and backend communication.
- `EmployeeBehavior.Agent.SessionHelper` runs inside the signed-in user session. It captures screenshots, foreground window metadata, session state, and aggregate input counts, then returns a single snapshot to the service over a named pipe.

## Directory layout

```text
agent/
+-- EmployeeBehavior.Agent.sln
+-- Directory.Build.props
+-- src/
    +-- EmployeeBehavior.Agent.Contracts/
    +-- EmployeeBehavior.Agent.Service/
    +-- EmployeeBehavior.Agent.SessionHelper/
```

## Telemetry contract

The helper only reports aggregate counts and session metadata. No raw keystrokes, clipboard data, webcam, microphone, or private-content capture may be added to this contract.

Heartbeat JSON keeps the nested payloads and also mirrors the transition-critical fields at the top level for backend compatibility:

- `session_state.is_remote_session` and top-level `is_remote_session`
- `session_state.is_rdp_session` and top-level `is_rdp_session`
- `session_state.idle_seconds` and top-level `idle_seconds`
- `session_state.input_desktop_name` and top-level `input_desktop_name`
- `session_state.session_connect_state` and top-level `session_connect_state`
- `input_activity.mouse_wheel_count` and top-level `mouse_wheel_count`
- `input_activity.window_switch_count` and top-level `window_switch_count`

Screenshot upload form fields use the backend snake_case names directly:

- `keyboard_count`
- `mouse_click_count`
- `mouse_move_count`
- `mouse_wheel_count`
- `window_switch_count`
- `is_locked`
- `is_remote_session`
- `is_rdp_session`
- `idle_seconds`
- `input_desktop_name`
- `session_connect_state`

The screenshot upload contract still uses the legacy `phash` field name. In the current MVP, the agent sends the screenshot SHA-256 digest there as a compatibility fallback; it is not yet a perceptual hash.

## Current capture scope

- Multi-screen screenshots captured from `Screen.AllScreens`
- Foreground window process name, executable path, and title
- Session state derived from `Environment.SessionId`, WTS session info, `GetLastInputInfo`, and input desktop inspection
- Aggregate input activity only:
  - `WH_KEYBOARD_LL` counts key-down events
  - `WH_MOUSE_LL` counts mouse move, click, and wheel events
  - `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` counts foreground window switches

## Privacy boundary

- Store and transmit counts only, never raw input payloads.
- Hook callbacks must not persist virtual key codes, translated characters, scan codes, clipboard text, pointer coordinates, or screenshots beyond the configured capture pipeline.
- `SessionHelper` may inspect whether the active desktop is `Default` versus a secure desktop, but it must not read secure desktop contents.
- `Service` must stay non-interactive. It gets one helper snapshot and uploads that snapshot; it does not access the interactive desktop directly.

## Interactive-session helper expectations

- `SessionHelper` must be launched in the real interactive user session. If it runs outside that session, screenshot capture, desktop name, and aggregate input counters may legitimately degrade to empty or zero values.
- `AgentService` and `SessionHelper` must use the same pipe name:
  - `SessionHelper:PipeName`
  - `AgentService:SessionHelperPipeName`
- `SessionHelperMonitor` is a liveness logger only. It must not consume `IInputActivityCounter` snapshots because reading that counter resets the aggregate window.

## Configuration

Copy the example settings first:

```powershell
Copy-Item .\agent\src\EmployeeBehavior.Agent.SessionHelper\appsettings.json.example .\agent\src\EmployeeBehavior.Agent.SessionHelper\appsettings.json
Copy-Item .\agent\src\EmployeeBehavior.Agent.Service\appsettings.json.example .\agent\src\EmployeeBehavior.Agent.Service\appsettings.json
```

`SessionHelper` toggles:

- `EnableTrayIcon`
  - Default `true`
  - Must remain `true` for installed and production deployments so the signed-in employee has a visible session indicator
- `RunInConsole`
  - Default `false`
  - Use `true` only for operator-observed `DryRun=true` validation; console visibility is not a production replacement for the tray icon
  - Do not pass `--console` in installed scheduled-task arguments, and do not use `SESSION_HELPER_` environment overrides to hide the tray indicator in production
- `EnableInputActivityHooks`
  - Default `true`
  - Disables keyboard, mouse, and foreground-switch counters when set to `false`
- `EnableDesktopStateInspection`
  - Default `true`
  - Disables `OpenInputDesktop` inspection when set to `false`, which leaves `InputDesktopName` empty and removes desktop-based lock-state hints
- `InputHookStartupTimeoutSeconds`
  - Default `5`
  - Maximum wait for low-level hook startup before the helper continues in degraded mode
- `SampleLogIntervalSeconds`
  - Default `60`
  - Controls liveness logging only; it does not change upload cadence or counter reset timing

`AgentService` notes:

- Keep `DryRun=true` for local contract verification before pointing at a real backend.
- When `DryRun=false`, the service now fails at startup unless `ApiBaseUrl` is HTTPS and not a localhost/reserved example host, and unless either `ProtectedTokenPath` or a plaintext `v2:` `ApiToken` is configured.
- `ProtectedTokenPath` is checked before `ApiToken`. Point it at a DPAPI-protected JSON file created by `agent\publish\Service\Write-AgentProtectedToken.ps1`, `EmployeeBehavior.Agent.Service.exe --write-protected-token`, or an equivalent PowerShell command.
- `ApiToken` should be an issued device-scoped `v2:<device_id>:<secret>` bearer token when you use the dev fallback path. If the value starts with `v2:`, the service uses it directly as `Authorization: Bearer ...`.
- A raw backend signing secret and legacy `v1:<device_id>:<signature>` tokens are development/test compatibility paths only; production backends reject both.
- The launcher now reads the same `ProtectedTokenPath` first and falls back to `ApiToken`, so launcher-backed attendance/profile calls can use the same protected token file when the desktop user has read access to it.
- Use `LocalMachine` scope for the common Windows service deployment path. Use `CurrentUser` only when the agent runs entirely under one Windows identity and you do not need cross-account decryption.
- `SessionHelperRequestTimeoutSeconds` must be long enough to cover multi-screen capture on slower endpoints.
- `UploadBatchSize` affects only upload concurrency, not collection semantics.

Protected token write example:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\publish\Service\Write-AgentProtectedToken.ps1 `
  -Token 'v2:replace-with-issued-device-token' `
  -Path 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json' `
  -Scope LocalMachine
```

Direct EXE invocation:

```powershell
.\agent\publish\Service\EmployeeBehavior.Agent.Service.exe `
  --write-protected-token `
  --token 'v2:replace-with-issued-device-token' `
  --path 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json' `
  --scope LocalMachine
```

PowerShell-only fallback if you do not want to ship the helper script:

```powershell
$path = 'C:\ProgramData\EmployeeBehaviorAgent\secrets\agent-token.protected.json'
$token = 'v2:replace-with-issued-device-token'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($token)
$protected = [System.Security.Cryptography.ProtectedData]::Protect(
  $bytes,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
@{
  format = 'dpapi/v1'
  scope = 'LocalMachine'
  protectedToken = [Convert]::ToBase64String($protected)
} | ConvertTo-Json | Set-Content -LiteralPath $path -Encoding UTF8
```

## Deployment references

- Operational runbook: [docs/AGENT_DEPLOYMENT_RUNBOOK.md](../docs/AGENT_DEPLOYMENT_RUNBOOK.md)
- Install script: `agent\scripts\Install-AgentPilot.ps1`
- Uninstall script: `agent\scripts\Uninstall-AgentPilot.ps1`
- Non-destructive validator: `agent\scripts\Test-AgentDeployment.ps1`

## Pilot install without local dotnet build

The repo now includes Windows install/uninstall scripts intended for prebuilt publish artifacts. The target device does not need a local .NET SDK if you copy a published service folder and a published helper folder onto the machine first.

Typical pilot install from an elevated PowerShell session:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Install-AgentPilot.ps1 `
  -ServiceSourceDirectory C:\staging\EmployeeBehaviorAgent\Service `
  -HelperSourceDirectory C:\staging\EmployeeBehaviorAgent\SessionHelper `
  -ServiceConfigPath C:\staging\configs\service.appsettings.json `
  -HelperConfigPath C:\staging\configs\helper.appsettings.json `
  -HelperTaskUser CONTOSO\pilot.user `
  -StartService
```

Safe install behavior:

- Requires elevation and validates the expected EXE paths before changing service/task state.
- Creates the target install directories plus `C:\ProgramData\EmployeeBehaviorAgent\` and `logs\`.
- Preserves an existing `device-id.json`.
- Preserves an existing target `appsettings.json` unless you pass an explicit replacement config path.
- Supports `-WhatIf` and `-Confirm`.

Typical uninstall that removes registrations but keeps binaries and identity data:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Uninstall-AgentPilot.ps1
```

Optional cleanup switches are explicit: `-RemoveServiceDirectory`, `-RemoveHelperDirectory`, `-RemoveLogDirectory`, `-RemoveUploadQueue`, and `-RemoveDeviceIdentity`. `-RemoveUploadQueue` removes both `upload-queue.jsonl` and the sibling `upload-queue-payloads\` directory.

## Upload queue persistence

`AgentService` now uses a file-backed JSONL upload queue instead of the old process-memory queue.

- Default path: `AgentService:UploadQueuePath = C:\ProgramData\EmployeeBehaviorAgent\upload-queue.jsonl`
- Screenshot bytes are copied into protected payload files under a sibling `upload-queue-payloads\` directory; the JSONL queue stores metadata and protected payload paths, not raw screenshot byte arrays.
- Pending screenshot uploads survive service restarts and most transient API failures.
- The queue uses short-lived leases so items that were in-flight during a crash become eligible for retry after `AgentService:UploadQueueLeaseDurationSeconds`.
- The upload loop now logs and retries transient failures instead of exiting the whole service on the first failed upload attempt.
- On Windows, the queue and payload files are created encrypted before content is written. If Windows EFS protection fails, enqueue fails closed instead of writing live screenshot payloads in plaintext.
- Pilot installers should still restrict ACLs on `C:\ProgramData\EmployeeBehaviorAgent\` to administrators and the service identity.
- Temp screenshot payload files are deleted only after a successful upload so transient backend failures do not drop queued screenshots.
- Malformed JSONL entries are skipped with a warning instead of blocking the whole queue.

Current limitations:

- The queue is designed for a single service instance per device and is not a shared multi-writer store.
- The JSONL file can grow while the backend is unavailable.
- If operators manually delete the queue file, `device-id.json`, or payload files referenced by queued items, pending uploads can still be lost.

## Local run and deployment checks

For local development, start the helper first and then the service:

```powershell
dotnet run --project .\agent\src\EmployeeBehavior.Agent.SessionHelper\EmployeeBehavior.Agent.SessionHelper.csproj -- --console
dotnet run --project .\agent\src\EmployeeBehavior.Agent.Service\EmployeeBehavior.Agent.Service.csproj
```

Recommended deployment and validation sequence:

1. Copy both example config files and set a shared pipe name.
2. Run the helper in the signed-in desktop session.
3. Keep `DryRun=true` and confirm heartbeat plus screenshot upload logs show the expected contract fields without backend dependency.
4. Switch `DryRun=false`, point `ApiBaseUrl` at the target backend, and repeat heartbeat plus upload checks.
5. Restart the service once during validation and confirm pending uploads are retried from `UploadQueuePath`.
6. Test console session, locked desktop, and RDP/remote session transitions.

Recommended validation command before a pilot deployment:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentDeployment.ps1 `
  -ServiceConfigPath .\agent\src\EmployeeBehavior.Agent.Service\appsettings.json `
  -HelperConfigPath .\agent\src\EmployeeBehavior.Agent.SessionHelper\appsettings.json
```

If you only have the example files copied in-repo, point the script at the `.example` files instead.
After installing a pilot or production endpoint, run the same script against the installed `Program Files` config files with `-RequireInstalledHelperTask` so missing or uninspectable helper logon tasks fail the validation.

## Verification focus

When validating on a Windows machine with the .NET SDK installed, check:

1. `IsRemoteSession`, `IsRdpSession`, `InputDesktopName`, `IdleSeconds`, and `SessionConnectState` change as expected across console, lock/unlock, and RDP transitions.
2. Keyboard, mouse move, mouse click, mouse wheel, and window switch counts reset only when a capture snapshot is consumed.
3. `SessionHelper` degrades safely when it is not running in the real interactive session.
4. Backend parsing accepts the nested heartbeat payloads and the mirrored compatibility fields during rollout.
5. Pending uploads remain queued across service restart until the backend accepts them.
