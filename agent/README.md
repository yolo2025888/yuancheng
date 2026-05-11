# Windows Agent Skeleton

该目录包含 Windows Agent 的 MVP-1 代码，采用 `Windows Service + User Session Helper` 双进程拆分。

## 结构

```text
agent/
├─ EmployeeBehavior.Agent.sln
├─ Directory.Build.props
└─ src/
   ├─ EmployeeBehavior.Agent.Contracts/
   ├─ EmployeeBehavior.Agent.Service/
   └─ EmployeeBehavior.Agent.SessionHelper/
```

## 项目说明

- `EmployeeBehavior.Agent.Contracts`
  - Service、Session Helper 和上传链路共享的数据契约。
  - `CapturedScreen` / `ScreenshotUploadRequest` 已支持主图字节、缩略图字节、可选临时文件路径、hash、尺寸和宽高元数据。
- `EmployeeBehavior.Agent.Service`
  - Windows Service / Worker 入口。
  - 通过 Named Pipe 请求 Session Helper 执行 `capture-session`，将截图 payload 放入上传队列，再调用现有 API client 占位。
- `EmployeeBehavior.Agent.SessionHelper`
  - 用户会话侧进程。
  - 使用 Windows GDI 真实抓取多屏截图，输出 PNG 主图和 JPEG 缩略图。
  - 暴露本机 Named Pipe 服务端，返回 JSON 序列化的 `SessionCaptureEnvelope`。
  - 当前仍只保留键鼠事件计数模型，不记录具体按键内容。

## 当前能力

- 多屏截图：按 `Screen.AllScreens` 逐屏抓取。
- Payload：主图默认 `image/png`，缩略图默认 `image/jpeg`。
- IPC：Service 通过 Named Pipe 发起 capture 请求，Helper 返回 JSON 响应。
- 上传：Service 上传队列可处理内联字节；如果后续改为临时文件路径，也会在上传前读取并清理。
- 隐私边界：只保留 `KeyboardEventCount` / `MouseEventCount` / `WindowSwitchCount`，不保留按键正文。

## 本地运行

先准备配置文件：

```powershell
Copy-Item .\agent\src\EmployeeBehavior.Agent.SessionHelper\appsettings.json.example .\agent\src\EmployeeBehavior.Agent.SessionHelper\appsettings.json
Copy-Item .\agent\src\EmployeeBehavior.Agent.Service\appsettings.json.example .\agent\src\EmployeeBehavior.Agent.Service\appsettings.json
```

需要确认两边配置中的管道名一致：

- `SessionHelper:PipeName`
- `AgentService:SessionHelperPipeName`

开发时建议先启动 Helper，再启动 Service。

启动 Session Helper（控制台模式）：

```powershell
dotnet run --project .\agent\src\EmployeeBehavior.Agent.SessionHelper\EmployeeBehavior.Agent.SessionHelper.csproj -- --console
```

启动 Service（开发机前台运行）：

```powershell
dotnet run --project .\agent\src\EmployeeBehavior.Agent.Service\EmployeeBehavior.Agent.Service.csproj
```

默认配置说明：

- Service `DryRun=true`，因此会调用现有 `AgentApiClient` 占位逻辑而不是依赖真实后端。
- Helper 会持续提供截图 / 前台窗口 / 输入计数 / 会话状态采样。
- 如果需要用环境变量覆盖配置，分别使用 `SESSION_HELPER_` 和 `AGENT_` 前缀。

## 验证建议

在具备 .NET SDK 的 Windows 环境中执行：

```powershell
dotnet restore .\agent\EmployeeBehavior.Agent.sln
dotnet build .\agent\EmployeeBehavior.Agent.sln
dotnet run --project .\agent\src\EmployeeBehavior.Agent.SessionHelper\EmployeeBehavior.Agent.SessionHelper.csproj -- --console
dotnet run --project .\agent\src\EmployeeBehavior.Agent.Service\EmployeeBehavior.Agent.Service.csproj
```

建议重点确认：

1. 多屏截图在高 DPI、锁屏、UAC 提权桌面下的行为。
2. Named Pipe 在大图 payload 下的稳定性和时延。
3. 真实低层键鼠计数实现是否只输出计数、不泄露内容。
4. 后端真实 `/api/agent/screenshots` 协议是否需要额外字段或改成分块/文件上传。
