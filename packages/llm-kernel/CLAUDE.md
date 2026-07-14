# CLAUDE.md — @itookit/llm-kernel

> **S8 ✅ (2026-07-14)**: 此包已消除。所有符号迁移至 `@itookit/llm-engine` 或删除。
>
> **迁移映射**:
> | 符号 | 迁移目标 |
> |---|---|
> | `NodeStatus`, `ExecutorConfig`, `ExecutorType` | → `@itookit/llm-engine` (`core/types.ts` 内联) |
> | `setKernelDeviceManager`, `getKernelDeviceManager` | → `@itookit/llm-engine` (`core/device-registry.ts`) |
> | `initializeKernel`, `KernelInitOptions` | → inline 至 `initializeLLMEngine()` |
> | `EventBus`, `getEventBus`, `KernelEventMap` | → 删除（llm-engine 有自己的 SessionEventBus） |
> | `IExecutor`, `IExecutorFactory`, `ExecutorRegistry` | → 删除（llm-engine 有自己的 ExecutorRegistry） |
> | `ExecutionRuntime`, `getRuntime` | → 删除 |
> | `IExecutionContext`, `ContextVariables` | → 删除 |
> | ID generators | → 删除（common 已有 `generateId`） |
>
> 外部 import 路径变更：`from '@itookit/llm-kernel'` → `from '@itookit/llm-engine'`

## 历史架构（S6c 状态）

执行引擎核心层 — EventBus + 运行时外壳。**无 UI 依赖**。

> **S6 (2026-07-14)**: 裁剪 ~60% 死代码 — CLI、Worker、PluginManager、StateMachine、MemoryStore、5 种 Orchestrator、Script/Http/Tool Executor、validators、logger 已删除。
> **S6c (2026-07-14)**: AgentExecutor + BaseExecutor 物理删除；`ExecutionRuntime.execute()` 移除。LLM 调用已统一走 `ILLMService`，kernel 退化为 EventBus + 设备注册表 + 工具函数的最小外壳。

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
│   └── index.ts           ← ExecutorRegistry（空注册表，S6c 移除 AgentExecutor）
├── runtime/
│   └── execution-runtime.ts ← ExecutionRuntime（cancel/event 操作）+ getRuntime() 单例
│                              S6c: execute() 方法已删除
└── utils/
    └── id-generator.ts    ← generateId, generateUUID, generateExecutionId 等
```

## EventBus — 类型目录 + 单例

`core/event-bus.ts` 从 `@itookit/common` 导入 `EventBus<M>` 并：

- 定义 `KernelEventMap` (14 种事件 → payload 映射)，包含 `execution:*`、`node:*`、`stream:*`、`state:changed` 等
- 导出模块级单例 `getEventBus(): EventBus<KernelEventMap>`
- 导出类型别名 `IScopedEventBus` = `IEventChannel<KernelEventMap>`
- 重新导出 `EventBus` 类

## 外部消费方

llm-kernel 仅被两个包使用：

| 消费者 | 导入的符号 |
|---|---|
| `llm-engine` | `ExecutorConfig`, `NodeStatus`, `getEventBus`, `KernelEventMap`, `initializeKernel`, `KernelInitOptions` |
| `app-shell` | `setKernelDeviceManager` |

## 近期变更

- **S6c**: AgentExecutor（844 行）+ BaseExecutor 物理删除；`ExecutionRuntime.execute()` 移除（~100 行）；ExecutorRegistry 清空内置注册
- **S6**: 删除 15 个死代码文件；`ExecutorType` 收缩为 `'agent'`；`executePlan()` 删除；`initializeKernel()` 简化（移除 PluginManager）
- EventBus 重构：6 套独立实现统一为 `@itookit/common/eventbus`，kernel 层退化为类型目录

## Conventions

- 不依赖 UI 库
- `generateExecutionId()` 使用带时间戳短 ID
- 由 `llm-engine/initializeLLMEngine()` 在启动时初始化
- channel(key) 是 O(1) 隔离的主要手段，不要在 handler 里手工过滤 executionId
