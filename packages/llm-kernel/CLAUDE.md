# CLAUDE.md — @itookit/llm-kernel

执行引擎核心层 — AgentExecutor + EventBus + 运行时。**无 UI 依赖**。

> **S6 (2026-07-14)**: 裁剪 ~60% 死代码 — CLI、Worker、PluginManager、StateMachine、MemoryStore、5 种 Orchestrator、Script/Http/Tool Executor、validators、logger 已删除。

## Architecture

```
src/
├── core/
│   ├── event-bus.ts      ← KernelEventMap 类型目录 + getEventBus() 单例 (包装 common/EventBus)
│   ├── execution-context.ts ← ExecutionContext (channel-scoped IScopedEventBus emit 辅助)
│   ├── types.ts           ← ExecutorType = 'agent'（S6 收缩）；NodeStatus
│   ├── interfaces.ts      ← IExecutor, ExecutorConfig, IExecutorFactory
│   ├── device-registry.ts ← set/getKernelDeviceManager（app-shell 注入）
├── executors/
│   ├── index.ts           ← ExecutorRegistry（仅注册 'agent'，单例）
│   ├── agent-executor.ts  ← AgentExecutor — LLM 调用（844 行，被 LLMKernelAdapter 使用）
│   └── base-executor.ts   ← BaseExecutor 抽象类
├── runtime/
│   └── execution-runtime.ts ← ExecutionRuntime（主入口）+ getRuntime() 单例
└── utils/
    └── id-generator.ts    ← generateId, generateUUID, generateExecutionId 等
```

## EventBus — 类型目录 + 单例

`core/event-bus.ts` 从 `@itookit/common` 导入 `EventBus<M>` 并：

- 定义 `KernelEventMap` (14 种事件 → payload 映射)，包含 `execution:*`、`node:*`、`stream:*`、`state:changed` 等
- 导出模块级单例 `getEventBus(): EventBus<KernelEventMap>`
- 导出类型别名 `IScopedEventBus` = `IEventChannel<KernelEventMap>`
- 重新导出 `EventBus` 类

**Channel 生命周期**:
```
ExecutionRuntime.execute()
  → channel(executionId)    // 创建/复用以 executionId 为 key 的隔离通道
  → ExecutionContext(events)  // emit 经过 channel 冒泡到 bus 级 handler
  → finally: closeChannel(executionId)  // 清空 handler + 关门
```

## 外部消费方

llm-kernel 仅被两个包使用：

| 消费者 | 导入的符号 |
|---|---|
| `llm-engine` | `ExecutorConfig`, `NodeStatus`, `ExecutionRuntime`, `getRuntime`, `ExecutionResult`, `getEventBus`, `KernelEventMap`, `initializeKernel`, `KernelInitOptions` |
| `app-shell` | `setKernelDeviceManager` |

## 近期变更

- **S6**: 删除 15 个死代码文件；`ExecutorType` 收缩为 `'agent'`；`executePlan()` 删除；`initializeKernel()` 简化（移除 PluginManager）
- `agent-executor` 设置 `runMode: 'kernel'` 以防止非 kernel 模式走 `anthropicPath` fallback
- EventBus 重构：6 套独立实现统一为 `@itookit/common/eventbus`，kernel 层退化为类型目录

## Conventions

- 不依赖 UI 库
- `generateExecutionId()` 使用带时间戳短 ID
- 由 `llm-engine/initializeLLMEngine()` 在启动时初始化
- channel(key) 是 O(1) 隔离的主要手段，不要在 handler 里手工过滤 executionId
