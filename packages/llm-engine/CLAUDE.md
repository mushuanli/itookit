# CLAUDE.md — @itookit/llm-engine

会话引擎 — 多会话管理、VFS 持久化、Mission 编排、Session Graph、Agent Loop。

> **S1~S12 ✅ (2026-07-14)**: 四原语内核（Log/Loop/Channel/Goal）全部实施。llm-kernel 消除、事件统一（SessionEvent）、控制回路统一（Goal/reconcile）、resume 实现、LiteSubAgentRouter ILoop 迁移、ISession 接口 + ICommandBus + SessionManager 降级。详见 [llm-2.md](../../doc/feat/llm-2.md)。

## Architecture

```
src/
├── session/        ← SessionManager, SessionState (in-memory projection cache), TaskRunner
│                     SessionEventBus (SessionEvent = AgentEvent | Projection | Structural, channel 路由)
│                     truncation-detector, session-recovery
├── persistence/    ← ChatEngine (IChatEngine), ★ ChatEngineLog (完整 ILog facade)
│                     ulid (ULID 生成), types (IChatEngine + ChatManifest/ChatNode)
├── adapters/       ← tool-executor-bridge
├── mission/        ← MissionService, ★ MissionScheduler (reconcile-driven), LiteSubAgentRouter
│                     TodoState, ★ sub-agent-loop-adapter, ★ mission-goal-factory
├── session-graph/  ← ★ GraphOrchestrator (+executeWithReconcile)
│                     ★ agent-runtime-loop-adapter, ★ graph-goal-factory（含 resolveDependencyTree）
│                     SessionMetaStore
├── services/       ← VFSAgentService, PromptHistoryService
├── core/           ← types（含 NodeStatus/ExecutorConfig/ExecutorType/SessionEvent，S8 从 llm-kernel 吸收）
│                     errors, constants, device-registry（S8 从 llm-kernel 迁移）
│                     ★ executor-registry (ILoop 分发)
│                     ★ loop-driver (drive() + resumeDrive() 协程宿主)
│                     ★ middleware-pipeline (composeMiddleware)
│                     ★ session-actor (SessionActor — drive ↔ EventBus 桥接)
│                     ★ goal/ (S5 ✅) — DependencyScheduler + reconcile + 3 Predicate
├── executors/      ← chat-executor, loop-executor, loop-middleware (7 个中间件 + harness 委托),
│                     loop-presets (lite/full + HarnessMiddlewareSet)
└── utils/          ← converters, error-formatter, logger, parsers
```

## 两条执行路径

```
SessionManager.sendMessage()
  └─ TaskRunner.submit() → processQueue()
       ├─ mode specified → executeAgentLoopTask(mode)
       │   └─ ExecutorRegistry.get(mode).run(ctx) → drive(gen, actor, ctx)
       │       │                                      ↕ checkpoint? → resumeDrive(loop, id, actor, ctx)
       │       ├─ mode='chat'      → chatExecutor (单轮，无工具)
       │       ├─ mode='loop'      → LoopExecutor(lite) = [budget, error-recovery, truncation]
       │       ├─ mode='loop:full' → LoopExecutor(full) = 全部 7 个中间件
       │       └─ mode='harness'   → HarnessLoopExecutor (llm-harness) = ContextManager + 六维预算 + 四层压缩 + …
       └─ mode absent → executeTask()
           └─ ILLMService.chatStream()   ← S6c: 直接调用 ILLMService，不再经 LLMKernelAdapter
```

## LLM 2.0 四原语

| 原语 | 状态 | 关键文件 |
|---|---|---|
| **AgentEvent** | ✅ canonical schema（15 变体），唯一事件词汇 | `common/.../agent-event.ts` |
| **ILoop** | ✅ 接口 + ExecutorRegistry + chat/loop executor | `common/.../loop.ts`, `core/executor-registry.ts` |
| **drive()** | ✅ 协程宿主，pause/resume 一条路径；`resumeDrive()` 支持跨进程恢复 | `core/loop-driver.ts` |
| **ILog** | ✅ 完整实现 — ChatEngineLog（VFS DraftArea + RefStore + fold 缓存）| `persistence/chat-engine-log.ts` |
| **Goal** | ✅ 接口 + DependencyScheduler + reconcile + 3 Predicate；**4 控制回路全部切换** | `common/.../goal.ts`, `core/goal/`, `mission/`, `session-graph/` |
| **Resume** | ✅ `LoopExecutor.resume()` + `resumeDrive()` + TaskRunner checkpoint 检测 | `core/loop-driver.ts`, `executors/loop-executor.ts`, `session/task-runner.ts` |
| **LiteSubAgentRouter** | ✅ 迁移至 ILoop（`LoopExecutor` 替代 `UnifiedLoopStrategy`）| `mission/lite-sub-agent-router.ts` |

### ILog

| 组件 | 文件 | 说明 |
|---|---|---|
| `ChatEngineLog` | `persistence/chat-engine-log.ts` | 完整 ILog 实现：append/fold/merge/rebase + fold TTL 缓存 |
| `VFSDraftArea` | 同上（内部类） | 崩溃安全草稿持久化到 VFS assetdir |
| `ChatEngineRefStore` | 同上（内部类） | ChatManifest 驱动的分支/标签 CRUD |
| `ulid()` | `persistence/ulid.ts` | Crockford base32 ULID 生成（替代 BBB_SSSSS_R 位置编码） |
| `SessionState` | `session/session-state.ts` | 内存投影缓存 — ILog.fold() 的 UI 层投影，非独立事实源 |

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

## ILLMService 注入

- `initializeLLMEngine({ llmService })` 接收 `ILLMService`
- 所有路径统一走 `ILLMService.chatStream()`

## 事件系统

- **SessionEvent** = `AgentEvent`（canonical，15 变体）| `MessageProjectionEvent`（3 变体，UI 树投影）| `SessionStructuralEvent`（8 变体，含 regenerate）
- `SessionEventBus.emitSession(sessionId, event: SessionEvent)` — 直接接受 `SessionEvent`，无过渡期格式检测
- `SessionActor` 桥接：canonical AgentEvent forward + `message:updated` 树投影事件
- 树投影事件使用 `messageId`（替代旧 `nodeId`）、`delta`（替代旧 `chunk`）
- `OrchestratorEvent` 已删除（S7 收尾），所有生产者统一 emit `SessionEvent`

## Cost Recording

TaskRunner 在两个路径完成时回调 `agentResolver.recordUsageCost(connectionId, sessionId, {...})`。

## Resume — 跨进程协程恢复

| 组件 | 文件 | 说明 |
|---|---|---|
| `resumeDrive()` | `core/loop-driver.ts` | 调用 `loop.resume(checkpoint)` 并驱动生成器，与 `drive()` 共享 `driveGenerator()` |
| `LoopExecutor.resume()` | `executors/loop-executor.ts` | 从 Log 重建消息状态 + 计数已完成轮次 → `executeLoop(ctx, completedTurns, [])` |
| `HarnessLoopExecutor.resume()` | llm-harness | 从 `lastCtx` 重建；委托 `run()`（完整 harness 状态重建后续跟进） |
| TaskRunner checkpoint 检测 | `session/task-runner.ts` | `log.draft().restore()` → 有则 `resumeDrive()`，无则 `drive()` |

**设计要点**：
- `resume()` 不序列化协程栈 — 轮次边界状态全在 Log 中，通过 `fold()` 重建
- `executeLoop(ctx, startTurn, initialTurns)` 是 `run()` 和 `resume()` 的共享实现
- `lastCtx` 存储 `run()` 时的 `LoopContext`，供 `resume()` 使用
- checkpoint 持久化（`DraftArea.setCurrent()` 接线）后续跟进

## LiteSubAgentRouter ILoop 迁移

`LiteSubAgentRouter` 内部用 `LoopExecutor`（ILoop）替代 `UnifiedLoopStrategy`：

| 组件 | 说明 |
|---|---|
| `createInMemoryLog()` | 子代理内存 ILog — `fold()` 返回当前消息；`append()` 更新为 `turn.payload` |
| `createToolServiceAdapter()` | `IToolExecutor` → `IToolService` 适配（含工具过滤） |
| ILLMService wrapper | 覆盖 `chatStream()` 注入 `task.connectionId` / `task.modelName` |
| 手动生成器驱动 | 子代理用 lite preset，无需 HITL；`await_signal` 视为错误 |
| `loopFactory` 参数 | 可选，默认 `createLoopExecutor('lite', ...)`；`MissionService` 装配兼容 |

## Conventions

- `VFSAgentService` 同时实现 `IAgentConfigService` 和 `IAgentManagementService`
- Chat 文件以 `.chat` 扩展名存储在 `chats` 模块
- LLM 调用入口统一为 `ILLMService`，禁止绕过接口直接调用 device driver
- 事件统一使用 `SessionEvent`；生产者 emit `AgentEvent`（flat）或 `MessageProjectionEvent`/`SessionStructuralEvent`（wrapper），EventBus 自动归一化
- 新 Agent Loop 策略实现 `ILoop`，通过 `ExecutorRegistry.register()` 注册
- `NodeStatus`、`ExecutorConfig`、`ExecutorType` 定义在 `core/types.ts`
- 已删除：`ClaudeCodeStrategy`、`HarnessStrategy`、`HarnessAdapter`、`IHarnessContext`、`@itookit/llm-kernel`、`UnifiedLoopStrategy`
