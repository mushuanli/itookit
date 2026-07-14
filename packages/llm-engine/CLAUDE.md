# CLAUDE.md — @itookit/llm-engine

会话引擎 — 多会话管理、VFS 持久化、Mission 编排、Session Graph、Agent Loop。消费 `llm-kernel` 和 `llm-harness`。

> **S4~S5 ✅ (2026-07-14)**: ChatEngineLog 完整 ILog 实现；Goal 控制回路（DependencyScheduler + reconcile + 3 Predicate）；**S5 验收达成** — 4 个控制回路全部切换至 reconcile() 驱动。

## Architecture

```
src/
├── session/        ← SessionManager, SessionState (in-memory projection cache), TaskRunner
│                     SessionEventBus (session + global 双 track, channel 路由)
│                     truncation-detector, auto-continue (types only), session-recovery
├── persistence/    ← ChatEngine (IChatEngine), ★ ChatEngineLog (完整 ILog facade)
│                     ulid (ULID 生成), types (IChatEngine + ChatManifest/ChatNode)
├── adapters/       ← HarnessAdapter, UIEventAdapter, llmkernel-adapter, tool-executor-bridge
├── mission/        ← MissionService, ★ MissionScheduler (reconcile-driven), LiteSubAgentRouter
│                     TodoState, ★ sub-agent-loop-adapter, ★ mission-goal-factory
├── session-graph/  ← ★ GraphOrchestrator (+executeWithReconcile), DependencyGraph (@deprecated topoSort)
│                     ★ agent-runtime-loop-adapter, ★ graph-goal-factory
│                     SessionMetaStore
├── services/       ← VFSAgentService, PromptHistoryService
├── core/           ← types, errors, constants
│                     ★ executor-registry (ILoop 分发)
│                     ★ loop-driver (drive() 协程宿主)
│                     ★ middleware-pipeline (composeMiddleware)
│                     ★ session-actor (SessionActor — drive ↔ EventBus 桥接)
│                     ★ goal/ (S5 ✅) — DependencyScheduler + reconcile + 3 Predicate
├── executors/      ← chat-executor, loop-executor, loop-middleware (7 个中间件), loop-presets
└── utils/          ← converters, error-formatter, logger, parsers
```

## 两条执行路径

```
SessionManager.sendMessage()
  └─ TaskRunner.submit() → processQueue()
       ├─ mode specified → executeAgentLoopTask(mode)
       │   └─ ExecutorRegistry.get(mode).run(ctx) → drive(gen, actor, ctx)
       │       ├─ mode='chat'     → chatExecutor (单轮，无工具)
       │       ├─ mode='loop'     → LoopExecutor(lite) = [budget, error-recovery, truncation]
       │       └─ mode='loop:full' → LoopExecutor(full) = 全部 7 个中间件
       └─ mode absent → executeTask()
           └─ kernelAdapter.executeQuery()   ← 旧 kernel 路径（auto-continue 已迁移至 ILoop 中间件）
```

> **S5**: `executeTask()` 的 while(true) auto-continue 循环已删除，截断检测由 `createTruncationDetectionMiddleware` 在 ILoop 管线中处理。

## LLM 2.0 四原语（S1~S6 实施状态）

| 原语 | 状态 | 关键文件 |
|---|---|---|
| **AgentEvent** | ✅ canonical schema，旧事件标记 @deprecated | `common/.../agent-event.ts` |
| **ILoop** | ✅ 接口 + ExecutorRegistry + chat/loop executor | `common/.../loop.ts`, `core/executor-registry.ts` |
| **drive()** | ✅ 协程宿主，pause/resume 一条路径 | `core/loop-driver.ts` |
| **ILog** | ✅ 完整实现 — ChatEngineLog（VFS DraftArea + RefStore + fold 缓存） | `persistence/chat-engine-log.ts` |
| **Goal** | ✅ 接口 + DependencyScheduler + reconcile + 3 Predicate；**4 控制回路全部切换** | `common/.../goal.ts`, `core/goal/`, `mission/`, `session-graph/` |

### ILog (S4) — completed 2026-07-14

| 组件 | 文件 | 说明 |
|---|---|---|
| `ChatEngineLog` | `persistence/chat-engine-log.ts` | 完整 ILog 实现：append/fold/merge/rebase + fold TTL 缓存 |
| `VFSDraftArea` | 同上（内部类） | 崩溃安全草稿持久化到 VFS assetdir |
| `ChatEngineRefStore` | 同上（内部类） | ChatManifest 驱动的分支/标签 CRUD |
| `ulid()` | `persistence/ulid.ts` | Crockford base32 ULID 生成（替代 BBB_SSSSS_R 位置编码） |
| `SessionState` | `session/session-state.ts` | 内存投影缓存 — ILog.fold() 的 UI 层投影，非独立事实源 |

**已删除**（S4）:
- ~~`LockManager`~~ → 内联 Promise 链 (ChatEngine.withLock)
- ~~`manifest-repair`~~ → append-only 无不一致态
- ~~`ThrottledWriter`~~ → 内联 accumulator 模式
- ~~`BBB_SSSSS_R` ID~~ → ULID（`makeNodeId` 改用 `ulid()`）

### Goal (S5) ✅ — 验收达成 2026-07-14

| 组件 | 文件 | 说明 |
|---|---|---|
| `IController` / `Goal` / `GoalNode` / `Predicate` / `Verdict` | `common/.../goal.ts` | 控制回路全部类型定义 |
| `DependencyScheduler` | `core/goal/dependency-scheduler.ts` | Kahn 拓扑 + 环检测 + 事件驱动调度 |
| `reconcile()` | `core/goal/reconciler.ts` | 控制回路算法（并行/串行分发、重试、HITL） |
| Predicate ×3 | `core/goal/predicates.ts` | truncation / shell / llm-judge |
| `createTruncationDetectionMiddleware` | `executors/loop-middleware.ts` | AutoContinue → ILoop 中间件（S5 新增） |
| `createSubAgentLoopAdapter` | `mission/sub-agent-loop-adapter.ts` | ISubAgentRouter.delegate() → ILoop（S5 新增） |
| `createMissionGoal` | `mission/mission-goal-factory.ts` | MissionPlan → Goal 转换（S5 新增） |
| `createAgentRuntimeLoopAdapter` | `session-graph/agent-runtime-loop-adapter.ts` | IAgentRuntime.run() → ILoop（S5 新增） |
| `createGraphGoal` | `session-graph/graph-goal-factory.ts` | Session 依赖图 → Goal 转换（S5 新增） |

**现有控制回路 → Goal 配置映射（全部已切换 ✅）**:
| 现有模块 | Goal 配置 | 迁移状态 |
|---|---|---|
| Mission | `MissionScheduler.run()` → `reconcile(createMissionGoal(plan), …)` | ✅ |
| SessionGraph | `GraphOrchestrator.executeWithReconcile()` — reconcile-driven (S5) | ✅ |
| AutoContinue | while(true) → `createTruncationDetectionMiddleware` (ILoop afterTurn) | ✅ |
| BackPressure | 存根 → 真实 `createBackPressureMiddleware` (注入错误反馈) | ✅ |

**已删除（S6 cleanup）**:
- `AutoContinueHandler` → `createTruncationDetectionMiddleware`（ILoop 中间件管线）
- `CompletionAnalyzer` → `createLLMJudgePredicate`（统一 Goal predicate 系统）
- `GraphOrchestrator.executeSession()` → `executeWithReconcile()`（DependencyScheduler + reconcile）
- `DependencyGraph.topoSort()` 标记 @deprecated → `DependencyScheduler`（仍被 graph-goal-factory 活跃使用）

## ILLMService 注入（S1）

- `initializeLLMEngine({ llmService })` 接收 `ILLMService`
- Agent Loop 路径全部走 `ILLMService.chatStream()`
- 旧 `LLMKernelAdapter.streamRaw()` 已删除

## Cost Recording

TaskRunner 在两个路径完成时回调 `agentResolver.recordUsageCost(connectionId, sessionId, {...})`。
`SessionTokenUsage` 包含 `cacheWriteTokens`, `cacheReadTokens`, `costUsd`, `isEstimated` 字段。

## Conventions

- `VFSAgentService` 同时实现 `IAgentConfigService` 和 `IAgentManagementService`
- Chat 文件以 `.chat` 扩展名存储在 `chats` 模块
- LLM 调用入口统一为 `ILLMService`，禁止绕过接口直接调用 device driver
- 事件迁移期间新旧事件并行，新代码优先使用 `AgentEvent`（from `@itookit/common`）
- 新 Agent Loop 策略实现 `ILoop`，通过 `ExecutorRegistry.register()` 注册
