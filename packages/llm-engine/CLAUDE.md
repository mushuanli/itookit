# CLAUDE.md — @itookit/llm-engine

会话引擎 — 多会话管理、VFS 持久化、Mission 编排、Session Graph、Agent Loop。消费 `llm-kernel` 和 `llm-harness`。

## Architecture

```
src/
├── session/        ← SessionManager, SessionState, TaskRunner
│                     SessionEventBus (session + global 双 track, channel 路由)
│                     UnifiedLoopStrategy, agent-loop-strategy, ClaudeCodeStrategy
├── persistence/    ← ChatEngine (IChatEngine), ChatEngineLog (ILog facade), ulid
│                     ChatManifest, ChatNode
├── adapters/       ← HarnessAdapter (AgentEvent→OrchestratorEvent)
│                     UIEventAdapter, llmkernel-adapter, tool-executor-bridge
├── mission/        ← MissionService, MissionScheduler, LiteSubAgentRouter, TodoState
├── session-graph/  ← DependencyGraph, GraphOrchestrator
├── services/       ← VFSAgentService, PromptHistoryService
├── core/           ← types, errors, constants
│                     ★ executor-registry (ILoop 分发)
│                     ★ loop-driver (drive() 协程宿主)
│                     ★ middleware-pipeline (composeMiddleware)
├── executors/      ← (保留目录，待 S5~S6 executor 插件)
└── utils/          ← converters, LockManager, manifest-repair, throttled-writer
```

## 核心机制

### 两条执行路径

```
SessionManager.sendMessage()
  └─ TaskRunner.submit() → processQueue()
       ├─ useHarness=true → executeAgentLoopTask()
       │   └─ selectStrategy() → UnifiedLoopStrategy(★ ILLMService) | HarnessStrategy
       │       └─ ★ llmService.chatStream()  ← 统一 LLM 入口
       └─ useHarness=false → executeTask()
           └─ kernelAdapter.executeQuery()   ← 旧 kernel 路径 (auto-continue 循环)
```

### LLM 2.0 四原语（渐进迁移中）

| 原语 | 状态 | 关键文件 |
|---|---|---|
| **AgentEvent** | canonical schema 已定义，旧事件标记 @deprecated | `common/.../agent-event.ts` |
| **ILoop** | 接口 + 注册表已就绪，待接入 TaskRunner | `common/.../loop.ts`, `core/executor-registry.ts` |
| **drive()** | 协程宿主已就绪，pause/resume 一条路径 | `core/loop-driver.ts` |
| **ILog** | 接口已定义，ChatEngineLog facade 已实现 | `common/.../loop.ts`, `persistence/chat-engine-log.ts` |

### ILLMService 注入（★ S1 已完成）

- `initializeLLMEngine({ llmService })` 接收 `ILLMService`（由 `createHarness().llmService` 提供）
- Agent Loop 路径（`UnifiedLoopStrategy` / `ClaudeCodeStrategy` / `LiteSubAgentRouter`）全部走 `ILLMService.chatStream()`
- 旧 `LLMKernelAdapter.streamRaw()` 已删除
- Kernel 路径（`executeTask`）仍使用 `LLMKernelAdapter.executeQuery()`，待 S6 迁移

### Agent Loop Strategy Types

| 类型/接口 | 文件 | 说明 |
|---|---|---|
| `IAgentLoopStrategy` | `session/agent-loop-strategy.ts` | 策略接口 (run) — 待 `ILoop` 替代 |
| `UnifiedLoopStrategy` | `session/unified-loop-strategy.ts` | 默认策略，依赖 `ILLMService` |
| `ClaudeCodeStrategy` | `session/claude-code-runner.ts` | 轻量策略，依赖 `ILLMService`（当前未实例化） |
| `HarnessStrategy` | `adapters/harness-adapter.ts` | 包装 HarnessAdapter 的策略实现 |
| `IToolExecutor` | `session/agent-loop-strategy.ts` | 工具执行器接口 |

### OrchestratorEvent（@deprecated — 待迁移至 canonical AgentEvent）

Agent Loop 路径发送 content-block 粒度事件:
- `stream:thinking:start/stop` — thinking block 边界
- `stream:content:start/stop` — text block 边界
- `tool:queued` / `tool:input` / `tool:running` / `tool:success` / `tool:error` — 工具生命周期
- `turn:start` / `turn:end` — 轮次边界

### Cost Recording

TaskRunner 在两个路径完成时回调 `agentResolver.recordUsageCost(connectionId, sessionId, {...})`。
`SessionTokenUsage` 包含 `cacheWriteTokens`, `cacheReadTokens`, `costUsd`, `isEstimated` 字段。

详情:
- 核心类型 + 运行时: [core-types.md](./doc/core-types.md)
- 持久化 + 事件映射 + Mission + SDG: [engine-details.md](./doc/engine-details.md)

## Conventions

- `VFSAgentService` 同时实现 `IAgentConfigService` 和 `IAgentManagementService`
- Chat 文件以 `.chat` 扩展名存储在 `chats` 模块
- `chatFileParser` 解析 `.chat` 文件为结构化数据
- 新 Agent Loop 策略实现 `IAgentLoopStrategy`（未来实现 `ILoop`），通过 `TaskRunner.selectStrategy()` 分发
- LLM 调用入口统一为 `ILLMService`，禁止绕过接口直接调用 device driver
- 事件迁移期间新旧事件并行，新代码优先使用 `AgentEvent`（from `@itookit/common`）
