# Harness v3：Task Graph、Agent 与状态分离最终架构及一次性迁移方案

> 状态：已完成（TaskGraph v3 已成为唯一运行时与持久化控制平面）  
> 目标版本：v5.0  
> 迁移策略：开发分支内分阶段实现，发布时一次性切换；最终代码不保留双调度、双写或旧 AgentRun 兼容路径  
> 部署前提：单机单进程，允许进程内并行；控制平面可从持久化事件恢复，运行中的 Loop/Tool 不做隐式跨进程续跑

### 当前实施状态（2026-07-23）

已完成并通过 workspace 全量类型检查、`pnpm build:libs`、llm-runtime 构建和 40 项引擎测试：

- v3 contracts、ID parser、FlowRevision 校验/digest、AgentDefinition exact-version registry。
- TaskGraphRun/TaskRun/Attempt、runtime edge state、五种 Join、稳定 multi-input、Route/Transform/Reduce/Human/Subflow/Spawn executor。
- 单写 Reconciler、Artifact commit、Retry/Timeout/Cancel/HITL、Spawn 原子幂等扩图、AgentState CAS/exclusive-update、冷启动 interrupted recovery。
- TaskGraph event JSONL、run/artifact/context/state VFS projection、CommandBus 命令、迁移报告、Context explain projection、Run/Design UI projection。
- direct chat、Flow、Mission、SessionGraph 的生产入口均提交为 TaskGraphRun；Goal 只保留目标元数据，AgentTask 是唯一模型执行节点。
- 已删除旧 `core/goal` 调度器、`AgentRunStore`、`FlowCompiler`、Mission/SessionGraph 旁路 runner、旧 Goal 公共调度类型和旧 GoalGraph UI。
- Reconciler 是唯一调度/重试/暂停/恢复控制回路；TaskGraph event replay、VFS projection、context/artifact/state 单写存储和 CommandBus 已接线。
- 已补充 legacy asset → v3 的幂等迁移 fixture。`task-graph/migration.ts` 仅作为离线迁移工具导出，不注册为运行时兼容路径。

当前不再存在发布前双轨切换项；后续仅是新增 Task kind、schema editor 深度和产品化验收，不改变 v3 运行时边界。

---

## 1. 结论

Harness v3 采用三个正交核心：

1. **Task** 是唯一调度与执行单位，统一承载生命周期、输入输出、Attempt、Retry、HITL、资源限制和运行时扩图。
2. **Agent** 是 AgentTask 使用的不可变、版本化认知能力定义，声明模型、Prompt、Tools、MCP、Memory 和默认 Context 策略。
3. **AgentState** 是跨 Task 持久化的版本化状态，与 AgentDefinition、TaskRun、Conversation history 分离。

其余事实源保持独立：

- Goal 表示为什么执行与最终期望，不作为调度节点。
- FlowRevision 表示可复用、不可变的 Task 图定义。
- TaskGraphRun 表示一次 Flow 的动态运行实例。
- Artifact 是 Task 间唯一默认数据载体。
- ContextSnapshot 是 AgentTask 启动时冻结的模型输入。
- ConversationGraph / Round 只表示用户会话及投影，不承担 Task 依赖。
- Memory 是独立检索与写入域，不等同于 AgentState 或聊天历史。

最终关系：

```text
Goal
  └─ freezes → FlowRevision
                  └─ compiles → TaskGraphRun
                                  ├─ TaskRun(agent)
                                  │    ├─ AgentDefinition@version
                                  │    ├─ AgentState@revision
                                  │    ├─ ContextSnapshot
                                  │    └─ Loop → Round + Artifact
                                  ├─ TaskRun(route)
                                  ├─ TaskRun(transform/reduce)
                                  ├─ TaskRun(human)
                                  └─ TaskRun(spawn/subflow)

TaskGraphRun = TaskRuns + immutable edge definitions + runtime edge states
TaskRun communication = Artifact + explicit control effects
```

---

## 2. 目标与非目标

### 2.1 目标

- 支持 Agent、确定性计算、Route、Human、Reduce、Subflow、Map 和 Spawn 等异构 Task。
- 支持 control/data edge、条件路由、只等待已激活边的 Join、稳定 multi-input 和 Artifact-only 默认传递。
- 支持运行时原子扩图，同时保持 FlowRevision 不可变、运行图无环、扩图幂等。
- 允许插件贡献 Task kind、AgentGroup strategy、表达式、Artifact projector 和编辑器 schema。
- 每次运行可复现：Definition version、AgentState revision、ContextSnapshot、输入 Artifact hash 和插件版本均被冻结。
- 并发安全：同一 Agent 可并发执行，AgentState 写入使用 revision/CAS 或显式独占策略。
- ConversationGraph、TaskGraph、AgentState、Context 和 Memory 不互相充当事实源。
- 一次性删除旧 AgentRun 中心调度模型以及 Mission/SessionGraph 的旁路控制回路。

### 2.2 非目标

- 不序列化 JavaScript closure、AsyncGenerator 栈或活跃 MCP client。
- 不在应用重启后自动重放非幂等工具、运行中的 LLM 请求或等待中的协程。
- 不把每个 Tool Call 默认提升为 Task；只有需要独立调度、恢复或复用结果的工具操作才使用 Tool/External Task。
- 不把 Broadcast、Context Control、Retry 等所有语义都伪装成可执行节点。
- 不允许插件直接修改 Scheduler、TaskGraphRun、AgentState 或 ConversationLog。

---

## 3. 强制架构不变量

1. Scheduler 只调度 `TaskRunId`，不得依赖 Agent 类型。
2. `AgentDefinition`、`FlowRevision`、`ContextSnapshot`、`Artifact` 和 committed Round 创建后不可修改。
3. TaskRun 启动前冻结 Task executor version；AgentTask 额外冻结 AgentDefinition version 和 AgentState revision。
4. Task 间默认只传 Artifact；`summary`、`full-rounds` 或 continuation context 必须显式声明。
5. FlowRevision 不因 Spawn 变化；Spawn 只修改某个 TaskGraphRun。
6. 动态扩图由 Reconciler 通过单写入 `TaskGraphRunStore` 原子执行；Executor 不得直接扩图。
7. Route/Join 读取 runtime edge state，不得仅按声明图的所有 predecessor 状态判断。
8. Multi-input 顺序固定为 `port.order → edge.order → edgeId → artifactId`，不得使用完成时间。
9. AgentState 读取必须冻结 revision，写入必须提交显式 StatePatch；不得共享可变对象。
10. Retry 产生新 TaskAttempt；不得修改旧 Attempt、ContextSnapshot 或 Artifact。
11. 一个 TaskRun 只有一个明确生命周期；Spawn 后的 continuation 必须创建新 TaskRunId。
12. 插件配置必须是 JSON、带 schemaVersion；禁止持久化函数、client、数据库连接和宿主对象。
13. ContextAssembler 只为需要模型上下文的 Executor 服务；非 Agent Task 不创建虚假 ContextSnapshot。
14. Round 只由 Agent/Human 等会话型 Task 产生；Route/Join/Reduce 不创建虚假聊天 Round。
15. TaskGraph event stream 是运行控制平面的事实源；snapshot 和 task JSON 均是可重建投影。

---

## 4. 分层领域模型

```text
定义平面
├── AgentDefinition
├── FlowDraft
├── FlowRevision
├── TaskNodeDefinition
├── TaskEdgeDefinition
└── PluginManifest / schemas

运行平面
├── Goal
├── TaskGraphRun
├── TaskRun
├── TaskAttempt
├── TaskEdgeState
├── TaskEffect
└── Artifact

状态平面
├── AgentStateRevision
├── AgentStatePatch
├── Memory Namespace
└── ContextProfile / ContextSnapshot

会话平面
├── ConversationGraph
├── Round / containment tree
├── Branch Ref
└── UI projection
```

### 4.1 ID 类型

```typescript
type Brand<T, N extends string> = T & { readonly __brand: N };

type GoalId = Brand<string, 'GoalId'>;
type FlowId = Brand<string, 'FlowId'>;
type FlowNodeId = Brand<string, 'FlowNodeId'>;
type FlowRevisionId = Brand<string, 'FlowRevisionId'>;
type TaskGraphRunId = Brand<string, 'TaskGraphRunId'>;
type TaskRunId = Brand<string, 'TaskRunId'>;
type TaskAttemptId = Brand<string, 'TaskAttemptId'>;
type TaskEdgeId = Brand<string, 'TaskEdgeId'>;
type ArtifactId = Brand<string, 'ArtifactId'>;
type AgentId = Brand<string, 'AgentId'>;
type AgentStateRevisionId = Brand<string, 'AgentStateRevisionId'>;
type ContextSnapshotId = Brand<string, 'ContextSnapshotId'>;
type RoundId = Brand<string, 'RoundId'>;
```

所有 VFS、CommandBus、插件和 UI 输入先经过 parser，再进入领域服务。领域内部禁止裸 string 互换不同 ID。

---

## 5. 定义平面

### 5.1 FlowDraft 与 FlowRevision

```typescript
interface FlowDraft {
  id: FlowId;
  draftVersion: number;
  baseRevision?: number;
  name: string;
  nodes: TaskNodeDefinition[];
  edges: TaskEdgeDefinition[];
  layout: FlowLayout;
  updatedAt: number;
}

interface FlowRevision {
  id: FlowId;
  revision: number;
  name: string;
  nodes: TaskNodeDefinition[];
  edges: TaskEdgeDefinition[];
  createdAt: number;
  digest: string;
}
```

规则：

- 只有 Draft 可编辑；Run 只能接收完整校验后的 Revision。
- Revision digest 覆盖节点、端口、边、配置、插件/Agent/executor version，不覆盖画布布局。
- 运行中修改设计必须创建新 Draft/Revision，不覆盖旧 Revision。
- 同一 Revision 重复运行，每次分配新的 TaskGraphRunId 和 TaskRunId。

### 5.2 TaskNodeDefinition

```typescript
type BuiltinTaskKind =
  | 'agent'
  | 'route'
  | 'transform'
  | 'reduce'
  | 'human'
  | 'subflow'
  | 'spawn';

type TaskKind = BuiltinTaskKind | `plugin:${string}`;

interface TaskHandlerRef {
  kind: TaskKind;
  provider: 'builtin' | string;
  version: string;
  schemaVersion: number;
}

interface TaskNodeDefinition {
  id: FlowNodeId;
  name: string;
  handler: TaskHandlerRef;
  inputPorts: InputPortSpec[];
  outputPorts: OutputPortSpec[];
  config: JsonValue;
  joinPolicy: JoinPolicy;
  retryPolicy: RetryPolicy;
  resourcePolicy?: ResourcePolicy;
}
```

Agent 节点的 config：

```typescript
interface AgentTaskConfig {
  agent: { id: AgentId; version: string };
  prompt: string;
  contextPolicy: TaskContextPolicy;
  statePolicy: AgentStatePolicy;
  loopMode: 'chat' | 'loop' | 'harness';
}
```

### 5.3 输入输出端口

```typescript
interface InputPortSpec {
  name: string;
  schema?: JsonSchemaRef;
  cardinality: 'one' | 'many';
  required: boolean;
  order: number;
}

interface OutputPortSpec {
  name: string;
  schema?: JsonSchemaRef;
  required: boolean;
  order: number;
}
```

约束：

- data edge 必须连接兼容端口。
- `cardinality='one'` 最多接受一个激活 data edge。
- `cardinality='many'` 按稳定顺序解析为数组。
- required port 在 Task ready 前必须可满足；路由排除的 optional port 不阻塞。
- Artifact 写入时校验对应 output schema。

### 5.4 Edge 定义

```typescript
interface TaskEdgeDefinition {
  id: TaskEdgeId;
  from: FlowNodeId;
  to: FlowNodeId;
  kind: 'control' | 'data';
  order?: number;

  binding?: {
    outputName: string;
    inputName: string;
    mode: 'artifact' | 'summary' | 'full-rounds';
    required: boolean;
    projector?: ArtifactProjectorRef;
  };

  condition?: RouteCondition;
}
```

禁止把 JavaScript 函数写入 condition。所有表达式使用版本化、可序列化 AST：

```typescript
interface RouteCondition {
  source:
    | { kind: 'status' }
    | { kind: 'artifact'; outputName: string };
  expression: SerializableExpression;
}
```

### 5.5 Join 与 Retry

```typescript
type JoinPolicy =
  | { kind: 'all-success' }
  | { kind: 'all-done'; allowFailed: boolean }
  | { kind: 'any-success' }
  | { kind: 'quorum'; minimum: number }
  | { kind: 'race'; cancelRemaining: boolean };

interface RetryPolicy {
  maxAttempts: number;
  backoff?: { kind: 'none' | 'fixed' | 'exponential'; baseMs?: number; maxMs?: number };
  retryOn?: string[];
  requireConfirmationForNonIdempotent?: boolean;
}
```

`all-success` 是默认策略。第一版产品 UI 可只暴露 `all-success/all-done/any-success`，但内核和持久化一次性支持全部五种。

---

## 6. 运行平面

### 6.1 Goal

```typescript
interface Goal {
  id: GoalId;
  objective: string;
  acceptance?: JsonValue;
  status: 'draft' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  activeGraphRunId?: TaskGraphRunId;
  createdAt: number;
}
```

Goal 不保存可变 scheduler state，也不直接执行 Loop。它关联用户目标、FlowRevision 和最终 Artifact。

### 6.2 TaskGraphRun

```typescript
interface TaskGraphRun {
  id: TaskGraphRunId;
  goalId?: GoalId;
  flow: { id: FlowId; revision: number; digest: string };
  status: 'pending' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
  graphVersion: number;
  nodeRuns: Record<FlowNodeId, TaskRunId[]>;
  rootTaskRunIds: TaskRunId[];
  createdAt: number;
  completedAt?: number;
  limits: GraphRunLimits;
}
```

`nodeRuns` 是一对多，因为 Map/Spawn 可以从一个设计节点生成多个 TaskRun。

### 6.3 TaskRun

```typescript
interface TaskRunSpec {
  id: TaskRunId;
  sourceNodeId?: FlowNodeId;
  handler: TaskHandlerRef;
  inputPorts: InputPortSpec[];
  outputPorts: OutputPortSpec[];
  explicitInputs: InputBinding[];
  config: JsonValue;
  joinPolicy: JoinPolicy;
  retryPolicy: RetryPolicy;
  resourcePolicy?: ResourcePolicy;
}

interface TaskRun {
  id: TaskRunId;
  graphRunId: TaskGraphRunId;
  spec: TaskRunSpec;
  status: TaskRunStatus;
  attempts: TaskAttempt[];
  inputDigest?: string;
  outputArtifactIds: ArtifactId[];
  parentTaskRunId?: TaskRunId;
  spawnKey?: string;
  spawnDepth: number;
  agent?: AgentExecutionRecord;
  createdAt: number;
  completedAt?: number;
}

type TaskRunStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'awaiting_signal'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'skipped';
```

### 6.4 TaskAttempt

```typescript
interface TaskAttempt {
  id: TaskAttemptId;
  number: number;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  startedAt: number;
  completedAt?: number;
  inputDigest: string;
  error?: SerializedError;
  feedbackArtifactId?: ArtifactId;
}
```

Attempt 只追加，不覆盖。Retry 复用 TaskRunId，但生成新 Attempt；人工“重新执行整个节点”可选择创建新 TaskRunId，并记录 `retriesTaskRunId`。

### 6.5 Artifact

```typescript
interface Artifact {
  id: ArtifactId;
  taskRunId: TaskRunId;
  outputName: string;
  type: 'text' | 'json' | 'file' | 'summary' | 'final-answer' | 'control';
  schema?: JsonSchemaRef;
  content: string | JsonValue | BlobRef;
  contentHash: string;
  createdAt: number;
  metadata?: Record<string, JsonValue>;
}
```

Artifact 以 `taskRunId + outputName` 归属，不再要求所有 Artifact 属于 AgentRun。

### 6.6 TaskResult 与 TaskEffect

```typescript
interface TaskResult {
  artifacts: ArtifactDraft[];
  effects?: TaskEffect[];
  roundDraft?: RoundDraft;
}

type TaskEffect =
  | { kind: 'route'; decision: RouteDecision }
  | { kind: 'spawn'; plan: SpawnPlan }
  | { kind: 'agent-state-patch'; patch: AgentStatePatch }
  | { kind: 'await-human'; request: HumanRequest };
```

Executor 返回 Effect；Reconciler 校验并应用。Effect 自身不是事实，成功应用后写入对应 graph/state event。

---

## 7. Agent 与 AgentState

### 7.1 AgentDefinition

```typescript
interface AgentDefinition {
  id: AgentId;
  version: string;
  name: string;
  modelPolicy: ModelPolicy;
  systemPrompt: string;
  capabilityPolicy: {
    toolIds: string[];
    mcpProfileIds: string[];
  };
  memoryPolicy: MemoryPolicy;
  defaultContextPolicy: ContextPolicy;
}
```

AgentDefinition 不持有活跃 Tool/MCP client、Memory DB、ConversationLog 或 AgentState 实例。

### 7.2 AgentStateRevision

```typescript
interface AgentStateRevision {
  id: AgentStateRevisionId;
  agentId: AgentId;
  namespace: string;
  revision: number;
  parentRevision?: number;
  values: Record<string, JsonValue>;
  memoryRefs: string[];
  createdAt: number;
  createdByTaskRunId?: TaskRunId;
  digest: string;
}
```

namespace 必须显式指定：

- `conversation:<conversationId>`：会话内状态。
- `goal:<goalId>`：目标范围状态。
- `project:<projectId>`：项目共享状态。
- `agent:<agentId>`：用户显式授权的全局 Agent 状态。

默认使用 conversation namespace，禁止默认写入全局状态。

### 7.3 StatePolicy

```typescript
type AgentStatePolicy =
  | { mode: 'stateless' }
  | { mode: 'read-snapshot'; namespace: string; revision?: number }
  | { mode: 'fork'; namespace: string; fromRevision?: number; targetNamespace: string }
  | { mode: 'compare-and-swap'; namespace: string; expectedRevision?: number }
  | { mode: 'exclusive-update'; namespace: string; concurrencyKey: string };
```

启动时解析并冻结实际 revision。Task 执行过程中只能产生 patch：

```typescript
interface AgentStatePatch {
  agentId: AgentId;
  namespace: string;
  baseRevision: number;
  operations: StateOperation[];
}
```

提交冲突规则：

- stateless/read-snapshot：禁止写入。
- compare-and-swap：revision 不匹配则 Task 成功但 patch 标记 conflict，由显式 conflict policy 决定 retry/branch/human。
- fork：在 target namespace 创建 revision 1，不影响源 namespace。
- exclusive-update：Scheduler 通过 concurrencyKey 串行化同 namespace 写任务。

MemoryWrite 与 AgentStatePatch 是两种不同 Effect，不得互相替代。

### 7.4 AgentExecutionRecord

```typescript
interface AgentExecutionRecord {
  definition: { id: AgentId; version: string };
  state?: { namespace: string; revision: number; digest: string };
  contextSnapshotId: ContextSnapshotId;
  finalRoundId?: RoundId;
  exchangeCount: number;
}
```

只有 `handler.kind='agent'` 的 TaskRun 可以拥有此字段。

---

## 8. Context 架构

### 8.1 TaskContextPolicy

```typescript
type TaskContextPolicy =
  | { mode: 'isolated' }
  | { mode: 'branch'; branchRef?: string; profileRevision?: number }
  | { mode: 'selected'; baseProfileRevision: number; patch: ContextProfilePatch }
  | { mode: 'continuation'; sourceTaskRunId: TaskRunId };
```

默认是 branch，但只通过 data edges 加入上游 Artifact；不自动继承父 Task 的 trace。

### 8.2 ContextPlan

```typescript
interface ContextPlan {
  taskRunId: TaskRunId;
  agent: { id: AgentId; version: string };
  agentState?: { namespace: string; revision: number };
  conversation?: {
    branchRef: string;
    branchHead: RoundId | null;
    profile: { id: string; revision: number };
  };
  resolvedInputs: ResolvedInputPort[];
  pendingUserMessage?: ChatMessage;
  tokenPolicy: TokenPolicy;
}
```

ContextAssembler 固定顺序：

1. Agent system blocks。
2. branch history/context profile。
3. AgentState 中显式允许进入模型的 blocks。
4. Memory retrieval。
5. 输入端口 Artifact，按稳定顺序。
6. pending user/current input。
7. 按 ContextBlock 边界做预算和压缩。
8. Provider adapter 校验。
9. 保存不可变 ContextSnapshot。

非 Agent Task 不走 ContextAssembler，只记录 resolved input digest。

### 8.3 Context 可解释性

`ContextSnapshot` 增加 explain projection：

```typescript
interface ContextExplanation {
  included: ContextDecision[];
  excluded: ContextDecision[];
  summarized: ContextDecision[];
  tokenCount: number;
  digest: string;
}
```

每个 decision 记录 source、reason、priority、required 和 tokenCount，供 UI 精确解释“为什么此 Task 知道/不知道某内容”。

---

## 9. Route、Broadcast、Join 与 Aggregate

### 9.1 Edge 运行状态

```typescript
interface TaskEdgeState {
  edgeId: TaskEdgeId;
  graphRunId: TaskGraphRunId;
  state: 'pending' | 'activated' | 'satisfied' | 'skipped' | 'failed';
  decidedByTaskRunId?: TaskRunId;
  artifactIds?: ArtifactId[];
  reason?: string;
  updatedAt: number;
}
```

定义 edge 永不修改；运行状态单独记录。

### 9.2 Route

确定性 Route：

```typescript
interface RouteTaskConfig {
  mode: 'exclusive' | 'multicast' | 'fallback';
  rules: Array<{
    edgeId: TaskEdgeId;
    condition: RouteCondition;
    priority: number;
  }>;
  defaultEdgeId?: TaskEdgeId;
}

interface RouteDecision {
  activatedEdgeIds: TaskEdgeId[];
  skippedEdgeIds: TaskEdgeId[];
  reason?: string;
}
```

- exclusive 必须配置 defaultEdgeId。
- multicast 可激活多个边。
- fallback 按 priority 依次激活，当前分支失败后 Reconciler 决定下一分支。
- 语义路由用 AgentTask 生成符合 JSON Schema 的 RouteDecision Artifact，再由 Reconciler 应用。

### 9.3 Broadcast

固定 Broadcast 编译为多条 outgoing edge，不产生 TaskRun。只有需要转换、权限过滤、远端投递确认时才使用独立 Task。

### 9.4 Join readiness

Scheduler 判断 Join：

1. 对尚未被 route 决定的 pending edge，继续等待。
2. 忽略 skipped edge。
3. 对 activated edge 收集 source Task 状态。
4. 应用 JoinPolicy。
5. 检查 required input port 是否满足。
6. 将 data edge 的 Artifact 绑定成稳定排序的 ResolvedInputPort。

`any-success/quorum/race` 可在条件满足后提前 ready；若配置 cancelRemaining，由 Reconciler 取消仍在运行且只服务该 Join 的 Task。

### 9.5 Aggregate/Reduce

- Agent aggregate：普通 AgentTask，many input port 绑定多个 Artifact。
- Deterministic reduce：`reduce` Task，通过注册 reducer 处理 JSON/text/file refs。
- Collect artifacts：编译器生成内置 reduce Task，输出稳定排序的 collection Artifact。
- 禁止默认拼接上游完整 Round/trace。

---

## 10. Map 与 Spawn

### 10.1 Map

Map 是受限动态扩图：从一个 Artifact 数组和一个冻结模板创建多个同构 TaskRun。

```typescript
interface MapTaskConfig {
  sourceInput: string;
  itemSchema?: JsonSchemaRef;
  templateNodeId: FlowNodeId;
  itemInputPort: string;
  concurrency?: number;
  continuationNodeId?: FlowNodeId;
}
```

每个实例 key 从数组索引和 item canonical hash 得出；重试时复用同一 spawnKey 映射。

### 10.2 SpawnPlan

```typescript
interface SpawnPlan {
  spawnKey: string;
  parentTaskRunId: TaskRunId;
  children: SpawnChildSpec[];
  continuation?: SpawnContinuationSpec;
}

interface SpawnChildSpec {
  key: string;
  handler: TaskHandlerRef;
  config: JsonValue;
  inputs: InputBinding[];
  contextPolicy?: TaskContextPolicy;
  statePolicy?: AgentStatePolicy;
}
```

### 10.3 原子扩图

```typescript
interface TaskGraphRunStore {
  applyExpansion(
    graphRunId: TaskGraphRunId,
    expectedGraphVersion: number,
    plan: SpawnPlan,
  ): Promise<AppliedExpansion>;
}
```

事务内固定执行：

1. 检查 spawnKey 是否已应用；已应用时返回原 TaskRunId 映射。
2. 检查 parent 已成功且 plan Artifact hash 匹配。
3. 校验 Task handler/plugin/Agent version。
4. 校验 GraphRunLimits。
5. 为 child key 分配并持久化稳定 TaskRunId。
6. 添加 control/data edges。
7. 若存在 continuation，创建新的 TaskRun；不得恢复 parent。
8. 对扩展图做环检测。
9. 追加 `GraphExpanded` 事件并递增 graphVersion。
10. Scheduler 消费 delta，发布新 ready set。

### 10.4 Limits

```typescript
interface GraphRunLimits {
  maxTasks: number;
  maxSpawnChildrenPerTask: number;
  maxSpawnDepth: number;
  maxConcurrentTasks: number;
  tokenBudget?: number;
  costBudget?: number;
  timeoutMs?: number;
}
```

默认：maxTasks=256、maxSpawnChildrenPerTask=32、maxSpawnDepth=4、maxConcurrentTasks=8。项目/用户可降低；提高需要显式配置。

---

## 11. Scheduler 与 Reconciler

### 11.1 DependencyScheduler

Scheduler 是纯状态机，不调用 Executor、Store、LLM 或 Tool：

```typescript
interface IDependencyScheduler {
  snapshot(): SchedulerSnapshot;
  readyIds(): TaskRunId[];
  start(id: TaskRunId): SchedulerDelta;
  settle(id: TaskRunId, outcome: TaskOutcome): SchedulerDelta;
  decideEdges(decision: RouteDecision): SchedulerDelta;
  applyGraphDelta(delta: GraphDelta): SchedulerDelta;
  cancel(id: TaskRunId): SchedulerDelta;
  finished(): boolean;
  changedAfter(version: number): Promise<SchedulerSnapshot>;
}
```

所有状态迁移幂等，snapshot version 单调递增。Scheduler 构造和 applyGraphDelta 都检查 ID、端口、edge、cycle 和 join 参数。

### 11.2 Reconciler

Reconciler 是控制平面的唯一写入协调者：

```text
load/replay graph state
  → fill concurrency capacity
  → resolve executor by frozen handler ref
  → freeze inputs/state/context
  → create Attempt
  → execute
  → persist Artifacts
  → validate/apply Effects
  → settle TaskRun and edges
  → commit event batch
  → immediately schedule newly ready Tasks
```

强制顺序：Artifact 持久化成功后才能 satisfy data edge；Effect 应用失败则 Attempt 失败，不得把 Task 标为 succeeded。

### 11.3 Resource scheduling

```typescript
interface ResourcePolicy {
  concurrencyKey?: string;
  sideEffect?: 'none' | 'idempotent' | 'non-idempotent';
  timeoutMs?: number;
  priority?: number;
  estimatedCost?: number;
}
```

- 全局 pool 限制总并发。
- graph limit 限制单次运行并发。
- concurrencyKey 防止冲突资源并行写。
- 非幂等 Task retry 前要求幂等键或人工确认。

---

## 12. Executor 与插件系统

### 12.1 TaskExecutor

```typescript
interface TaskExecutor<TConfig extends JsonValue = JsonValue> {
  readonly handler: TaskHandlerRef;
  execute(context: TaskExecutionContext<TConfig>): Promise<TaskResult>;
}

interface TaskExecutionContext<TConfig extends JsonValue> {
  graphRunId: TaskGraphRunId;
  taskRunId: TaskRunId;
  attempt: TaskAttempt;
  config: TConfig;
  inputs: ResolvedInputPort[];
  signal: AbortSignal;
  services: ScopedTaskServices;
}
```

ScopedTaskServices 只提供 allowlisted Artifact read/write draft、Signal、Clock、Logger、AgentRuntimeFactory 等；不暴露可写 GraphStore/Scheduler。

### 12.2 内置 Executors

| kind | executor | 是否 LLM | 产物 |
|---|---|---:|---|
| agent | AgentTaskExecutor | 是 | Round + Artifact + 可选 StatePatch |
| route | DeterministicRouteExecutor | 否 | RouteDecision effect |
| transform | TransformExecutor | 否 | Artifact |
| reduce | ReduceExecutor | 可选插件 | Artifact |
| human | HumanTaskExecutor | 否 | await-human effect / Artifact |
| subflow | SubflowExecutor | 否 | spawn effect + continuation |
| spawn | SpawnPlanExecutor | 可选 | spawn effect |

### 12.3 插件贡献

```typescript
interface HarnessPluginContribution {
  id: string;
  version: string;
  taskKinds?: TaskKindContribution[];
  groupStrategies?: AgentGroupStrategyContribution[];
  expressions?: ExpressionContribution[];
  artifactProjectors?: ArtifactProjectorContribution[];
  views?: TaskViewContribution[];
}

interface TaskKindContribution {
  handler: TaskHandlerRef;
  configSchema: JsonSchema;
  validator: TaskDefinitionValidator;
  compiler: TaskNodeCompiler;
  executor: TaskExecutor;
  migrations?: ConfigMigration[];
  editor?: TaskEditorContribution;
}
```

注册规则：

- 引擎 activate 前完成注册，运行中不可替换 executor。
- 同一 provider/kind/version 只能注册一次。
- FlowRevision 创建时冻结 handler version；执行时 exact resolve，禁止 fallback。
- config schema validation 在 Draft、Revision 和 Run 三个边界执行。
- 插件代码视为进程内可信代码；未来不可信插件必须使用进程/Worker sandbox，不在本次实现中伪装安全。

### 12.4 AgentGroup

AgentGroup 是编译期宏，不是运行期核心类型。Strategy compiler 返回 Task fragment：

- parallel：多个 AgentTask + 可选 aggregate Task。
- sequential：data edge 链 + 可选 final aggregate。
- supervisor/selector/handoff/debate：插件贡献 compiler，可生成 Agent/Route/Human/Subflow 等 Task。
- 未注册 strategy 可查看定义但不能创建 Revision 或 Run。

---

## 13. 事件、持久化与恢复

### 13.1 TaskGraph event stream

```typescript
interface TaskGraphEventEnvelope<T> {
  sequence: number;
  eventId: string;
  occurredAt: number;
  graphRunId: TaskGraphRunId;
  taskRunId?: TaskRunId;
  attemptId?: TaskAttemptId;
  causationId?: string;
  correlationId?: string;
  event: T;
}
```

核心事件：

```typescript
type TaskGraphEvent =
  | { type: 'GraphRunCreated'; flow: FlowRef; limits: GraphRunLimits }
  | { type: 'TaskRunCreated'; task: TaskRunSpec }
  | { type: 'TaskRunReady'; taskRunId: TaskRunId }
  | { type: 'TaskAttemptStarted'; attempt: TaskAttempt }
  | { type: 'TaskAwaitingSignal'; request: HumanRequest }
  | { type: 'ArtifactCommitted'; artifact: ArtifactRef }
  | { type: 'TaskAttemptFinished'; outcome: TaskOutcome }
  | { type: 'TaskRunSettled'; status: TaskRunStatus }
  | { type: 'EdgesDecided'; decision: RouteDecision }
  | { type: 'GraphExpanded'; expansion: AppliedExpansion }
  | { type: 'AgentStatePatchCommitted'; revision: AgentStateRevisionRef }
  | { type: 'GraphRunSettled'; status: TaskGraphRun['status'] };
```

### 13.2 存储布局

```text
<project task module>/
├── definitions/
│   └── flows/<flowId>/
│       ├── draft.json
│       └── revision-<revision>.json
├── runs/
│   └── <taskGraphRunId>/
│       ├── meta.json
│       ├── events.jsonl                 # 运行控制 SSOT
│       ├── snapshots/
│       │   └── snapshot-<sequence>.json # 可重建缓存
│       ├── artifacts/
│       │   └── <artifactId>.json
│       ├── contexts/
│       │   └── <contextSnapshotId>.json
│       └── traces/
│           └── <taskRunId>-<attempt>.jsonl
└── agent-state/
    └── <agentId>/<namespaceHash>/
        ├── revision-<revision>.json
        └── head.json
```

Conversation Round 继续存放在 chat assetdir，通过 graphRunId/taskRunId/roundId 互相引用，不复制 payload。

### 13.3 单写入与原子批次

- 每个 TaskGraphRun 一个 append queue。
- event batch 使用 expected sequence。
- graph expansion 使用 expected graphVersion。
- AgentState head 更新使用 expected revision。
- Artifact/ContextSnapshot 先写不可变文件，再在同一控制事件批次中提交引用。
- 进程崩溃后，未被 event 引用的 immutable asset 视为 orphan，由 GC 延迟清理。

### 13.4 恢复边界

启动时：

1. 从最新 snapshot + events 重建 TaskGraphRun。
2. pending/ready 保持可调度。
3. running/retrying/awaiting_signal 转为 interrupted。
4. 不自动重放 interrupted Task；UI 提供 retry/cancel。
5. 已提交 Artifact、RouteDecision、GraphExpansion 和 State revision 不重复应用。
6. retry 先检查 sideEffect/idempotency policy。

控制平面可恢复；Loop generator、活跃网络请求和工具进程不恢复。

---

## 14. Conversation 与 UI 投影

### 14.1 Conversation 边界

- 用户 SendIntent 创建顶层 interaction Round。
- Flow/TaskGraphRun 只通过引用关联该 Round。
- AgentTask 可生成 child agent Round，写入 containment tree，不移动 branch head。
- Route/Join/Reduce/Spawn 不生成 Round。
- Final Writer/Flow output 将选定 Artifact 投影到顶层 interaction assistant payload。
- 内部 Task trace 默认不进入后续聊天上下文。

### 14.2 Graph UI

Design mode：

- 编辑 FlowDraft、Task nodes、ports、edges、conditions、join/retry/resource policies。
- 插件节点由 schema 驱动 inspector；插件可提供增强 editor，但必须有通用 JSON-schema fallback。
- 校验 handler version、schema、端口、edge、route default、cycle、subflow recursion 和 limits。

Run mode：

- 只读投影冻结 Revision + TaskGraphRun 动态节点。
- 设计节点使用 FlowNodeId；运行节点使用 TaskRunId；Map/Spawn 显示一对多映射。
- Node Drawer 展示 inputs、Attempts、Artifacts、effects、resource usage。
- AgentTask 额外展示 Agent version/state revision/ContextSnapshot/Exchange/Tool trace。
- Edge 展示 pending/activated/satisfied/skipped/failed 以及绑定 Artifact。
- 支持 retry、cancel、respond、查看 spawn lineage；不允许修改运行图结构。

### 14.3 Context UI

Context Drawer 仅在 AgentTask 上出现，提供 preview/freeze/explain。非 Agent Task 显示 resolved input ports 和 inputDigest。

---

## 15. 包与组件最终职责

### 15.1 `packages/common`

- 定义 Task/Flow/Goal/AgentState/Artifact/Context/Event/plugin contracts。
- 删除 AgentRun 中心的 Goal/Scheduler 公共接口。
- 不包含具体 Store、Executor 或 UI 实现。

### 15.2 `packages/llm-runtime`

- `task-graph/`：TaskGraphCompiler、DependencyScheduler、Reconciler、TaskExecutorRegistry。
- `persistence/`：TaskGraphEventStore、TaskGraphSnapshotStore、ArtifactStore、AgentStateStore、FlowDefinitionStore。
- `executors/`：AgentTaskExecutor、Route、Transform、Reduce、Human、Subflow/Spawn。
- `context/`：ContextAssembler、ProviderMessageAdapter。
- `conversation/`：RoundGraphService、RoundLog、branch/context profile。
- `plugins/`：Harness contribution registry 与核心命令。

### 15.3 `packages/llm-harness`

- 提供 AgentTaskExecutor 使用的完整 Loop preset、skills、budget、HITL、tool/MCP middleware。
- 不拥有第二套 DAG、Task scheduler、Agent state store 或 event bus。
- Sub-agent 行为通过 TaskGraph/Spawn 表达，不再维护独立 SubAgentRouter 调度器。

### 15.4 `packages/llm-ui`

- Flow design/run workbench、schema-driven inspector、runtime drawers。
- 不实现 route/join/spawn 业务规则。
- 所有动作通过 CommandBus 调用 engine。

---

## 16. 公共命令与查询接口

```text
flow.draft.load/save/validate
flow.revision.create/get/list
taskGraph.run/start/get/cancel
taskGraph.events.after
taskGraph.retryTask/cancelTask/respond
taskGraph.artifact.get
taskGraph.context.preview/get/explain
taskGraph.agentState.get/diff
taskGraph.spawn.inspect
plugin.taskKinds.list
```

所有 mutation command 接收 expectedVersion/expectedSequence；所有返回值包含新的 version 和 validation issues。

---

## 17. 一次性迁移结果

### 17.1 原则

本次切换已按一次性迁移原则完成：

- 新旧 Scheduler 不并存。
- 不双写 AgentRunStore 与 TaskGraphEventStore。
- 不保留 `Goal.nodes: AgentRunSpec[]` 兼容分支。
- 不保留 `graph`/Mission/SubAgent 的旧控制回路。
- 数据迁移失败则阻止打开运行功能，不静默 fallback。

运行时代码不保留 adapter、fallback 或双写分支。唯一保留的旧格式字段位于 `task-graph/migration.ts` 的局部输入类型中，仅用于离线生成 v3 资产。

### 17.2 类型映射

| 旧类型 | 新类型 |
|---|---|
| GoalDefinition/GoalRevision | FlowDraft/FlowRevision |
| GoalNodeDefinition | TaskNodeDefinition |
| AgentRunSpec | TaskRunSpec(kind='agent') |
| AgentRun | TaskRun + AgentExecutionRecord |
| AgentRunAttempt | TaskAttempt |
| RunEdge | TaskEdgeDefinition + TaskEdgeState |
| AgentRunGraphResult | TaskGraphRunProjection |
| AgentRunStore | TaskGraphEventStore + projections |
| AgentRunGraphRunner | TaskGraphReconciler |
| AgentGroupStrategyRegistry | HarnessContributionRegistry.groupStrategies |
| ExecutorRegistry(ILoop mode) | AgentTask 内部 LoopRegistry；Task 层使用 TaskExecutorRegistry |

### 17.3 数据迁移

迁移器按 asset/session 执行，生成 migration report：

1. GoalRevision 转为 FlowRevision，Agent node 包装为 `handler.kind='agent'`。
2. `outputPorts` 和 edge input/output 转换为端口定义；缺失端口使用 `final/source`，并写 warning。
3. 旧 join string 转为结构化 JoinPolicy：`all-settled → all-done {allowFailed:true}`。
4. AgentRun/Attempt/Artifact 转为一个已结束的 TaskGraphRun event stream。
5. Artifact owner 从 runId 改为 taskRunId，保留原 ID/hash。
6. ContextSnapshot 的旧 owner 字段改为 taskRunId，canonicalMessages/digest 不变。
7. GoalNodeId → TaskRunId 映射写入 TaskGraphRun meta。
8. 旧 running/ready/awaiting_signal 统一迁移为 interrupted。
9. AgentDefinition 不变；不存在版本的定义先计算 canonical hash。
10. 不从旧 AgentRun 推测隐式 AgentState；迁移后默认 stateless/read-snapshot revision 0。

迁移完成后写 `harnessSchemaVersion: 3`。迁移源保留只读备份，直到用户确认或下一个稳定版本；运行时不再读取旧格式。

### 17.4 代码实施顺序

以下 WP 是已完成的实施记录，不再代表待办项。

#### WP-01 Contracts

- 新增所有 v3 类型、parser、JSON schema、事件和命令接口。
- 冻结术语；删除公共层旧 TaskSpec/AgentRun 调度契约。

#### WP-02 Stores

- 实现 FlowDefinitionStore、TaskGraphEventStore、snapshot/replay、ArtifactStore、AgentStateStore。
- 完成 expected sequence/version/CAS 与 migration dry-run。

#### WP-03 Scheduler

- 重写为 TaskRun + runtime edge state。
- 一次实现五种 Join、route decision、stable input resolution、resource locks、applyGraphDelta。

#### WP-04 Executors and plugins

- TaskExecutorRegistry、HarnessContributionRegistry。
- 内置 Agent/Route/Transform/Reduce/Human/Subflow/Spawn executors。
- AgentTaskExecutor 复用 ContextAssembler、Loop、Tool/MCP/Memory。

#### WP-05 Reconciler

- event-sourced continuous capacity runner。
- Artifact commit、Effect apply、Retry、Cancel、HITL、Spawn、StatePatch。
- 冷启动 interrupted recovery。

#### WP-06 Product integrations

- Chat direct send 编译为单 Agent TaskGraphRun。
- Flow send、Goal、Mission、SessionGraph、SubAgent 全部切换到 TaskGraphRun。
- 删除旧 TaskRunner DAG、AgentRunGraphRunner、MissionScheduler 调度和 SubAgentRouter 调度。

#### WP-07 UI

- Task node/edge editor、plugin inspector、Design/Run mode、动态节点、edge state、drawers。
- AgentTask context/state 特化视图。

#### WP-08 Migration and deletion

- 执行全量 migration fixture。
- 删除临时 adapters、旧 stores、旧 commands、旧类型、旧文档声明。
- 更新 C1-C4、API、storage 和 integration chains。

#### WP-09 Cutover

- 全量测试、迁移 dry-run、真实样本校验。
- 单次 schema cutover；失败则整体回滚发布包和数据备份，不运行混合模式。

---

## 18. 明确删除/替换清单

最终状态删除或替换：

- `AgentRunGraphRunner` → `TaskGraphReconciler`。
- `AgentRunStore` → TaskGraph event/projection stores。
- `Goal.nodes: AgentRunSpec[]` → FlowRevision/TaskGraphRun。
- Agent 专用 `DependencyScheduler` → Task/edge-state Scheduler。
- `FlowCompiler` 只输出 AgentRun 的限制 → TaskGraphCompiler。
- `TaskRunner` 中 chat/flow/goal 的多套执行分支 → 单一 TaskGraph submission/mailbox。
- MissionScheduler/GraphOrchestrator 的调度职责。
- SubAgentRouter 的独立递归调度；改为 Spawn/Subflow Task。
- `FlowNodeDefinition` 封闭 kind union；改为 handler registry + schema。
- 任何通过 `config: Record<string, unknown>` 且无 schema/version 的扩展节点。
- 任何直接由 Executor 修改 graph/state/store 的路径。

保留但重新定位：

- Loop：AgentTask 内部推理循环。
- ILoop middleware：AgentTask 能力组合。
- ContextAssembler/ContextProfile/Snapshot：AgentTask context。
- RoundGraphService/RoundLog：ConversationGraph。
- AgentDefinition/Resolver/RuntimeFactory：AgentTask capability。
- Artifact：扩展为所有 Task 的统一输出。
- CommandBus/ExtensionRegistry：升级为 Harness contribution host。

---

## 19. 测试矩阵

### 19.1 Contracts/validation

- branded ID parser 拒绝类型串用。
- 未注册 handler/plugin/version 阻止 Revision/Run。
- config/port/artifact schema 校验。
- self-edge、duplicate edge/node、cycle、端口不兼容、缺失 default route。
- Flow digest 和 Task input digest 稳定。

### 19.2 Scheduler

- all-success、all-done、any-success、quorum、race。
- Join 只等待 activated edges；pending route decision 不提前运行。
- multicast 激活多个分支；exclusive 只激活一个/default。
- stable multi-input 不受完成顺序影响。
- failure、skip、cancel 只传播到依赖路径。
- concurrencyKey、global/graph concurrency limit。
- 状态迁移和 repeated event 幂等，changedAfter 不丢唤醒。

### 19.3 Dynamic graph

- Map 生成固定模板 children。
- SpawnPlan 原子创建 children/edges/continuation。
- 相同 spawnKey retry 不重复建点。
- expected graphVersion 冲突。
- maxTasks/children/depth/concurrency/budget 限制。
- expansion cycle、未知 handler/Agent、无效 Artifact 拒绝且不部分写入。
- parent 不原地恢复，continuation 使用新 TaskRunId。

### 19.4 Agent/State/Context

- exact Agent version，无 fallback。
- 同 Agent 并发 Task 的 ContextSnapshot、Tools、Memory、State revision 隔离。
- stateless/read-snapshot 禁止写；CAS conflict；fork namespace；exclusive lock。
- Artifact-only 默认；full-rounds/continuation 必须显式。
- Context explain 与 canonicalMessages 一致。
- StatePatch/MemoryWrite 与 Task success 的原子/失败语义。

### 19.5 Persistence/recovery

- event sequence/CAS、snapshot replay、orphan asset。
- restart 后 pending/ready 重建，running/awaiting_signal → interrupted。
- 已应用 Route/Spawn/State patch 不重复。
- 非幂等 retry 请求确认。
- 旧数据完整迁移、hash 保持、迁移重复运行幂等。

### 19.6 Plugins

- 注册冲突、缺失版本、schema migration。
- 插件 Executor 无 GraphStore/Scheduler 写权限。
- 插件移除后历史可查看但不可 retry/run。
- schema-driven editor fallback。

### 19.7 UI/E2E

- Design/Run ID 分离；Map/Spawn 一对多投影。
- edge runtime state 和 Artifact binding 可检查。
- Route、Join、Retry、Cancel、HITL 操作。
- AgentTask Context/State drawer；非 Agent Task input digest drawer。
- History 隐藏不影响 TaskGraph 事件、Context 或 AgentState。
- Final Writer 只向 Conversation 提交一个顶层结果，内部 trace 不泄露。

---

## 20. 发布验收标准

1. 全系统只有一个 TaskGraph Scheduler/Reconciler。
2. 所有可执行节点均为 TaskRun；AgentRun 不再作为并行调度事实源。
3. Route/Join 使用 runtime edge state，条件未激活的边不会阻塞。
4. 非 Agent Task 不创建 AgentDefinition、ContextSnapshot 或 Round。
5. AgentTask 冻结 AgentDefinition、AgentState、ContextSnapshot 和输入 hash。
6. Spawn 原子、幂等、受限、无环；continuation 使用新 TaskRunId。
7. Task 间默认只传 Artifact，multi-input digest 跨并发顺序稳定。
8. 插件通过同一 registry 提供 schema/compiler/executor/editor，exact version resolve。
9. ConversationGraph 与 TaskGraph 无双写、无互相冒充依赖。
10. 旧 Goal/AgentRun/Mission/SessionGraph/SubAgent 调度路径已删除。
11. 旧数据迁移报告无错误；重复迁移幂等；失败时不会打开混合运行模式。
12. common、engine、harness、ui 类型检查、单元、集成、迁移和 E2E 测试全部通过。

---

## 21. 最终架构结论

Harness v3 的稳定边界是：

> Goal 管目标，FlowRevision 管不可变 Task 图定义，TaskGraphRun 管一次动态执行，TaskRun 管统一生命周期，TaskExecutor 管具体执行方式，AgentDefinition 管认知能力，AgentStateRevision 管显式持久状态，ContextSnapshot 管 AgentTask 的冻结模型输入，Artifact 管 Task 间数据，Reconciler 管 Effect 和扩图，Scheduler 管 readiness，Round 管用户会话。

该架构允许未来新增 HTTP、Shell、Code、Database、Approval、Remote Worker、Streaming Reduce 等 Task，而不污染 Agent 语义；也允许 Agent 能力、状态、上下文和 Memory 独立演进。一次性迁移完成后，系统不再以 AgentRun 作为万能节点，也不需要为每一种新能力增加一套调度器。
