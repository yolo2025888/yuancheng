# Windows Agent Skeleton

该目录包含 Windows Agent 的首版工程骨架，遵循规划中的 `Windows Service + User Session Helper` 拆分。

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
  - Service、Session Helper 和后续 Named Pipe / HTTP 接口共享的数据契约。
- `EmployeeBehavior.Agent.Service`
  - Windows Service 骨架。
  - 已预留心跳、策略拉取、Session Helper IPC 客户端、上传队列和日志配置入口。
- `EmployeeBehavior.Agent.SessionHelper`
  - 用户会话侧骨架。
  - 已预留截图、多屏、前台窗口、键鼠活动计数、锁屏/RDP 状态采集接口。
  - 支持托盘模式和控制台模式入口。

## 设计边界

- 当前仅提供可读、可扩展的 SDK-style 工程文件和源码骨架。
- 不记录具体按键内容，只保留键鼠活动计数模型。
- `dotnet` 当前环境不可用，因此本次未执行 `restore/build/test`。
- `Named Pipe`、真实截图字节采集、锁屏检测、输入 Hook 和后端真实接口仍是后续实现点。

## 后续建议

在具备 .NET SDK 的 Windows 环境中执行：

```powershell
dotnet restore .\agent\EmployeeBehavior.Agent.sln
dotnet build .\agent\EmployeeBehavior.Agent.sln
```

建议下一步优先补齐：

1. Service 与 Session Helper 的 Named Pipe 协议与进程拉起。
2. 真实截图实现与缩略图生成。
3. WTS/桌面 API 的锁屏、RDP、输入计数实现。
4. 后端 Agent API 的认证和上传闭环。
