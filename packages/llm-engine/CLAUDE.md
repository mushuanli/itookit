# CLAUDE.md — @itookit/llm-engine

LLM 会话引擎 — 会话管理、VFS 持久化、ILoop 协程执行、TaskGraph DAG 编排、插件系统。

## Architecture

```
src/
├── core/               ← 引擎内核
│   ├── types.ts             SessionEvent / ExecutionTask / ExecutorConfig / NodeStatus 等
│   ├── loop-driver.ts       drive() + resumeDrive() — 协程宿主，pause/resume 协议
│   ├── executor-registry.ts ILoop 按 mode 注册/分发（chat / loop / loop:full）
│   ├── middleware-pipeline.ts composeMiddleware() — ILoopMiddleware 组合（LIFO 栈）
│   ├── session-actor.ts     SessionActor — drive ↔ EventBus 桥接，Signal 队列
│   ├── context-assembler.ts ContextAssembler — ContextPlan → ContextSnapshot 确定性管线
│   ├── provider-message-adapter.ts Provider 消息验证（Anthropic/OpenAI 等）
│   ├── command-bus.ts       ICommandBus 实现 — 插件命令调度
│   ├── extension-registry.ts ILLMPlugin 注册/激活
│   ├── device-registry.ts   Device manager 访问
│   ├── errors.ts / constants.ts
├── executors/          ← ILoop 实现
│   ├── chat-executor.ts     mode='chat' — 单轮、无工具、无中间件
│   ├── loop-executor.ts     mode='loop'/'loop:full' — 完整 Agent Loop（工具执行、中间件管线）
│   ├── loop-middleware.ts   7 个内置 ILoopMiddleware 工厂（budget/error-recovery/compression/
│   │                        hitl/skills/back-pressure/truncation-detection）
│   ├── loop-presets.ts      createLoopExecutor('lite'|'full') — 预设中间件栈
├── session/            ← 会话管理
│   ├── session-manager.ts  门面（ISession），组合 SessionRegistry + RoundOperations + BranchService
│   ├── task-runner.ts      任务队列 + 并发控制 + ILoop 调度 + TaskGraph 提交
│   ├── session-state.ts    内存投影缓存（SessionState）
│   ├── session-event-bus.ts SessionEvent 路由
│   ├── session-registry.ts 会话注册/绑定/生命周期
│   ├── session-recovery.ts 崩溃恢复
│   ├── agent-resolver.ts   Agent/Connection 解析
│   ├── attachment-processor.ts 文件附件处理
│   ├── round-operations.ts Round 级操作（send/regenerate/delete/edit）
│   ├── branch-service.ts   分支管理
│   └── truncation-detector.ts 截断检测
├── persistence/        ← VFS 持久化
│   ├── round-log.ts        RoundLog — 完整 ILog 实现（append/fold/merge/rebase + FoldCache）
│   ├── chat-engine.ts      IChatEngine 实现（ChatEngine）
│   ├── draft-area.ts       VFSDraftArea — 崩溃安全草稿持久化
│   ├── round-types.ts      RoundManifest / RoundProjection / PersistedRound
│   ├── round-events.ts     RoundLogEvent / RoundChangeSet
│   ├── round-graph-service.ts Round DAG 操作（createRef/appendChild 等）
│   ├── context-profile-store.ts ContextProfile 持久化
│   ├── flow-definition-store.ts FlowDefinition 持久化（含版本控制）
│   ├── types.ts            IChatEngine 接口
│   ├── migration.ts        格式迁移
│   └── ulid.ts             ULID 生成
├── task-graph/         ← TaskGraph DAG 编排（v3 控制面）
│   ├── dependency-scheduler.ts Kahn 拓扑排序 + 环检测
│   ├── reconciler.ts       TaskGraphReconciler — 单写控制面，事件驱动调度
│   ├── runtime.ts          createTaskGraphRun / commitArtifact
│   ├── registry.ts         TaskExecutorRegistry + HarnessContributionRegistry
│   ├── builtins.ts         7 个内置 executor（agent/route/transform/reduce/human/spawn/subflow）
│   ├── catalog.ts          BUILTIN_TASK_KIND_DESCRIPTORS（schema + 默认值）
│   ├── agent.ts            AgentDefinitionRegistry + AgentTaskExecutor
│   ├── context-assembler.ts TaskContextAssembler
│   ├── commands.ts         TaskGraphCommandService（flow.* / taskGraph.* 命令）
│   ├── stores.ts           内存 store 实现
│   ├── vfs-stores.ts       VFS 持久化 store 实现
│   ├── recovery.ts         TaskGraphRecoveryService
│   ├── replay.ts           replayTaskGraphRun
│   ├── migration.ts        旧 harness asset 迁移
│   └── validation.ts       Flow revision 校验
├── session-graph/      ← 文件级跨会话依赖
│   ├── session-task-graph-runner.ts 依赖图 → TaskGraphRun 投影
│   ├── session-meta-store.ts        SessionMeta 持久化
│   └── session-flow-factory.ts      createSessionFlow / resolveDependencyTree
├── mission/            ← Mission 编排
│   ├── mission-service.ts           MissionService 门面
│   ├── mission-task-graph-runner.ts MissionPlan → TaskGraphRun 执行
│   ├── todo-state.ts                TodoStateManager
│   └── result-persister.ts          ResultPersistenceService
├── plugins/            ← 插件（通过 ICommandBus 暴露命令）
│   ├── session-plugin.ts   session.* / session.send 等
│   ├── vcs-plugin.ts       vcs.branch.* / vcs.sibling.* 等
│   └── history-plugin.ts   history.* 命令
├── services/           ← 服务层
│   ├── agent-service.ts        Agent 服务接口
│   ├── vfs-agent-service.ts    VFS 支持的 Agent 服务
│   └── prompt-history-service.ts Prompt 历史
├── scheduler/          ← dependency-resolver
└── utils/              ← converters / error-formatter / logger / parsers / vfs-entity-store
```

## 执行路径

```
SessionManager.sendMessage()
  └─ RoundOperations.sendMessage()
       └─ TaskRunner.submit() → processQueue()
            ├─ sendIntent.execution.kind === 'flow'
            │    └─ executeFlowTask() → TaskGraphReconciler.run(createTaskGraphRun(flow))
            └─ 否则
                 └─ executeV3ChatTask() → 编译为单节点 AgentTask Flow
                      └─ TaskGraphReconciler.run() → AgentTaskExecutor
                           └─ ExecutorRegistry.get(mode).run(ctx) → drive(gen, actor, ctx)
                                ├─ mode='chat'      → chatExecutor（单轮，无工具）
                                ├─ mode='loop'      → LoopExecutor(lite) = [budget, error-recovery, truncation]
                                └─ mode='loop:full' → LoopExecutor(full) = 全部 7 个中间件
```

所有聊天提交都先编译为单节点 TaskGraph Flow，再通过 TaskGraphReconciler 统一调度。`TaskRunner` 不再直接调用 `drive()`，而是通过 `executeV3Agent()` 作为 AgentTask executor 的回调。

## TaskGraph 控制面（v3）

TaskGraph 是引擎的统一控制面。所有执行（chat / loop / flow / mission / session-graph）都编译为 TaskGraphRun，由 `TaskGraphReconciler` 调度。

| 组件 | 文件 | 说明 |
|---|---|---|
| `TaskGraphReconciler` | `task-graph/reconciler.ts` | 单写控制面：拓扑调度 + 事件持久化 + 状态机推进 |
| `DependencyScheduler` | `task-graph/dependency-scheduler.ts` | Kahn 拓扑排序 + 环检测 + 增量调度 |
| `TaskExecutorRegistry` | `task-graph/registry.ts` | 按 handler key 注册/查找 TaskExecutor |
| `HarnessContributionRegistry` | `task-graph/registry.ts` | Plugin 贡献注册 + JSON Schema 校验 |
| 内置 Executor ×7 | `task-graph/builtins.ts` | agent / route / transform / reduce / human / spawn / subflow |
| `TaskKindDescriptor` ×7 | `task-graph/catalog.ts` | 每个 builtin 的 schema、默认值、端口定义 |
| `AgentDefinitionRegistry` | `task-graph/agent.ts` | 不可变 AgentDefinition 版本注册表 |
| `TaskContextAssembler` | `task-graph/context-assembler.ts` | 按 ContextPlan 组装上下文消息 |

### 初始化流程（initializeLLMEngine）

```
initializeLLMEngine({ agentService, sessionEngine, llmService, executors })
  ├─ ExecutorRegistry: 注册 chat + loop(lite)，默认 mode='chat'
  ├─ SessionManager: 创建（注入 engine + agentService）
  ├─ ILLMService: 注入 SessionManager
  ├─ TaskGraph:
  │   ├─ createBuiltinTaskExecutorRegistry() → 6 个非 agent executor
  │   ├─ HarnessContributionRegistry（含 BUILTIN_TASK_KIND_DESCRIPTORS）
  │   ├─ VFS stores ×5（run / event / artifact / contextSnapshot / state）
  │   ├─ TaskGraphReconciler（组装 stores + executorRegistry）
  │   └─ TaskGraphCommandService → registerTaskGraphCommands(commandBus, …)
  ├─ Plugin system:
  │   ├─ ExtensionRegistry: 注册 session / vcs / history 插件
  │   └─ 激活所有插件（注入 ExtensionContext{ commands }）
  └─ 返回 { sessionManager, commandBus, taskGraph }
```

## 事件系统

- **SessionEvent** = `AgentEvent`（canonical，15 变体）| `MessageProjectionEvent`（3 变体）| `SessionStructuralEvent`（7 变体）
- `SessionEventBus.emitSession(sessionId, event)` — 路由到绑定/后台会话
- `MessageProjectionEvent`: `message:appended` / `message:updated`（含 streaming delta）/ `message:status`
- `SessionStructuralEvent`: `branch:switched` / `regenerate_started` / `sibling:switched` 等
- `RegistryEvent`: 全局事件 — `pool_status_changed` / `session_tty_active` / `session_hitl_active` / `task_graph_run_projected` 等

## ILog — RoundLog

| 组件 | 说明 |
|---|---|
| `RoundLog` | 完整 ILog：append/fold/merge/rebase + cloneRound + FoldCache（60s TTL） |
| `VFSDraftArea` | 崩溃安全草稿持久化到 VFS assetdir |
| `RoundGraphService` | Round DAG 的 ref/children 操作 |
| `ContextProfileStore` | 分支级上下文规则持久化 |
| `FlowDefinitionStore` | Flow 定义 + 版本控制 |

## ContextAssembler

`ContextAssembler.assemble(plan, taskRunId, agent)` — 确定性上下文组装管线：

1. 沿 mainline 收集 rounds（支持 context profile 的 include/exclude/summary 规则）
2. 合并显式输入（artifact / round / text binding）
3. 检索 Memory
4. 前置 system prompt + skills prompt
5. Token budget 裁剪
6. Provider 消息验证
7. 生成 ContextSnapshot（含 digest / explanation）

## ILoop 执行

| 组件 | 文件 | 说明 |
|---|---|---|
| `drive()` | `core/loop-driver.ts` | 唯一协程宿主：yield AgentEvent → emit / yield await_signal → checkpoint → 等待 Signal |
| `resumeDrive()` | `core/loop-driver.ts` | 从 checkpoint 恢复（调用 `loop.resume(checkpoint)`） |
| `SessionActor` | `core/session-actor.ts` | emit() → EventBus / waitSignal() → pushSignal() 队列 |
| `chatExecutor` | `executors/chat-executor.ts` | mode='chat'，单轮无工具 |
| `LoopExecutor` | `executors/loop-executor.ts` | mode='loop'/'loop:full'，含工具执行（reads 并行/writes 串行） |
| `composeMiddleware()` | `core/middleware-pipeline.ts` | beforeExchange 正序 / afterExchange 逆序 / onError 首胜 |

### 7 个内置中间件

| 中间件 | 工厂函数 |
|---|---|
| Budget | `createBudgetMiddleware(limits, harnessImpl?)` |
| Error Recovery | `createErrorRecoveryMiddleware(config?, harnessImpl?)` |
| Compression | `createCompressionMiddleware(harnessImpl?)` |
| HITL | `createHITLMiddleware(harnessImpl?)` |
| Skills | `createSkillsMiddleware(harnessImpl?)` |
| Back Pressure | `createBackPressureMiddleware(harnessImpl?)` |
| Truncation Detection | `createTruncationDetectionMiddleware()` |

每个工厂接受可选的 `harnessImpl` 参数——传入时直接返回 harness 实现，否则使用内置轻量实现。这允许 llm-harness 注入中间件而无跨包依赖。

### LoopContext

所有 LLM 参数通过 `LoopContext` 传入：`connectionId`、`model`、`systemPrompt`、`temperature`、`maxTokens`、`thinking`、`reasoningEffort`、`historyLength`、`tools`、`middlewares`、`contextSnapshot`。

## Round resend / regenerate 约束

- **未生成 assistant**：使用 `update-existing` 模式写回原 Round，Round ID/parents 不变
- **已有有效 assistant**：从 primary parent 创建 replacement branch + append 新 Round
- **上下文限制**：`update-existing` 从 target Round 的 primary parent 组装历史
- **删除语义**：删除 assistant → `clearAssistantInRound()`；删除 user → `deleteRound()` 级联

## Resume — 同进程 HITL

- `drive()` 在 `await_signal` 处 checkpoint 到 DraftArea 后挂起
- `SessionActor.pushSignal()` → 恢复同一 generator
- 重启后不自动 resume；旧 active run 标记为 interrupted

## 插件系统

| 组件 | 说明 |
|---|---|
| `CommandBus` | ICommandBus 实现 — `register(name, handler)` → `execute(name, args)` |
| `ExtensionRegistry` | ILLMPlugin 注册 → `activate(ctx)` 批量激活 |
| `createSessionPlugin` | 30+ session.* 命令（send/abort/regenerate/delete 等） |
| `createVcsPlugin` | vcs.branch.* / vcs.sibling.* 命令 |
| `createHistoryPlugin` | history.* 命令 |

## Conventions

- 所有 LLM 调用入口统一为 `ILLMService`，禁止绕过接口
- 事件统一使用 `SessionEvent`；生产者 emit，EventBus 路由
- 新 Agent Loop 实现 `ILoop`，通过 `ExecutorRegistry.register()` 注册
- 新 Task 类型实现 `TaskExecutor`，通过 `TaskExecutorRegistry.register()` 注册
- 新插件实现 `ILLMPlugin`，通过 `ExtensionRegistry.register()` 注册
- 所有 LLM 配置通过 `LoopContext` 传入 executor（不硬编码 connectionId/model）
- `NodeStatus`、`ExecutorConfig` 定义在 `core/types.ts`
- Chat 文件以 `.chat` 扩展名存储在 `chats` 模块
- `VFSAgentService` 同时实现 `IAgentConfigService` 和 `IAgentManagementService`

## 相关项目文档

| 文档 | 内容 |
|---|---|
| [架构设计](../../doc/architecture.md) | 系统全貌 — LLM Engine Stack、TaskGraph 控制面、Harness 设计 |
| [集成链](../../doc/integration-chains.md) | Chat 端到端调用链 + 引擎装配 |
| [事件流](../../doc/event-flows.md) | SessionEvent 桥接 + UI 消费链 |
| [DAG 设计](../../doc/feat/dag.md) | Round DAG 数据模型与 fold 策略 |
| [Harness v3](../../doc/feat/harness-v3.md) | TaskGraph v3 架构决策与迁移 |
| [接口契约](../../doc/interface-contracts.md) | ILLMService / ISession / SessionEvent 接口 |
| [文件索引](../../doc/file-index.md) | 场景 → 关键文件映射 |
