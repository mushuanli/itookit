# CLAUDE.md — @itookit/llm-engine

会话引擎 — 多会话管理、VFS 持久化、Mission 编排、Session Graph、Agent Loop。消费 `llm-kernel` 和 `llm-harness`。

## Architecture

```
src/
├── session/        ← SessionManager, SessionState, TaskRunner
│                     SessionEventBus (session + global 双 track, channel 路由)
│                     ClaudeCodeStrategy (内置 Agent Loop), agent-loop-strategy
├── persistence/    ← ChatEngine (IChatEngine), ChatManifest, ChatNode
├── adapters/       ← HarnessAdapter (Agent事件→OrchestratorEvent)
│                     UIEventAdapter (channel(sessionId).onAny 零过滤转发)
│                     llmkernel-adapter
├── mission/        ← MissionService, MissionScheduler, TodoState
├── session-graph/  ← DependencyGraph, GraphOrchestrator
├── services/       ← VFSAgentService, PromptHistoryService
├── core/           ← types, session origin & history policy
└── utils/          ← converters, LockManager, manifest-repair
```

## 核心机制

- **三执行路径**: Kernel (默认/单轮) vs Harness (`useHarness=true`) vs ClaudeCode (内置 Agent Loop)
- **Agent Loop 策略模式**: `IAgentLoopStrategy` 接口 — `ClaudeCodeStrategy` (内置) 和 `HarnessStrategy` (包装 `IAgentRuntime`) 统一调用约定
- **ClaudeCodeStrategy**: 完整 LLM 流式循环 — content block 解析 (thinking/text/tool_use) → 工具执行 → messages 拼接 → 循环。支持 thinking signature 链维护、AbortSignal 中断、默认 max 50 turns
- **HarnessStrategy**: 包装 `HarnessAdapter` 为 `IAgentLoopStrategy`，串行化执行（单 `IAgentRuntime`）
- **ILLMService 注入**: 通过组合根注入，替代 DeviceDriver 直连，统一 LLM 调用入口
- **Session Origin**: 会话来源追踪 (user/mission/sub-agent) + history policy 控制回传策略
- **Billing/Cost Tracking**: 完成时通过 `agentResolver.recordUsageCost()` 记录到 `cost.seq`
- **LLM Logging**: 通过 `ILLMLogger` 将完整 request/response 记录到 `/var/log/llm/{session}.json`
- **initializeLLMEngine()**: Kernel → agentService.init() → sessionEngine.init() → PromptHistory → SessionManager + (可选) HarnessAdapter

### Agent Loop Strategy Types

| 类型/接口 | 文件 | 说明 |
|---|---|---|
| `IAgentLoopStrategy` | `session/agent-loop-strategy.ts` | 策略接口 (run) |
| `AgentLoopRequest` | `session/agent-loop-strategy.ts` | 请求 (messages, llmParams, maxTurns, signal) |
| `AgentLoopResult` | `session/agent-loop-strategy.ts` | 结果 (output, turns[], totalUsage) |
| `TurnRecord` | `session/agent-loop-strategy.ts` | 单轮记录 (assistantBlocks[], toolResults[], usage) |
| `IToolExecutor` | `session/agent-loop-strategy.ts` | 工具执行器接口 |
| `ClaudeCodeStrategy` | `session/claude-code-runner.ts` | 内置 Agent Loop 实现 |
| `HarnessStrategy` | `adapters/harness-adapter.ts` | 包装 HarnessAdapter 的策略实现 |

### OrchestratorEvent 新增事件

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
- 新 Agent Loop 策略实现 `IAgentLoopStrategy`，通过 `TaskRunner.selectStrategy()` 分发
