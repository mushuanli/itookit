# CLAUDE.md — @itookit/llm-engine

LLM 会话引擎 — 会话管理、VFS 持久化、Mission 编排、Session Dependency Graph。UI 适配层，消费 `llm-kernel` 和 `llm-harness`。

## Commands

```bash
pnpm --filter @itookit/llm-engine build       # tsup
pnpm --filter @itookit/llm-engine dev         # tsup --watch
pnpm --filter @itookit/llm-engine test        # vitest
pnpm --filter @itookit/llm-engine test:run    # 单次运行
pnpm --filter @itookit/llm-engine lint
```

## Architecture

```
src/
├── index.ts                    ← 公共 API + initializeLLMEngine()
├── core/
│   ├── types.ts                ← SessionRuntime, ChatSessionSettings, SessionStatus...
│   ├── errors.ts               ← EngineError, EngineErrorCode
│   └── constants.ts            ← ENGINE_DEFAULTS, STORAGE_KEYS
├── session/
│   ├── session-manager.ts      ← SessionManager — 多会话并发管理
│   ├── session-state.ts        ← SessionState (消息历史 + Agent 状态)
│   ├── session-event-bus.ts    ← 会话级事件总线
│   ├── session-recovery.ts     ← 崩溃恢复
│   ├── task-runner.ts          ← TaskRunner — 双路径执行调度
│   ├── agent-resolver.ts       ← AgentResolver — Agent 配置解析
│   ├── attachment-processor.ts ← 附件处理
│   ├── auto-continue.ts        ← 自动续写
│   └── truncation-detector.ts  ← 截断检测
├── persistence/
│   ├── session-engine.ts       ← LLMSessionEngine — Chat 持久化
│   └── types.ts                ← ILLMSessionEngine, ChatManifest, ChatNode...
├── adapters/
│   ├── ui-event-adapter.ts     ← UI 事件 → Engine 命令
│   ├── llmkernel-adapter.ts    ← llm-kernel 桥接
│   └── harness-adapter.ts      ← HarnessAdapter — Agent事件→OrchestratorEvent
├── mission/                    ← Mission 编排
│   ├── mission-service.ts      ← MissionService — 公共门面
│   ├── mission-scheduler.ts    ← 主循环调度
│   ├── todo-state.ts           ← TodoStateManager
│   └── result-persister.ts     ← 结果持久化
├── session-graph/              ← 文件级会话依赖图
│   ├── graph-orchestrator.ts   ← GraphOrchestrator
│   ├── dependency-graph.ts     ← DependencyGraph (拓扑排序)
│   ├── session-meta-store.ts   ← SessionMetaStore
│   ├── completion-analyzer.ts  ← CompletionAnalyzer
│   └── types.ts                ← SessionMeta, SessionStatus...
├── services/
│   ├── vfs-agent-service.ts    ← VFSAgentService
│   ├── agent-service.ts        ← IAgentConfigService 接口
│   └── prompt-history-service.ts ← PromptHistoryService
└── utils/
    ├── converters.ts           ← 消息格式转换
    ├── parsers.ts              ← chatFileParser
    ├── error-formatter.ts
    ├── throttled-writer.ts     ← 流式节流写入
    ├── LockManager.ts
    ├── manifest-repair.ts      ← ChatManifest 修复
    └── logger.ts
```

## initializeLLMEngine() 初始化

```typescript
const { sessionManager } = await initializeLLMEngine({
    agentService: IAgentConfigService,      // VFSAgentService
    sessionEngine: ILLMSessionEngine,       // LLMSessionEngine
    maxConcurrent: 20,
    harnessRuntime?: IAgentRuntime,         // 可选，启用 Agent 循环
    harnessSkillService?: ISkillService,    // 可选，Skill 面板
    harnessToolService?: IToolService,      // 可选，slash 命令
});
```

初始化顺序：initializeKernel → agentService.init() → sessionEngine.init() → PromptHistory → createSessionManager → 装配 HarnessAdapter

## 双执行路径（TaskRunner 核心）

| 路径 | 条件 | 能力 |
|---|---|---|
| Kernel 路径 | 默认 | 单轮、流式、auto-continue |
| Harness 路径 | `useHarness=true` | 多轮 Agent 循环、工具调用、上下文压缩、HITL |

## LLMSessionEngine — Chat 持久化

```
my-session.chat               ← ChatManifest JSON (branches: Record<branchId, headNodeId>)
_my-session.chat/             ← 资产目录
├── 000_00000_s.chat          ← 系统节点
├── 000_00001_u.chat          ← 用户消息
├── 000_00002_a.chat          ← 助手消息
└── settings.yaml             ← ChatSessionSettings
```

继承 `BaseModuleService`，通过 `engine` 操作 VFS。关键方法：`appendMessage()`, `getHistory()`, `getBranches()`, `switchBranch()`, `forkFromNode()`。

## HarnessAdapter — 事件映射

将 `agent:*` 事件桥接为 `OrchestratorEvent`（UI 消费）：

| Agent Event | OrchestratorEvent |
|---|---|
| `agent:stream:content` | `node_update` field=output |
| `agent:stream:thinking` | `node_update` field=thought |
| `agent:tool:start` | `node_start` (新建 tool 子节点) |
| `agent:tool:success` | `node_status(success)` + toolResult |
| `agent:tool:error/timeout` | `node_status(failed)` |
| `agent:tty:open/data/close` | `node_update` metaInfo.tty* |
| `agent:budget:warning/exhausted` | `node_update` / `error` |

单例模式：`initHarnessAdapter(runtime)` / `getHarnessAdapter()` / `resetHarnessAdapter()`

## Mission 编排

```
MissionService.createMission(goal)
  → 并行 Planner → TodoItem[]
  → MissionScheduler.run() loop:
      getReadyTodos() → executeTodo() → runVerifier()
      → verdict: done | retry | hitl
```

VFS 存储：`missions/<id>/plan.json` + `journal.md` + `results/` + `summaries/` + `hitl/`

## Session Dependency Graph

每个 VFS 文件是一个 "session"，依赖声明在 `_<filename>/session-meta.json`。`GraphOrchestrator` 拓扑排序后自底向上执行。

## Conventions

- `VFSAgentService` 同时实现 `IAgentConfigService` 和 `IAgentManagementService`
- `TaskRunner` 是 `SessionManager` 内部的核心调度器 — 外部不直接使用
- Chat 文件以 `.chat` 扩展名存储在 `chats` 模块
- `chatFileParser` 解析 `.chat` 文件为结构化数据供 UI 列表使用
