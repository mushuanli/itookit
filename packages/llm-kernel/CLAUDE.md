# CLAUDE.md — @itookit/llm-kernel

执行引擎核心层 — Executor/Orchestrator 注册表 + 运行时 + 插件系统。**无 UI 依赖**。

## Architecture

```
src/
├── core/
│   ├── event-bus.ts      ← KernelEventMap 类型目录 + getEventBus() 单例 (包装 common/EventBus)
│   ├── execution-context.ts ← ExecutionContext (channel-scoped IScopedEventBus emit 辅助)
│   └── types.ts
├── executors/      ← Agent, Http, Tool, Script (4 种)
├── orchestrators/  ← Serial, Parallel, Router, Loop, DAG (5 种)
├── runtime/        ← ExecutionRuntime (channel(executionId) 管理执行生命周期)
│                     MemoryStore (KV+TTL)
│                     StateMachine (via channel(id).emit 发出 state:changed)
├── worker/         ← WorkerAdapter (channel(id).onAny 零过滤转发)
└── plugins/        ← IKernelPlugin, PluginManager (onAny/on 桥接)
```

详情: [Executors + Orchestrators 表](./doc/components.md)

## EventBus — 类型目录 + 单例

`core/event-bus.ts` 不再自行实现事件总线，而是从 `@itookit/common` 导入 `EventBus<M>` 并：

- 定义 `KernelEventMap` (14 种事件 → payload 映射)，包含 `execution:*`、`node:*`、`stream:*`、`state:changed` 等
- 导出模块级单例 `getEventBus(): EventBus<KernelEventMap>`
- 导出类型别名 `IScopedEventBus` = `IEventChannel<KernelEventMap>` (兼容旧代码)
- 重新导出 `EventBus` 类

**Channel 生命周期**:
```
ExecutionRuntime.execute()
  → channel(executionId)    // 创建/复用以 executionId 为 key 的隔离通道
  → ExecutionContext(events)  // emit 经过 channel 冒泡到 bus 级 handler
  → finally: closeChannel(executionId)  // 清空 handler + 关门
```

WorkerAdapter 使用 `channel(id).onAny()` 订阅，无需手工 `if (executionId === id)` 过滤。
StateMachine 使用 `channel(this.config.id).emit('state:changed', ...)` 确保 WorkerAdapter 能接收。

## 近期变更

- `agent-executor` 设置 `runMode: 'kernel'` 以防止非 kernel 模式走 `anthropicPath` fallback
- EventBus 重构：6 套独立实现统一为 `@itookit/common/eventbus`，kernel 层退化为类型目录

## Conventions

- 不依赖 UI 库
- Executor/Orchestrator 通过注册表模式管理
- `generateExecutionId()` 使用带时间戳短 ID
- 由 `llm-engine/initializeLLMEngine()` 在启动时初始化
- channel(key) 是 O(1) 隔离的主要手段，不要在 handler 里手工过滤 executionId
