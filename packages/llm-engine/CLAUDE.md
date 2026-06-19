# CLAUDE.md — @itookit/llm-engine

会话引擎 — 多会话管理、VFS 持久化、Mission 编排、Session Graph。消费 `llm-kernel` 和 `llm-harness`。

## Architecture

```
src/
├── session/        ← SessionManager, SessionState, TaskRunner, EventBus
├── persistence/    ← ChatEngine (IChatEngine), ChatManifest, ChatNode
├── adapters/       ← HarnessAdapter (Agent事件→OrchestratorEvent), llmkernel-adapter
├── mission/        ← MissionService, MissionScheduler, TodoState
├── session-graph/  ← DependencyGraph, GraphOrchestrator
├── services/       ← VFSAgentService, PromptHistoryService
├── core/           ← types, session origin & history policy
└── utils/          ← converters, LockManager, manifest-repair
```

## 核心机制

- **双执行路径**: Kernel (默认/单轮) vs Harness (`useHarness=true` /多轮)
- **ILLMService 注入**: 通过组合根注入，替代 DeviceDriver 直连，统一 LLM 调用入口
- **Session Origin**: 会话来源追踪 (user/mission/sub-agent) + history policy 控制回传策略
- **initializeLLMEngine()**: Kernel → agentService.init() → sessionEngine.init() → SessionManager + HarnessAdapter

详情:
- 核心类型 + 运行时: [core-types.md](./doc/core-types.md)
- 持久化 + 事件映射 + Mission + SDG: [engine-details.md](./doc/engine-details.md)

## Conventions

- `VFSAgentService` 同时实现 `IAgentConfigService` 和 `IAgentManagementService`
- Chat 文件以 `.chat` 扩展名存储在 `chats` 模块
- `chatFileParser` 解析 `.chat` 文件为结构化数据
