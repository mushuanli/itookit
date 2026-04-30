# CLAUDE.md — @itookit/llm-engine

会话引擎 — 多会话管理、VFS 持久化、Mission 编排、Session Graph。消费 `llm-kernel` 和 `llm-harness`。

## Commands

```bash
pnpm --filter @itookit/llm-engine build       # tsup
pnpm --filter @itookit/llm-engine dev         # tsup --watch
pnpm --filter @itookit/llm-engine test        # vitest
```

## Architecture

```
src/
├── session/        ← SessionManager, SessionState, TaskRunner, EventBus
├── persistence/    ← LLMSessionEngine, ChatManifest, ChatNode
├── adapters/       ← HarnessAdapter (Agent事件→OrchestratorEvent), llmkernel-adapter
├── mission/        ← MissionService, MissionScheduler, TodoState
├── session-graph/  ← DependencyGraph, GraphOrchestrator
└── services/       ← VFSAgentService, PromptHistoryService
```

## 核心机制

- **双执行路径**: Kernel (默认/单轮) vs Harness (`useHarness=true` /多轮)
- **initializeLLMEngine()**: 初始化顺序 → Kernel → agentService.init() → sessionEngine.init() → SessionManager + HarnessAdapter
- **TaskRunner**: 内部调度器，统一管理双路径和后台事件提升

详情: [持久化 + 事件映射 + Mission + SDG](./doc/engine-details.md)

## Conventions

- `VFSAgentService` 同时实现 `IAgentConfigService` 和 `IAgentManagementService`
- Chat 文件以 `.chat` 扩展名存储在 `chats` 模块
- `chatFileParser` 解析 `.chat` 文件为结构化数据
