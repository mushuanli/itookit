# @itookit/harness — API 参考

> 持久化执行内核：`DurableTaskProgram`（init/reduce 状态机）+ `EffectAdapter`（副作用）+ Task/Resource/Budget/Interaction 的调度与恢复。所有 API 从 `@itookit/harness` 根导出。

## 目录

- [入口：Harness](#入口harness)
- [句柄：SessionHandle / TaskHandle](#句柄)
- [程序模型：DurableTaskProgram / Decision / KernelAction / WaitSpec](#程序模型)
- [Effect 模型：EffectAdapter / EffectExecutionContext](#effect-模型)
- [资源 / 权限 / 预算](#资源权限预算)
- [会话数据：SharedState / Context / 跨会话消息](#会话数据)
- [事件与信号](#事件与信号)
- [工具函数](#工具函数)
- [错误模型](#错误模型)
- [存储：SeqFileHarnessStore](#存储)
- [源码结构：文件与路径](#源码结构文件与路径)

---

## 入口：Harness

执行内核主类，通过 `new Harness(options)` 创建，`await harness.initialize()` 后可用。

```ts
class Harness {
    constructor(options: HarnessOptions);
    initialize(): Promise<void>;
    dispose(): void;

    // 注册（装配期调用）
    registerProgram(program: DurableTaskProgram): void;
    registerEffect(adapter: EffectAdapter): void;
    registerStorageResolver(resolver: SessionStorageResolver): void;
    registerWorkspace(adapter: WorkspaceAdapter): void;
    use(plugin: HarnessPlugin): Promise<void>;

    // 会话
    createSession(spec: { id?: string; storage: StorageBindingRef }): Promise<SessionHandle>;
    openSession(id: SessionId): Promise<SessionHandle>;
    listSessions(): AsyncIterable<SessionRecord>;

    // 任务（全局）
    openTask<O>(id: TaskId): Promise<TaskHandle<O>>;
    inspectTask(id: TaskId): Promise<TaskSnapshot>;

    // 恢复
    recover(): Promise<RecoveryReport>;

    // 事件监听
    onChanged(listener: (e: { sessionId: string; taskId?: string }) => void): () => void;
}
```

**`HarnessOptions`**：`catalog`（目录 fs）、`maxConcurrent`（并发上限，默认 4）、`leaseMs`（租约时长，默认 30s）、`pollMs`（轮询间隔，默认 250ms）、`workerId`（可选）。

**`bindCapabilities(task, bindings, onHandle?)`**：为 Task 创建类型化资源句柄（llm/tool/...），逐项回调 `onHandle`（用于 setBudget），发 `capabilities` signal 后 `start()`。这是上层能力绑定的统一入口。

---

## 句柄

### SessionHandle（组合 8 个窄接口）

```ts
interface SessionHandle extends
    SessionTaskApi, SessionSharedStateApi, SessionMessageApi,
    SessionContextApi, SessionResourceApi, SessionBudgetApi,
    SessionWorkspaceApi, SessionLifecycleApi {
    readonly id: SessionId;
}
```

**`SessionTaskApi`** — 任务生命周期

| 方法 | 说明 |
|---|---|
| `submit<I,O>(spec: TaskSpec<I>): Promise<TaskHandle<O>>` | 提交任务 |
| `signal(taskId, signal): Promise<void>` | 发信号 |
| `respond<T>(taskId, response): Promise<void>` | 回应交互（HITL） |
| `events(options?): AsyncIterable<EventEnvelope>` | 按序消费会话事件 |

**`SessionSharedStateApi`** — 会话内共享状态（key-value + 版本 CAS）

| 方法 | 说明 |
|---|---|
| `getShared<T>(key)` | 读共享状态 |
| `setShared<T>(key, value, options?)` | 写共享状态（可带 expectedVersion） |
| `deleteShared(key, options?)` | 删除 |
| `listShared(prefix?)` | 列出 |
| `sharedHistory<T>(key)` | 版本历史 |

**`SessionMessageApi`** — 跨会话消息（outbox/inbox）

| 方法 | 说明 |
|---|---|
| `sendToSession<T>(targetSessionId, topic, payload)` | 发消息到另一会话 |
| `inbox(options?)` | 读取收件箱 |

**`SessionContextApi`** — Context 分支/提交

| 方法 | 说明 |
|---|---|
| `commitContext<T>(delta, options?)` | 提交一次 context 变更（CAS） |
| `getContextCommit<T>(id)` | 读某次提交 |
| `getContextBranch(name?)` | 读分支头 |
| `contextHistory(head?)` | 遍历提交历史 |

**`SessionResourceApi`** — 资源/权限

| 方法 | 说明 |
|---|---|
| `createResource(spec)` | 创建资源 + 句柄 |
| `grantResource(parentHandleId, holderTaskId, rights)` | 派生子句柄 |
| `revokeResource(handleId)` | 撤销 |
| `authorizeResource(handleId, right, holderTaskId?)` | 校验权限 |

**`SessionBudgetApi`** — 预算

| 方法 | 说明 |
|---|---|
| `setBudget(handleId, dimension, hardLimit, expectedVersion?)` | 设置硬上限 |
| `chargeBudget(handleId, dimension, amount)` | 扣减（超限抛错） |

**`SessionWorkspaceApi`** — 工作区快照/合并

| 方法 | 说明 |
|---|---|
| `snapshotWorkspace(handleId, adapter)` | 快照 |
| `diffWorkspace(handleId, baseId, targetId)` | diff |
| `mergeWorkspace(handleId, baseId, leftId, rightId)` | 三方合并 |

**`SessionLifecycleApi`** — `suspend()` / `resume()` / `close(options?)`

### TaskHandle<O>

```ts
interface TaskHandle<O = unknown> {
    readonly id: TaskId;
    status(): Promise<TaskSnapshot>;
    wait(options?: { timeoutMs?: number }): Promise<ExitRecord<O>>;   // 阻塞等待终态
    poll(): Promise<ExitRecord<O> | undefined>;                        // 非阻塞
    signal(signal: TaskSignal): Promise<void>;
    start(): Promise<void>;
    respond<T>(response: InteractionResponse<T>): Promise<void>;
    createResource(spec: TaskResourceSpec): Promise<ResourceGrant>;
    cancel(reason?: string): Promise<void>;
    events(options?: { after?: number }): AsyncIterable<EventEnvelope>;
    history(options?: { afterVersion?: number }): Promise<TaskRecord[]>;
    attempts(): Promise<TaskAttempt[]>;
}
```

---

## 程序模型

### DurableTaskProgram<S, I, O>

持久化状态机 —— 这是 Program 的核心契约。State 必须 JSON 可序列化，跨 `reduce` 持久化。

```ts
interface DurableTaskProgram<S = unknown, I = unknown, O = unknown> {
    readonly manifest: TaskProgramManifest;                              // { kind, version }
    init(input: I): Decision<S, O> | Promise<Decision<S, O>>;            // 首次
    reduce(state: Readonly<S>, event: TaskInputEvent): Decision<S, O> | Promise<Decision<S, O>>;  // 逐事件
}
```

### Decision<S, O>

每次 `init`/`reduce` 的返回：新状态 + 声明副作用 + 下一步。

```ts
interface Decision<S, O> {
    state: S;
    actions?: KernelAction[];
    next:
        | { type: 'continue' }
        | { type: 'wait'; on: WaitSpec }
        | { type: 'complete'; output: O }
        | { type: 'fail'; error: SerializableError; retryable?: boolean };
}
```

### KernelAction

程序声明的副作用（由内核执行）：

```ts
type KernelAction =
    | { type: 'effect'; effect: EffectRequest }
    | { type: 'spawn'; spawnKey: string; spec: TaskSpec }
    | { type: 'request-interaction'; interaction: InteractionRequest<JsonValue> }
    | { type: 'set-shared'; key: string; value: JsonValue; expectedVersion?: number | null }
    | { type: 'delete-shared'; key: string; expectedVersion?: number | null }
    | { type: 'emit'; eventType: string; payload?: unknown };
```

### WaitSpec

等待条件（原子 + 组合）：

```ts
type WaitAtom =
    | { type: 'signal'; id?: string }
    | { type: 'effect'; id?: string }
    | { type: 'task'; id: TaskId }
    | { type: 'child'; spawnKey: string }
    | { type: 'interaction'; id: string };

type WaitSpec = WaitAtom
    | { type: 'any'; waits: WaitSpec[] }
    | { type: 'all'; waits: WaitSpec[] }
    | { type: 'quorum'; waits: WaitSpec[]; required: number };
```

### TaskInputEvent

程序收到的输入事件：

```ts
type TaskInputEvent =
    | { type: 'started' }
    | { type: 'effect-completed'; effectId: EffectId; result: unknown }
    | { type: 'effect-failed'; effectId: EffectId; error: SerializableError }
    | { type: 'task-exited'; taskId: TaskId; exit: ExitRecord }
    | { type: 'interaction-resolved'; interactionId: string; value: JsonValue }
    | { type: 'signal'; sequence: number; signal: TaskSignal };
```

### TaskSpec<I>

提交任务的规格：

```ts
interface TaskSpec<I = unknown> {
    program: ProgramRef;                  // { kind, version }
    input: I;
    parent?: TaskId;
    spawnKey?: string;
    dependsOn?: TaskDependency[];
    retry?: RetryPolicy;
    priority?: number;
    labels?: Record<string, string>;
    deferStart?: boolean;                 // 持久化但不调度，直到 TaskHandle.start()
}
```

---

## Effect 模型

### EffectAdapter<Req, Res>

副作用执行器（能力面）：

```ts
interface EffectAdapter<Req = unknown, Res = unknown> {
    readonly kind: string;
    readonly version: string;
    execute(request: Req, context: EffectExecutionContext): Promise<Res>;
    reconcile?(request: Req, context: EffectExecutionContext): Promise<EffectReconcileResult<Res>>;  // worker 丢失后
    cancel?(request: Req, context: EffectExecutionContext): Promise<void>;
}
```

### EffectRequest<Req>

```ts
interface EffectRequest<Req = unknown> {
    id?: EffectId;
    kind: string;
    version: string;
    request: Req;
    idempotencyKey: string;               // 幂等键（崩溃后不重复执行）
    timeoutMs?: number;
    retry?: RetryPolicy;
    grants?: Array<{ handleId: HandleId; right: ResourceRight }>;
}
```

### EffectExecutionContext

```ts
interface EffectExecutionContext {
    sessionId: SessionId;
    taskId: TaskId;
    effectId: EffectId;
    abortSignal: AbortSignal;
    grants: AuthorizedEffectGrant[];
    sessionState?: EffectSessionState;
    emit?: (event: { type: string; payload?: unknown }) => Promise<void>;     // 流式事件
    chargeBudget?: (handleId, dimension, amount) => Promise<BudgetAccount[]>; // 预算扣减（超限抛错）
}
```

---

## 资源 / 权限 / 预算

```ts
type ResourceRight = 'read' | 'write' | 'execute' | 'grant' | 'admin';

interface ResourceRecord {           // 资源本身
    id; sessionId; kind; uri; generation;
    parentResourceId?; metadata?; createdAt;
}

interface ResourceHandle {           // 资源的某个句柄（带权限）
    id; resourceId; holderTaskId; rights: ResourceRight[];
    generation; parentHandleId?; revokedAt?;
}

interface ResourceSpec {             // 创建资源
    kind; uri; ownerTaskId; rights?: ResourceRight[];
    parentResourceId?; parentHandleId?; metadata?;
}

interface BudgetAccount {            // 预算账户
    resourceId; dimension; hardLimit; used; version; updatedAt;
}
```

---

## 会话数据

```ts
interface SharedStateEntry<T> { key; value: T; version; updatedAt; taskId?; }
interface SharedStateWriteOptions { taskId?; expectedVersion?: number | null; }

interface CrossSessionMessage<T> { id; sourceSessionId; targetSessionId; topic; payload: T; status; createdAt; }

interface ContextCommit<T> { id; sessionId; parentIds: string[]; delta: T; authorTaskId?; createdAt; }
interface ContextBranch { name; version; head?; updatedAt; }
interface ContextCommitOptions { branch?: string; expectedHead?: string | null; parents?: string[]; }
```

---

## 事件与信号

```ts
type TaskSignal = { type: string; payload?: unknown };

interface EventEnvelope {
    sequence: number;       // 会话内单调递增
    sessionId: SessionId;
    taskId?: TaskId;
    type: string;           // e.g. 'task.created' | 'effect.succeeded' | 'budget.consumed' | 'agent.event'
    payload?: unknown;
    occurredAt: number;
}

interface ExitRecord<O = unknown> { taskId; status: 'succeeded'|'failed'|'cancelled'; output?: O; error?: SerializableError; completedAt; }
```

**常用事件名**：`session.created/closing/closed`、`task.created/started/leased/failed/attempt.lost`、`effect.leased/succeeded/failed/attempt.lost`、`budget.configured/consumed`、`task.interaction.requested/resolved`、`session.shared.set/deleted`、`session.message.queued/delivered/received`、`agent.event`（业务流式透传）。

---

## 工具函数

```ts
// 授权断言：校验 context.grants 含指定 handle 的 resource kind + right（默认 execute）
assertEffectGrant(context: EffectExecutionContext, handleId: string, resourceKind: string, right?: ResourceRight): void;

// 统一审批判定：true / {approved:true} / 'yes'|'approved'|'allow'|'true'|'y'|'ok'
interactionApproved(value: JsonValue): boolean;

// 幂等 ID
createId(prefix: string): string;

// 能力绑定（见入口）
bindCapabilities(task: TaskHandle, bindings: CapabilityBinding[], onHandle?): Promise<void>;
```

---

## 错误模型

```ts
enum HarnessErrorCode {
    SESSION_NOT_FOUND, TASK_NOT_FOUND, BUDGET_EXCEEDED, BUDGET_INVALID,
    STALE_EFFECT_CLAIM, HANDLE_LACKS_RIGHT, HANDLE_REVOKED,
    EFFECT_TIMEOUT, EFFECT_CANCELLED, INVALID_SPEC, CONFLICT,
}

class HarnessError extends Error {
    readonly code: HarnessErrorCode;
}

// 用法
try { await session.chargeBudget(handleId, 'tokens', n); }
catch (e) {
    if (e instanceof HarnessError && e.code === HarnessErrorCode.BUDGET_EXCEEDED) { ... }
}
```

---

## 存储

`SeqFileHarnessStore` —— 基于 SeqFile（顺序日志 + snapshot）的持久化实现。所有 Task 状态/事件/effect/resource/budget 落盘，重启后 `Harness.recover()` 恢复（lease 过期任务重新入队）。对外通过 `SessionStorageResolver` 解析到具体 `IModuleFS` 后端（VFS/localFS/IndexedDB/内存）。

---

## 源码结构：文件与路径

`@itookit/harness` 的公共 API 全部从 `packages/harness/src/index.ts` 根导出（`exports['.']` 指向 `src/index.ts`）。包内按 **六层** 组织，依赖单向向下：

```
packages/harness/src/
├── index.ts                      根导出（唯一公共入口）
├── domain/                       纯类型 + 错误模型（无逻辑）
│   ├── types.ts                  SessionId/TaskId/JsonValue、SessionRecord/TaskRecord、
│   │                             TaskSpec/TaskSnapshot/TaskAttempt、ProgramRef/StorageBindingRef、
│   │                             Decision/WaitSpec/KernelAction/TaskInputEvent/RetryPolicy、
│   │                             ResourceRecord/ResourceHandle/ResourceSpec/BudgetAccount、
│   │                             SharedStateEntry/CrossSessionMessage/ContextCommit/ContextBranch、
│   │                             SessionStorageResolver/WorkspaceAdapter 等全部核心类型
│   ├── errors.ts                 HarnessErrorCode 枚举 + HarnessError 类 + harnessError() 工厂
│   └── interaction.ts            InteractionKind/ApprovalDecision、InteractionRequest/Record/Response
├── ports/                        内核向外的契约（注册面）
│   ├── registry.ts               ProgramRegistry / EffectRegistry / StorageResolverRegistry / WorkspaceRegistry
│   └── plugin.ts                 HarnessRegistration（内核能力面）+ HarnessPlugin（装配插件）
├── application/                  内核编排（Harness 主类 + 决策引擎）
│   ├── harness.ts                Harness 主类 + HarnessOptions（入口）
│   ├── capabilities.ts           bindCapabilities() + CapabilityBinding（能力绑定统一入口）
│   ├── decision.ts               状态机核心：transition()/shouldRetry()/retryTask()/validateDecision()
│   │                             以及 normalizeInputEvent()/failureDecision()/terminal()/mergeReport()
│   ├── actions.ts                decisionSideEffects()/prepareSpawns()（副作用与 spawn 展开）
│   ├── effect-utils.ts           normalizeEffect()/addEffect()/addInteraction()/abortError()/
│   │                             effectFailure()/serializeError()/assertEffectGrant()/interactionApproved()
│   ├── durability.ts             assertDurableValue()/inspectDurableValue()（决策 payload 可持久化校验）
│   └── workspace-utils.ts        workspaceContext()/workspaceSnapshot()/assertWorkspace()（快照/合并助手）
├── public/                       对外句柄实现（组合窄接口）
│   ├── session-handle.ts         DefaultSessionHandle（实现 SessionHandle 8 个窄接口）
│   ├── task-handle.ts            DefaultTaskHandle<O>（实现 TaskHandle<O>）
│   └── event-stream.ts           waitForChange()（事件流等待工具）
├── runtime/                      调度运行时（内核内部，不导出）
│   ├── durable-poller.ts         DurablePoller — ready 候选轮询（claimReady→execute→applyDecision）
│   └── lease-heartbeat.ts        LeaseHeartbeat — 任务租约心跳续期
└── infrastructure/seqfile/       SeqFile 持久化实现
    ├── store.ts                  SeqFileHarnessStore（对外存储实现）+ TaskClaim/EffectClaim/
    │                             EffectCompletion/PreparedSpawn/TaskCommitSideEffects
    ├── store-helpers.ts          事务助手：assertClaim/claimTask/finishAttemptTx/writeTaskTx、
    │                             effect 恢复、budget/resource/context/shared 读写 TX、key 构造
    └── seqfile-core.ts           路径/键名函数 + ensureSessionLayout/ensureTaskLayout/ensureSeqFile
```

### SeqFile 持久化路径设定

每个 Session 绑定一个存储根目录（`StorageBindingRef` → `ResolvedStorageBinding.rootPath`，对应一个 `IModuleFS` 目录），布局由 `ensureSessionLayout()` 建立：

```
<rootPath>/
├── catalog.seq        会话目录（全局）：session/<id> → SessionRecord（含生命周期状态）
├── session.seq        会话主记录（SESSION_KEY → 最新 SessionRecord）
├── shared.seq         会话共享状态：value/<key>、head/<key>、history/<key>/
├── context.seq        上下文提交：commit/<id>、branch/<name>（默认 main）
├── messages.seq       跨会话消息：outbox/<id>、inbox/<id>
├── events.seq         会话事件流（EventEnvelope，单调 sequence）
├── graph.seq          Task 依赖图（dependsOn/waiter 关系）
├── resources.seq      资源/句柄/预算：resource/<id>、handle/<id>、budget/<resourceId>/<dimension>
├── index.seq          Task 索引（indexTask）
└── tasks/<taskId>/
    └── task.seq       Task 主日志：attempt/<id>、snapshot/<version>、wait/task/<target>/<waiter>、
                       spawn/<parent>/<key>、workspace/snapshot/<id>、workspace/diff/<id>
```

**键命名规则**（`seqfile-core.ts` 导出的 `*Path()` / `*Key()` 函数）：

| 函数 | 路径 / 键 | 用途 |
|---|---|---|
| `catalogPath(root)` | `catalog.seq` | 全局会话目录 |
| `sessionPath(root)` | `session.seq` | 会话主记录 |
| `sharedPath(root)` | `shared.seq` | 共享状态 |
| `contextPath(root)` | `context.seq` | 上下文提交 |
| `messagesPath(root)` | `messages.seq` | 跨会话消息 |
| `eventsPath(root)` | `events.seq` | 会话事件流 |
| `resourcesPath(root)` | `resources.seq` | 资源/句柄/预算 |
| `indexPath(root)` | `index.seq` | Task 索引 |
| `graphPath(root)` | `graph.seq` | Task 依赖图 |
| `taskPath(root, id)` | `tasks/<id>/task.seq` | 单个 Task 主日志 |
| `attemptKey(id)` | `attempt/<id>` | Task 尝试记录 |
| `snapshotKey(version)` | `snapshot/<16 位补零版本>` | Task 状态快照 |
| `taskWaitKey(targetId, waiterId)` | `wait/task/<target>/<waiter>` | 任务等待注册 |
| `spawnMappingKey(parentId, key)` | `spawn/<parent>/<key>` | spawn 映射 |
| `outboxKey(id)` / `inboxKey(id)` | `outbox/<id>` / `inbox/<id>` | 消息投递 |
| `sharedKey(key)` / `sharedHeadKey(key)` | `value/<key>` / `head/<key>` | 共享值 + 头版本 |
| `sharedHistoryPrefix(key)` | `history/<key>/` | 共享值版本历史 |
| `contextCommitKey(id)` / `contextBranchKey(name)` | `commit/<id>` / `branch/<name>` | 上下文提交/分支 |
| `resourceKey(id)` / `handleKey(id)` | `resource/<id>` / `handle/<id>` | 资源/句柄 |
| `budgetKey(resourceId, dimension)` | `budget/<resourceId>/<dimension>` | 预算账户 |
| `workspaceSnapshotKey(id)` / `workspaceDiffKey(id)` | `workspace/snapshot/<id>` / `workspace/diff/<id>` | 工作区快照/差异 |

**约定**：存储根必须是支持事务性 SeqFile 的 `IModuleFS`（`requireTransactionalSeq` 校验，缺失时报错）；`createSession()` 将会话登记进全局 `catalog.seq`，`openSession()` 从 `session.seq` 读取主记录后按需恢复 `tasks/` 下的 Task。
