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
- `SessionHelperRequestTimeoutSeconds` must be long enough to cover multi-screen capture on slower endpoints.
- `UploadBatchSize` affects only upload concurrency, not collection semantics.

## Deployment references

- Operational runbook: [docs/AGENT_DEPLOYMENT_RUNBOOK.md](../docs/AGENT_DEPLOYMENT_RUNBOOK.md)
- Non-destructive validator: `agent\scripts\Test-AgentDeployment.ps1`

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
5. Test console session, locked desktop, and RDP/remote session transitions.

Recommended validation command before a pilot deployment:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agent\scripts\Test-AgentDeployment.ps1 `
  -ServiceConfigPath .\agent\src\EmployeeBehavior.Agent.Service\appsettings.json `
  -HelperConfigPath .\agent\src\EmployeeBehavior.Agent.SessionHelper\appsettings.json
```

If you only have the example files copied in-repo, point the script at the `.example` files instead.

## Verification focus

When validating on a Windows machine with the .NET SDK installed, check:

1. `IsRemoteSession`, `IsRdpSession`, `InputDesktopName`, `IdleSeconds`, and `SessionConnectState` change as expected across console, lock/unlock, and RDP transitions.
2. Keyboard, mouse move, mouse click, mouse wheel, and window switch counts reset only when a capture snapshot is consumed.
3. `SessionHelper` degrades safely when it is not running in the real interactive session.
4. Backend parsing accepts the nested heartbeat payloads and the mirrored compatibility fields during rollout.
