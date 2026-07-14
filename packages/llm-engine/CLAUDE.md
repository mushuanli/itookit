# CLAUDE.md — @itookit/llm-engine

会话引擎 — 多会话管理、VFS 持久化、Mission 编排、Session Graph、Agent Loop。

> **S4~S5 ✅ (2026-07-14)**: ChatEngineLog 完整 ILog 实现；Goal 控制回路（DependencyScheduler + reconcile + 3 Predicate）；**S5 验收达成** — 4 个控制回路全部切换至 reconcile() 驱动。
> **S6c ✅ (2026-07-14)**: LLMKernelAdapter + UIEventAdapter 删除；DependencyGraph 删除；auto-continue.ts 删除；AgentExecutor 物理删除（llm-kernel）；HarnessAdapter 解耦（IHarnessContext 服务定位器）。
> **S7 ✅ (2026-07-14)**: SessionEventBus 切换至 `SessionEvent`（= canonical AgentEvent + MessageProjectionEvent + SessionStructuralEvent），替代 deprecated `OrchestratorEvent`；UI 消费者（HistoryView、SessionEventHandler）支持新旧双路径；SessionActor 桥接改为 canonical forward。
> **S8 ✅ (2026-07-14)**: `@itookit/llm-kernel` 包消除 — `NodeStatus`、`ExecutorConfig`、`ExecutorType` 内联至 `core/types.ts`；`setKernelDeviceManager` 迁移至 `core/device-registry.ts`；`initializeKernel()` inline 至 `initializeLLMEngine()`。

## Architecture

```
src/
├── session/        ← SessionManager, SessionState (in-memory projection cache), TaskRunner
│                     SessionEventBus (SessionEvent = AgentEvent | Projection | Structural, channel 路由)
│                     truncation-detector, session-recovery
├── persistence/    ← ChatEngine (IChatEngine), ★ ChatEngineLog (完整 ILog facade)
│                     ulid (ULID 生成), types (IChatEngine + ChatManifest/ChatNode)
├── adapters/       ← HarnessAdapter, tool-executor-bridge
├── mission/        ← MissionService, ★ MissionScheduler (reconcile-driven), LiteSubAgentRouter
│                     TodoState, ★ sub-agent-loop-adapter, ★ mission-goal-factory
├── session-graph/  ← ★ GraphOrchestrator (+executeWithReconcile)
│                     ★ agent-runtime-loop-adapter, ★ graph-goal-factory（含 resolveDependencyTree）
│                     SessionMetaStore
├── services/       ← VFSAgentService, PromptHistoryService
├── core/           ← types（含 NodeStatus/ExecutorConfig/ExecutorType/SessionEvent，S8 从 llm-kernel 吸收）
│                     errors, constants, device-registry（S8 从 llm-kernel 迁移）
│                     ★ executor-registry (ILoop 分发)
│                     ★ loop-driver (drive() 协程宿主)
│                     ★ middleware-pipeline (composeMiddleware)
│                     ★ session-actor (SessionActor — drive ↔ EventBus 桥接)
│                     ★ goal/ (S5 ✅) — DependencyScheduler + reconcile + 3 Predicate
│                     ★ harness-context (S6c) — IHarnessContext 服务定位器
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
           └─ ILLMService.chatStream()   ← S6c: 直接调用 ILLMService，不再经 LLMKernelAdapter
```

> **S6c**: `executeTask()` 改为 `ILLMService.chatStream()` 直连，token 统计优先使用真实数据。LLMKernelAdapter + UIEventAdapter 已删除。

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

**已删除（S6 + S6c）**:
- ~~`AutoContinueHandler`~~ → `createTruncationDetectionMiddleware`（ILoop 中间件管线）
- ~~`CompletionAnalyzer`~~ → `createLLMJudgePredicate`（统一 Goal predicate 系统）
- ~~`GraphOrchestrator.executeSession()`~~ → `executeWithReconcile()`（DependencyScheduler + reconcile）
- ~~`DependencyGraph`~~ (类 + topoSort) → `resolveDependencyTree()` 自由函数（graph-goal-factory）
- ~~`auto-continue.ts`~~ → 类型定义内联至 `loop-middleware.ts`（TruncationDetectionConfig）
- ~~`LLMKernelAdapter`~~ + ~~`UIEventAdapter`~~ → `ILLMService.chatStream()` 直连
- ~~`AgentExecutor`~~ + ~~`BaseExecutor`~~ (llm-kernel) → LLM 调用统一走 ILLMService
- ~~`llm-kernel/ExecutionRuntime.execute()`~~ → 随 AgentExecutor 删除

## ILLMService 注入（S1）

- `initializeLLMEngine({ llmService })` 接收 `ILLMService`
- 所有路径（Agent Loop + kernel fallback）统一走 `ILLMService.chatStream()`
- S6c: kernel 路径 `executeTask()` 也切换为 ILLMService 直连

## Harness 服务访问（S6c）

- **推荐**: `getHarnessContext(): IHarnessContext | null` — 服务定位器（runtime + skillService + toolService）
- **@deprecated**: `getHarnessAdapter(): HarnessAdapter | null` — 委托给 IHarnessContext，待 OrchestratorEvent 替换后移除

## 事件系统（S7）

- **SessionEvent** = `AgentEvent`（canonical，15 变体）| `MessageProjectionEvent`（3 变体，UI 树投影）| `SessionStructuralEvent`（6 变体，分支/消息操作）
- SessionEventBus 过渡期同时接受新旧格式；`onSession` handler 类型为 `(event: SessionEvent) => void`
- `SessionActor` 桥接：canonical AgentEvent 直接 forward + 同步 emit `node_update` 树投影事件（兼容现有 UI）
- 新代码优先 emit canonical `AgentEvent`（`stream:content`、`turn:start`、`tool:queued` 等）
- `@deprecated` `OrchestratorEvent` 待所有生产者迁移后移除

## Cost Recording

TaskRunner 在两个路径完成时回调 `agentResolver.recordUsageCost(connectionId, sessionId, {...})`。
`SessionTokenUsage` 包含 `cacheWriteTokens`, `cacheReadTokens`, `costUsd`, `isEstimated` 字段。
S6c: kernel 路径优先使用 `chatStream` 返回的真实 token 数，回退到字符估算。

## Conventions

- `VFSAgentService` 同时实现 `IAgentConfigService` 和 `IAgentManagementService`
- Chat 文件以 `.chat` 扩展名存储在 `chats` 模块
- LLM 调用入口统一为 `ILLMService`，禁止绕过接口直接调用 device driver
- 事件迁移期间新旧事件并行，新代码优先使用 `AgentEvent`（from `@itookit/common`）
- 新 Agent Loop 策略实现 `ILoop`，通过 `ExecutorRegistry.register()` 注册
- UI 层访问 harness 服务通过 `getHarnessContext()`，不直接依赖 `HarnessAdapter`
- `setKernelDeviceManager()` / `getKernelDeviceManager()` 从 `@itookit/llm-engine` 导入（S8 从 llm-kernel 迁移）
- `NodeStatus`、`ExecutorConfig`、`ExecutorType` 定义在 `core/types.ts`（S8 从 llm-kernel 吸收）
