# CLAUDE.md — @itookit/llm-kernel

执行引擎核心层 — Executor/Orchestrator 注册表 + 运行时 + 插件系统。**无 UI 依赖**。

## Architecture

```
src/
├── core/           ← ExecutionTask, OrchestratorEvent, KernelEventBus
├── executors/      ← Agent, Http, Tool, Script (4 种)
├── orchestrators/  ← Serial, Parallel, Router, Loop, DAG (5 种)
├── runtime/        ← ExecutionRuntime (注册表), MemoryStore (KV+TTL)
└── plugins/        ← IKernelPlugin, PluginManager
```

详情: [Executors + Orchestrators 表](./doc/components.md)

## 近期变更

- `agent-executor` 设置 `runMode: 'kernel'` 以防止非 kernel 模式走 `anthropicPath` fallback

## Conventions

- 不依赖 UI 库
- Executor/Orchestrator 通过注册表模式管理
- `generateExecutionId()` 使用带时间戳短 ID
- 由 `llm-engine/initializeLLMEngine()` 在启动时初始化
