# Windows Agent Skeleton

`agent/` 是公司自有 Windows 端 MVP，采用 `Windows Service + User Session Helper` 双进程拆分：

- `EmployeeBehavior.Agent.Service` 运行在服务上下文，负责心跳、策略拉取、截图上传和与后端通信。
- `EmployeeBehavior.Agent.SessionHelper` 运行在交互用户会话，负责截图、前台窗口、会话状态和输入活动聚合采集，再通过 Named Pipe 返回给 Service。

## 目录结构

```text
agent/
├─ EmployeeBehavior.Agent.sln
├─ Directory.Build.props
└─ src/
   ├─ EmployeeBehavior.Agent.Contracts/
   ├─ EmployeeBehavior.Agent.Service/
   └─ EmployeeBehavior.Agent.SessionHelper/
```

## 当前采集能力

- 多屏截图：按 `Screen.AllScreens` 逐屏抓取，输出 PNG 主图和 JPEG 缩略图。
- 前台窗口：采集前台窗口标题、进程名、可执行路径。
- 会话状态：
  - `Environment.SessionId`
  - `WTSQuerySessionInformation` 获取 `WTSConnectState` 与 `WTSClientProtocolType`
  - `GetSystemMetrics(SM_REMOTESESSION)` 判断远程会话
  - `GetLastInputInfo` 计算 `IdleSeconds`
  - `OpenInputDesktop` / `GetUserObjectInformation` 获取当前输入桌面名，用于区分 `Default` 与锁屏/安全桌面
- 输入活动聚合：
  - `WH_KEYBOARD_LL` 仅统计键盘按下事件总数
  - `WH_MOUSE_LL` 仅统计鼠标移动、点击、滚轮事件总数
  - `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` 统计前台窗口切换次数

## 隐私与安全边界

- 只保留聚合计数和会话元数据，不记录具体按键、字符、扫描码、窗口文本内容解析、剪贴板、麦克风、摄像头或其他私密正文。
- 低层 hook 回调只做计数递增，不持久化 `key code`、`key char`、鼠标坐标或原始输入 payload。
- 本阶段不实现远控、回放或主动控制能力。

## 进程分工

- 必须在交互用户会话中完成的采集：
  - 输入 hook
  - 输入桌面检测
  - 前台窗口状态
  - 截图
- `Service` 不直接访问交互桌面；它只通过 `SessionHelper` 的 Named Pipe 获取一次快照并上传。
- 如果 `SessionHelper` 没有运行在真实 interactive session，输入计数和桌面状态可能退化为零值或空值，但不会突破隐私边界。

## 配置

先复制示例配置：

```powershell
Copy-Item .\agent\src\EmployeeBehavior.Agent.SessionHelper\appsettings.json.example .\agent\src\EmployeeBehavior.Agent.SessionHelper\appsettings.json
Copy-Item .\agent\src\EmployeeBehavior.Agent.Service\appsettings.json.example .\agent\src\EmployeeBehavior.Agent.Service\appsettings.json
```

两端管道名必须一致：

- `SessionHelper:PipeName`
- `AgentService:SessionHelperPipeName`

`SessionHelper` 相关配置：

- `EnableInputActivityHooks`
  - 默认 `true`
  - 关闭后不安装键盘/鼠标/前台切换 hook，输入计数会保持为 0
- `EnableDesktopStateInspection`
  - 默认 `true`
  - 关闭后不调用 `OpenInputDesktop`，`InputDesktopName` 与基于桌面的锁屏判断会为空
- `InputHookStartupTimeoutSeconds`
  - 默认 `5`
  - helper 启动时等待 hook 安装成功的最长时间

## 本地运行

开发时建议先启动 Helper，再启动 Service：

```powershell
dotnet run --project .\agent\src\EmployeeBehavior.Agent.SessionHelper\EmployeeBehavior.Agent.SessionHelper.csproj -- --console
dotnet run --project .\agent\src\EmployeeBehavior.Agent.Service\EmployeeBehavior.Agent.Service.csproj
```

默认情况下：

- Service `DryRun=true`，不会依赖真实后端。
- Helper 会持续输出截图、会话状态、前台窗口和输入计数采样日志。

## 建议验证点

在具备 Windows + .NET SDK 的环境中，建议重点验证：

1. 本地控制台、RDP 会话、锁屏、解锁之间 `IsRemoteSession` / `IsRdpSession` / `InputDesktopName` / `IdleSeconds` 的变化。
2. 键盘、鼠标移动、鼠标点击、滚轮和窗口切换计数是否随时间窗口正确归零并重新累积。
3. `SessionHelper` 不在 interactive session 时，是否按预期退化且不会抛出未处理异常。
4. 后端对新增心跳 JSON 字段与截图 multipart 字段是否按兼容方式处理。
