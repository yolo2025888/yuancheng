# 远程员工工作行为与代码风险监控系统

这是一个面向公司电脑的远程员工工作会话监控 MVP。系统不开发远控功能，只在公司电脑上采集工作会话截图和元数据，后台进行截图变化检测、连续无变化事件记录、活动分类、权限审计和 GitHub 风险分析。

## 当前状态

项目处于工程初始化阶段，文档和 MVP 开发计划已完成：

- `docs/PRD.md`
- `docs/TECHNICAL_ARCHITECTURE.md`
- `docs/TECH_STACK_AND_ADMIN_PLAN.md`
- `docs/DEVELOPMENT_PLAN.md`

## 目标架构

```text
agent/       C#/.NET Windows Service + User Session Helper
backend/     Python FastAPI API and workers
frontend/    React + TypeScript admin console
deploy/      Local development deployment files
docs/        Product and technical planning docs
```

## 本地依赖

MVP 推荐：

- .NET SDK 8 或更高版本
- Python 3.12 或 3.13
- Node.js 22
- Docker / Docker Compose

当前开发机检测到 Node 和 Python 可用，`dotnet` 不在 PATH。Agent 源码可以先搭建，构建需要安装 .NET SDK 后执行。

## 本地基础服务

```powershell
docker compose -f deploy/docker-compose.yml up -d
```

服务：

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- MinIO API: `localhost:9000`
- MinIO Console: `localhost:9001`

## 安全边界

- 只采集公司电脑，不采集员工私人设备。
- 记录键盘/鼠标活动次数，不记录具体按键内容。
- 原图查看和导出必须有权限和审计。
- 截图原图短期保存，结构化事件长期保存。

