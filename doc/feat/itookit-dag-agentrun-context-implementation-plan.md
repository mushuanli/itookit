# itookit Chat / Harness DAG、AgentRun 与上下文控制最终实施方案

> 方案版本：1.2  
> 适用分支：v4.2 及后续版本  
> 运行前提：单机单进程；允许进程内并行 AgentRun/工具调用  
> 当前恢复边界：支持同进程 HITL pause/resume；不支持应用重启后续跑未完成 AgentRun

### 实施状态（2026-07-20）

| 能力 | 状态 | 当前实现边界 |
|---|---|---|
| ConversationGraph / RoundGraphService | 已完成（基础） | `parents` lineage、branch ref、`children` 索引、软删除和 branch context profile pointer 已持久化。 |
| 层级 Round 内容树 | 已完成（持久化） | `containerRoundId` 与 `containmentChildren` 已和 lineage 分离；HistoryView 的子 Round 树投影仍待接入 FlowRun。 |
| 单 Round LLM history 控制 | 已完成 | Navigator 直接按 `roundId` include/exclude；规则写入当前 branch 的 copy-on-write ContextProfile，`RoundLog.fold()` 在下一次请求读取规则。 |
| ChatInput SendIntent | 已完成（Agent 路径） | `continue/fork × persistent/temporary × agent/flow` 已建模；fork 与 temporary 已生效。 |
| Hide/Show History View | 已完成 | 纯 workspace 可见性偏好，与 LLM context 无关；Navigator 的 `LLM History` 是另一个真正的 context 控制。 |
| GoalDraft / DAG Designer | 已完成（设计编辑） | Agent 节点、边、校验和 revision 草稿已具备；AgentGroup 的 UI 编辑器尚未完成。 |
| Flow / AgentGroup 类型 | 已完成（领域模型） | `FlowDefinition`、`AgentGroupDefinition`、`FlowRunBinding` 已定义。 |
| FlowRun / AgentGroup 调度器 | 未完成 | 还没有注册可执行的 Flow executor；选择 flow 不应被宣传为可运行 DAG。 |
| ContextAssembler / Snapshot 主路径 | 部分完成 | 存储与 assembler 已存在；当前生产 chat 路径仍由 profile-aware `RoundLog.fold()` 供给 Loop，尚未以 ContextSnapshot 取代它。 |

---

## 1. 方案目标

本方案解决以下问题：

1. Chat 支持分支、编辑、重新生成以及 branch 级持续上下文控制。
2. Harness 支持以 AgentRun 为调度单位的 DAG。
3. 一个 AgentDefinition 统一声明自己的模型、tools、MCP、memory 和默认上下文策略。
4. 下游 AgentRun 默认只接收上游最终 Artifact，不自动继承完整执行历史。
5. 上下文选择具有确定作用域，可复现某个回答实际看到的全部输入。
6. 保留现有 Log / Loop / Channel / Goal 四原语，不增加竞争性的调度器或事实源。
7. 修复现有 Round、branch、fold、checkpoint 和 scheduler 中已经确认的正确性问题。

本方案不追求把所有关系放入同一张 DAG。系统明确维护两种不同的图：

- ConversationGraph：Round、branch、regenerate、edit 和聊天导航。
- AgentRunGraph：AgentRun 的执行依赖与数据传递。

模型上下文不是第三张可变业务图，而是 ContextAssembler 根据不可变来源生成的 ContextSnapshot。

### 1.1 Round 的层级模型（v1.1）

Round 现在有两种独立关系：

* `parents` 是对话 lineage。它决定 branch、fork、regenerate 和默认主线折叠顺序。
* `containerRoundId` 是内容 containment。一个顶层 `interaction` Round 可以包含多个 `agent`、`group` 或更小的 `interaction` 子 Round，形成内容树；它不能改变 lineage。

因此同一个子 Round 可以沿一个 branch 依赖上一个 Round，同时显示在另一个交互 Round 的展开树内。持久化层分别维护 `children` 与 `containmentChildren` 两个索引，禁止用一个索引同时表达两种语义。

目标 UI 是默认只显示顶层 interaction，展开后显示其子 Round 树；当前已完成该树的持久化索引和查询 API，HistoryView 的树形投影待 FlowRun 产生真实 child Round 后接入。DAG/Flow 编辑器只显示算法定义，不把运行时 Round 树伪装成可编辑 DAG。

### 1.2 ChatInput 是一次 SendIntent

ChatInput 的四个选择是正交的：

| 维度 | 选择 | 语义 |
|---|---|---|
| branch | `continue` / `fork` | 沿当前 head 继续，或从指定/base head 建立新 branch |
| retention | `persistent` / `temporary` | 是否把本次顶层 interaction（含 subtree）加入后续模型上下文 |
| execution | `agent` / `flow` | 直接调用 Agent，或冻结一个 Flow revision 后调用 |

这组选择在发送时归一化为 `SendIntent`，并随任务保存；旧 `historyPolicy` 只作为兼容字段。`temporary` 不删除 UI 内容，只给顶层 Round 设置 subtree exclude 规则。删除、隐藏、从未来上下文排除、branch rebase 和物理 GC 是五个不同操作。

### 1.3 Flow 与运行绑定

`FlowDefinition` 是可复用的算法平面：节点可以是 Agent、AgentGroup、router、join、human 或 output，边只描述控制/数据依赖。`AgentGroupDefinition` 是一等节点，显式声明 strategy（parallel/sequential/supervisor/selector/handoff/debate）、context isolation、aggregation 和 termination。

Flow 不保存 branch head。发送时创建 `FlowRunBinding`，冻结 flow revision、branch ref/head、context profile revision 和显式 round 输入。这样同一 Flow 可在多个对话 branch 上复用，运行中的 Flow revision 也不会被编辑器修改。

当前代码落地边界：`FlowDefinition`、`AgentGroupDefinition`、`FlowRunBinding`、`SendIntent` 和 Flow 校验已进入 common；RoundGraphService 已分别持久化 lineage/containment 索引；ChatInput 已能提交 flowId、fork 和 temporary 选项。完整的 FlowRun 调度器仍应复用 AgentRun dependency scheduler，并作为独立 executor 注册后再开放生产入口。当前没有可执行 Flow executor，故 Flow UI/文档不得承诺已可运行多 Agent DAG。

---

## 2. 已确认的产品决策

| 决策 | 最终结论 |
|---|---|
| Round 粒度 | 一次用户发起的完整交互，内部可以包含多次 assistant/tool exchange |
| Harness 调度单位 | 产品层为 Agent；工程层实际调度 AgentRun |
| AgentDefinition | 可复用、可版本化配置，不是一次执行实例 |
| 上下文规则作用域 | 修改后持续影响当前 branch 的后续 AgentRun |
| branch 规则继承 | 创建 branch 时继承当前 profile revision；之后 copy-on-write，父 branch 后续修改不影响已有子 branch |
| 运行中修改上下文 | AgentRun 启动时冻结 ContextSnapshot；修改从下一个 AgentRun 生效 |
| Agent 间默认传递 | 只传最终 Artifact；完整 trace 必须显式选择 |
| 部署模式 | 单机单进程，但允许 Promise 并行，因此仍需单写入约束和状态幂等 |
| 跨重启恢复 | 当前版本不续跑中断 AgentRun；重新加载历史并将任务标记为 interrupted，可手动 retry |
| DAG 编辑边界 | UI 编辑 GoalDraft；开始执行时冻结为 Goal revision。运行中的 revision 不允许原地增删节点或边，修改必须另存新 revision |
| History View 隐藏 | 仅是 workspace 视图偏好，不等同于 fold、context exclude 或删除；隐藏期间事件和执行继续处理 |

---

## 3. 四原语的最终职责

### 3.1 Log

Log 只负责 ConversationGraph：

- 不可变 committed Round；
- branch refs；
- 可重建 children 索引；
- display projection；
- RoundDraft 完成后的原子 append。

Log 不负责：

- AgentRun DAG 调度；
- 把全部 DAG ancestors 拓扑排序后发送给模型；
- Agent memory 检索；
- Provider 特定消息清洗；
- 决定 UI 如何编辑 branch 上下文规则；规则由 `ContextProfileStore` copy-on-write 保存，`RoundLog.fold()` 只读取当前 branch 指针后的有效规则。

### 3.2 Loop

Loop 执行一个 AgentRun 内部的推理循环：

- 多次 LLM Exchange；
- assistant tool_calls；
- Tool/MCP 执行；
- middleware；
- 进程内 HITL；
- 生成一个完整 Round 和最终 Artifact。

### 3.3 Channel

Channel 负责：

- 用户 send、abort、inject、respond、navigate；
- 流式内容事件；
- Round/Exchange/Tool/AgentRun 状态事件；
- Context profile 变更事件；
- UI 纯投影。

### 3.4 Goal

Goal 负责 AgentRun DAG：

- AgentRunSpec；
- control/data typed edges；
- DependencyScheduler；
- join policy；
- retry、predicate 和失败传播；
- aggregator AgentRun。

Goal 不使用 Round.parents 表示 Agent 依赖。

---

## 4. 统一术语与强制不变量

### 4.1 术语

| 名称 | 含义 |
|---|---|
| Round | 一次用户发起的完整 user → assistant/tool → final assistant 交互 |
| Exchange | Round 内的一次 LLM 请求与响应 |
| Step | model、tool、MCP、memory retrieval、HITL 等单个执行步骤 |
| AgentDefinition | Agent 的版本化能力配置 |
| AgentRun | AgentDefinition 的一次逻辑执行 |
| AgentRunAttempt | AgentRun 的一次实际尝试；retry 会产生新 attempt |
| Artifact | AgentRun 对外传递的不可变结果 |
| BranchContextProfile | 当前 branch 持续生效的上下文规则 |
| ContextSnapshot | AgentRun 启动时冻结的实际模型输入 |

### 4.2 不变量

实现和测试必须保证：

1. committed Round 的 payload、parents 和默认上下文属性不可修改。
2. Round.parents 中只能保存真实 RoundId，不能保存 RefName。
3. `parents[0]` 是 ConversationGraph 的 primary parent。
4. Tool result 必须与同一 Exchange 中的 assistant tool_call 成组保留或成组排除。
5. ContextSnapshot 创建后不可变。
6. 同一个 ContextSnapshot 的 canonical messages 和 digest 必须稳定。
7. AgentRun 必须冻结 AgentDefinition version。
8. Harness 精确解析 AgentDefinition；不得在定义缺失时静默换成 Default Agent。
9. DependencyScheduler 的状态迁移必须幂等。
10. branch ref、branch context profile pointer 和 Round append 只能通过各自单写入服务修改。
11. UI message ID 与 RoundId 分离，但每个 UI 节点必须携带确定的 RoundId。
12. 自动上下文压缩不能偷偷修改 BranchContextProfile。

---

## 5. 核心类型设计

### 5.1 Branded IDs

首先消除所有业务 ID 都是裸 string 的问题：

```typescript
type Brand<T, N extends string> = T & { readonly __brand: N };

export type RoundId = Brand<string, 'RoundId'>;
export type RefName = Brand<string, 'RefName'>;
export type AgentId = Brand<string, 'AgentId'>;
export type AgentRunId = Brand<string, 'AgentRunId'>;
export type GoalId = Brand<string, 'GoalId'>;
export type GoalDefinitionId = Brand<string, 'GoalDefinitionId'>;
export type GoalNodeId = Brand<string, 'GoalNodeId'>;
export type ArtifactId = Brand<string, 'ArtifactId'>;
export type ContextProfileId = Brand<string, 'ContextProfileId'>;
export type ContextSnapshotId = Brand<string, 'ContextSnapshotId'>;
export type CheckpointId = Brand<string, 'CheckpointId'>;
```

所有持久化入口通过解析函数把 string 转为 branded ID，并执行存在性校验。

### 5.2 committed Round

```typescript
export interface Round {
    id: RoundId;

    /** parents[0] 是聊天主线 parent；额外 parent 只用于显式聊天 merge。 */
    parents: RoundId[];

    /** 内容树父节点；不是 branch lineage edge。 */
    containerRoundId?: RoundId;
    kind?: 'interaction' | 'agent' | 'group';
    producedByRunId?: AgentRunId;
    producedByFlowRunId?: string;
    exposure?: 'public' | 'internal' | 'artifact';

    /** 完整原子交互：[user, assistant(tool_calls), tool..., assistant(final)] */
    payload: ChatMessage[];

    meta: RoundMeta;
    result?: RoundResult;
}

export interface RoundMeta {
    createdAt: number;
    origin: 'loop' | 'merge' | 'rebase' | 'edit' | 'user';
    usage?: TokenUsage;
    producedByRunId?: AgentRunId;

    /** 创建时的不可变默认值；用户事后修改写入 BranchContextProfile。 */
    defaultContextMode?: 'include' | 'exclude';

    stale?: boolean;
    rebasedFrom?: RoundId;
}
```

删除或弃用：

- `RoundMeta.assembly`：merge 策略属于创建 merge output 的操作，不属于后续 fold。
- 可变 `historyPolicy`：迁移为 `defaultContextMode`。
- Round 内 `summary`：summary 必须引用持久化 Artifact。

### 5.3 RoundDraft

```typescript
export interface RoundDraft {
    id: RoundId;
    branchRef: RefName;
    expectedParentId?: RoundId;
    runId: AgentRunId;
    userMessage: ChatMessage;
    createdAt: number;
    status: 'streaming' | 'awaiting_signal' | 'failed';
}
```

RoundDraft 是内存/瞬时 UI 状态，不是 committed Round 文件。AgentRun 成功后一次性生成完整 Round 并 append。

### 5.4 RoundManifest 与 BranchMeta

```typescript
export interface RoundManifest {
    schemaVersion: 3;
    rootRoundId?: RoundId;

    branches: Record<RefName, RoundId | null>;
    branchMeta: Record<RefName, BranchMeta>;

    currentBranch: RefName;

    /** 迁移期兼容字段；最终由 branches[currentBranch] 推导。 */
    currentHead?: RoundId;

    /** 派生索引，可扫描 Round.parents 重建。 */
    children: Record<RoundId, RoundId[]>;

    /** 内容树索引；可扫描 Round.containerRoundId 重建。 */
    containmentChildren?: Record<RoundId, RoundId[]>;
}

export interface BranchMeta {
    createdAt: number;
    createdFrom: 'regenerate' | 'manual' | 'edit';
    forkedFromBranch?: RefName;
    sourceRoundId?: RoundId;
    commonHeadId?: RoundId;
    branchRootRoundId?: RoundId;

    contextProfile: {
        id: ContextProfileId;
        revision: number;
    };
}
```

### 5.5 BranchContextProfile

Profile 是不可变版本对象。branch 只移动 profile pointer。

```typescript
export interface BranchContextProfile {
    id: ContextProfileId;
    revision: number;
    createdAt: number;

    rules: Record<RoundId, ContextRule>;
}

export type ContextRule =
    | { mode: 'include'; scope?: 'node' | 'subtree' }
    | { mode: 'exclude'; scope?: 'node' | 'subtree' }
    | { mode: 'summary'; artifactId: ArtifactId; scope?: 'node' | 'subtree' };
```

当前已实现 Navigator → `session.context.set` → ContextProfile 新 revision → `RoundLog.fold()` 的 include/exclude 路径。Navigator 以 `roundId` 操作：同一 Round 的 user/assistant 两个显示项共用一条规则；`summary`、token 预览与历史 ContextSnapshot 查看仍待完成。

有效规则：

```typescript
effectiveMode =
    profile.rules[round.id]
    ?? round.meta.defaultContextMode
    ?? 'include';
```

copy-on-write 流程：

1. 新 branch 初始指向来源 branch 当前 profile revision。
2. 当前 branch 第一次修改时，基于旧 profile 创建新 revision。
3. 原子更新当前 branch 的 profile pointer。
4. 其他 branch 仍指向旧 revision。

### 5.6 ContextPlan、ContextBlock 与 ContextSnapshot

```typescript
export interface ContextPlan {
    branchRef: RefName;
    branchHead: RoundId | null;
    profile: { id: ContextProfileId; revision: number };

    pendingUserMessage: ChatMessage;
    explicitInputs: InputBinding[];
    tokenBudget?: number;
}

export type ContextBlock =
    | { kind: 'round'; roundId: RoundId; messages: ChatMessage[] }
    | { kind: 'summary'; sourceRoundIds: RoundId[]; artifactId: ArtifactId }
    | { kind: 'artifact'; artifactId: ArtifactId; label: string }
    | { kind: 'memory'; entryId: string; namespaceId: string; contentHash: string }
    | { kind: 'system'; source: 'agent' | 'skill' | 'runtime'; content: string };

export interface ContextSnapshot {
    id: ContextSnapshotId;
    runId: AgentRunId;
    createdAt: number;

    branchRef: RefName;
    branchHead: RoundId | null;
    profile: { id: ContextProfileId; revision: number };
    agent: { id: AgentId; version: string };

    blocks: ContextBlock[];
    canonicalMessages: ChatMessage[];
    tokenCount: number;
    digest: string;
}
```

当前 Round 仍存在可变操作的迁移期内，ContextSnapshot 必须保存完整 `canonicalMessages`；等 committed Round 完全不可变后，仍建议保留 canonical messages 以便调试和审计。

### 5.7 AgentDefinition

```typescript
export interface AgentDefinition {
    id: AgentId;
    version: string;
    name: string;
    description?: string;

    modelPolicy: {
        connectionId: string;
        modelName?: string;
        modelTier?: ModelTier;
        temperature?: number;
        thinking?: boolean;
        reasoningEffort?: string;
    };

    systemPrompt: string;

    capabilityPolicy: {
        toolIds: string[];
        mcpProfileIds: string[];
    };

    memoryPolicy: {
        namespaceId: string;
        readScopes: string[];
        writeScopes: string[];
        retrievalLimit?: number;
    };

    defaultContextPolicy: {
        tokenBudget?: number;
        automaticCompression?: boolean;
    };
}
```

第一阶段如果持久化格式没有 version，可使用 canonical JSON 的 SHA-256 作为 version。

### 5.8 AgentRun、Attempt 与 Artifact

```typescript
export interface AgentRunSpec {
    id: AgentRunId;
    agent: { id: AgentId; version: string };
    prompt: string;
    mode?: string;
    inputs: InputBinding[];
    predicate?: PredicateRef;
    joinPolicy?: 'all-success' | 'all-settled' | 'any-success';
    maxRetries?: number;
    canParallel?: boolean;
}

export type InputBinding =
    | { kind: 'artifact'; artifactId: ArtifactId; label: string; order: number }
    | { kind: 'upstream-output'; runId: AgentRunId; outputPort: string; inputLabel: string; order: number }
    | { kind: 'round'; roundId: RoundId; label: string; order: number }
    | { kind: 'text'; content: string; label: string; order: number };

export interface RunEdge {
    from: AgentRunId;
    to: AgentRunId;
    kind: 'control' | 'data';
    outputPort?: string;
    inputPort?: string;
    order?: number;
}

export interface AgentRun {
    id: AgentRunId;
    goalId?: GoalId;
    spec: AgentRunSpec;

    status:
        | 'pending'
        | 'ready'
        | 'running'
        | 'awaiting_signal'
        | 'succeeded'
        | 'failed'
        | 'interrupted'
        | 'cancelled'
        | 'skipped';

    branchRef?: RefName;
    branchHead?: RoundId | null;
    contextProfile?: { id: ContextProfileId; revision: number };
    contextSnapshotId?: ContextSnapshotId;

    attempts: AgentRunAttempt[];
    finalRoundId?: RoundId;
    outputArtifactIds: ArtifactId[];
}

export interface AgentRunAttempt {
    attempt: number;
    startedAt: number;
    completedAt?: number;
    status: 'running' | 'succeeded' | 'failed' | 'cancelled';
    feedback?: string;
    error?: SerializedError;
}

export interface Artifact {
    id: ArtifactId;
    runId: AgentRunId;
    type: 'final-answer' | 'summary' | 'file' | 'json' | 'text';
    content: string | Record<string, unknown>;
    contentHash: string;
    createdAt: number;
    metadata?: Record<string, unknown>;
}
```

---

## 6. ContextAssembler 设计

> 实施状态：`ContextAssembler`、ContextProfileStore 和 ContextSnapshotStore 已存在，并已支持默认 exclude；但生产 Chat Loop 目前仍通过 profile-aware `RoundLog.fold()` 取得消息，尚未把第 13 步切换为 ContextSnapshot 主路径。下述第 6.2 节是目标架构，不应误读为全部已投入生产。

### 6.1 输入

```typescript
interface AssembleContextRequest {
    run: AgentRun;
    agent: AgentDefinition;
    plan: ContextPlan;
}
```

### 6.2 固定流水线

ContextAssembler 必须按照确定顺序执行：

1. 使用提交任务时冻结的 branchRef、branchHead，沿 `parents[0]` 收集主线 Round。
2. 读取指定 BranchContextProfile revision。
3. 应用 Round 默认策略与 branch override。
4. 将每个 Round.payload 作为原子 protocol group；不得拆散 tool_call/tool_result。
5. 将 summary rule 替换为已经存在的 Summary Artifact；不得在 assemble 时临时调用 LLM。
6. 按 InputBinding.order 加入上游最终 Artifact。
7. 按 AgentDefinition.memoryPolicy 检索 memory，并记录 entry ID 与 hash。
8. 加入 Agent system prompt、skills/runtime system blocks。
9. 加入 pending user message 和附件 Artifact。
10. 按 ContextBlock 粒度执行 token budget 与自动压缩。
11. 由 ProviderMessageAdapter 做角色顺序、tool protocol 和 provider 限制校验。
12. 持久化 ContextSnapshot。
13. 将 ContextSnapshot 交给 Loop；Loop 不再直接调用 `log.fold()`。

### 6.3 手动 summary 与自动压缩必须分开

- 手动 `summary`：branch 规则，持续生效，必须引用持久化 Summary Artifact。
- 自动压缩：只影响当前 ContextSnapshot，不修改 BranchContextProfile。
- 自动压缩产生的摘要也保存为 Artifact，并记录 source RoundIds、模型与 prompt version。

### 6.4 ProviderMessageAdapter

从 `RoundLog.fold()` 删除以下 Provider 逻辑：

- 删除尾部 assistant；
- 任意连续角色清洗；
- 对消息裸 slice；
- Anthropic/OpenAI 特有约束。

Adapter 在 pending user 已加入后执行最终验证。验证失败必须抛出明确错误，不能 `catch { return [] }`。

---

## 7. ConversationGraph 操作语义

### 7.1 普通发送

1. UI 读取当前 branchRef/head/profile revision。
2. 预分配 RoundId 和 AgentRunId。
3. 创建 RoundDraft 和稳定 UI view IDs。
4. 创建 AgentRun，冻结 branch/profile/agent version。
5. ContextAssembler 生成 ContextSnapshot。
6. Loop 执行 exchanges/tools。
7. 成功后生成完整 committed Round。
8. RoundLog 以 expectedParentId 校验并 append。
9. ref 移动到新 Round。
10. 生成 final-answer Artifact。
11. 删除 RoundDraft，UI 用 committed projection 覆盖流式状态。

如果 expectedParentId 与当前 branch head 不一致，必须报告 branch head conflict，不可静默追加到新 head。

### 7.2 Regenerate

1. 找到源 Round 与 primary parent。
2. 新建 branch，ref 初始指向 primary parent。
3. branch 继承来源 branch 的 context profile pointer。
4. 创建包含原 user 内容的 RoundDraft。
5. 运行 AgentRun。
6. 成功后 append 新 sibling Round 并移动新 branch ref。

不创建 user-only committed Round，不调用 `setAssistantInRound()`。

### 7.3 Edit + rerun

1. 找到原 Round 的 primary parent。
2. 新建 branch，ref 指向 primary parent。
3. 创建包含 edited user 内容的 RoundDraft。
4. 运行 AgentRun。
5. append 新 sibling Round。

禁止以原完整 Round 为 parent，否则旧回答会进入新上下文。

### 7.4 手动创建 branch

- 从 assistant 气泡创建：新 ref 指向当前完整 Round，不复制内容。
- 从 user 气泡创建 alternate response：等价于 regenerate，ref 指向原 Round primary parent，创建 user RoundDraft。
- `copyContent` 选项必须明确实现或删除，不能保留无效参数。

### 7.5 删除

默认操作只影响当前 branch：

- 删除 branch 尾部：移动 ref 到 parent。
- 删除中间 Round：创建新的 rebase lineage；旧 lineage 保留。
- 删除 assistant 但保留 user：创建 alternate-response branch/RoundDraft，不修改 committed Round。
- 全局对象删除仅用于垃圾回收：Round 无任何 ref 可达且无其他业务引用时才允许。

不得在普通 UI 操作中直接 `_deleted=true` 并级联删除共享 DAG descendants。

### 7.6 聊天 merge

Harness Agent 汇总不使用 `RoundLog.merge()`。

若保留聊天 merge：

1. 把 refs 解析为真实 head RoundIds。
2. 指定 `parents[0]` 为 mainline。
3. 创建 aggregator AgentRun。
4. 每条支线只把最终 Artifact/显式选择内容交给 aggregator。
5. merge Round.payload 只保存本次新输入与 aggregator 新输出，不复制完整支线历史。

---

## 8. AgentRun DAG 调度

### 8.1 Goal 结构

```typescript
export interface Goal {
    id: GoalId;
    definition: { id: GoalDefinitionId; revision: number; digest: string };
    nodes: AgentRunSpec[];
    edges: RunEdge[];
    nodeRuns: Record<GoalNodeId, AgentRunId>;
}
```

`Goal` 是某次执行的实例。Scheduler 使用 control edge 和 data edge 共同计算 ready；data edge 除了形成依赖，还生成下游 InputBinding。若 data edge 不形成依赖，下游可能在上游 Artifact 产生前启动，因此禁止把它当作纯展示连线。

Harness UI 不直接修改上述运行对象。增加可编辑定义与冻结 revision：

```typescript
export interface GoalNodeDefinition {
    id: GoalNodeId;
    agent: { id: AgentId; version?: string };
    prompt: string;
    mode?: string;
    inputs: GoalInputBinding[];
    joinPolicy?: 'all-success' | 'all-settled' | 'any-success';
    maxRetries?: number;
    canParallel?: boolean;
}

export type GoalInputBinding =
    | Exclude<InputBinding, { kind: 'upstream-output' }>
    | { kind: 'upstream-output'; nodeId: GoalNodeId; outputPort: string; inputLabel: string; order: number };

export interface GoalDefinitionEdge {
    from: GoalNodeId;
    to: GoalNodeId;
    kind: 'control' | 'data';
    outputPort?: string;
    inputPort?: string;
    order?: number;
}

export interface GoalDraft {
    id: GoalDefinitionId;
    baseRevision?: number;
    name: string;
    nodes: GoalNodeDefinition[];
    edges: GoalDefinitionEdge[];
    updatedAt: number;
}

export interface GoalRevision {
    id: GoalDefinitionId;
    revision: number;
    name: string;
    nodes: GoalNodeDefinition[];
    edges: GoalDefinitionEdge[];
    createdAt: number;
    digest: string;
}
```

规则：

- 节点/边管理只写 GoalDraft；保存或 Run 时统一校验并生成不可变 GoalRevision。
- AgentRun 必须记录 `goalId + goalRevision`，运行图永远投影被冻结的 revision。
- 删除节点与其 incident edges 必须在一次事务中完成，并返回删除摘要供 UI undo；不得留下 dangling edge。
- 已启动的 GoalRevision 只允许 retry、cancel、HITL response 等运行控制，不允许结构编辑。
- 从历史 revision 修改时创建新 draft，不覆盖旧 revision，保证运行可复现。
- Run 时为每个 GoalNodeId 分配全新的 AgentRunId，并把 definition edge 转为 RunEdge；再次运行同一 revision 不复用任何 AgentRunId。
- Goal 保存 `nodeRuns` 映射，UI 用 GoalNodeId 保持布局/选择稳定，用 AgentRunId 订阅本次运行状态。

### 8.2 DependencyScheduler API

```typescript
interface IDependencyScheduler {
    readyIds(): AgentRunId[];
    start(id: AgentRunId): void;
    succeed(id: AgentRunId): void;
    fail(id: AgentRunId, error: SerializedError): void;
    cancel(id: AgentRunId): void;
    snapshot(): SchedulerSnapshot;
    finished(): boolean;
    changedAfter(version: number): Promise<SchedulerSnapshot>;
}
```

强制规则：

- 构造图前先验证全部 node ID 唯一、from/to 存在、无 self-edge。
- Kahn 只负责拓扑与环检测。
- `complete/succeed` 重复调用不得重复递减依赖。
- `readyIds()` 返回 ID，不返回伪造 GoalNode。
- snapshot 带单调递增 version，消除 lost wakeup。
- join policy 决定失败传播，不能硬编码所有 dependent 都 skipped。

### 8.3 Reconciler 执行模型

不能按批次 `Promise.allSettled(allReady)` 后才再次调度。使用持续填充容量：

```typescript
while (!scheduler.finished()) {
    while (running.size < maxConcurrent) {
        const next = scheduler.readyIds().find(id => !running.has(id));
        if (!next) break;
        scheduler.start(next);
        running.set(next, runAgent(next));
    }

    if (running.size === 0) {
        assertNoDeadlock();
        break;
    }

    const completedId = await Promise.race(
        [...running].map(([id, promise]) => promise.then(() => id, () => id)),
    );
    running.delete(completedId);
}
```

每个 AgentRun 获得独立：

- ContextSnapshot；
- RunTrace；
- middleware 数组副本；
- HITL pause state；
- output Artifact；
- AgentRunAttempt。

ConversationLog 对 AgentRun 是只读上下文源，禁止多个 AgentRun 共享同一个 DraftArea。

### 8.4 Retry

- Predicate 只返回 `done/retry/failed`。
- retry feedback 写入下一 AgentRunAttempt 的显式 input，不修改共享 middleware。
- retry 使用同一个 AgentDefinition version；除非用户显式修改计划。
- 每次 attempt 可以创建独立 ContextSnapshot，且记录与上次的差异。

### 8.5 HITL

- Loop 内 HITL 通过 `await_signal` 处理。
- loop-driver 必须先 emit `await_signal` 给 UI，再等待 Signal。
- Predicate 不再返回不可恢复的 `hitl` 状态。
- 进程退出时 awaiting_signal AgentRun 变为 interrupted。

---

## 9. Agent 能力解析

### 9.1 AgentDefinitionResolver

将现有 AgentResolver 拆成两层：

```typescript
interface AgentDefinitionResolver {
    resolveForChat(id: AgentId): Promise<ResolvedAgentDefinition>;
    resolveExact(id: AgentId, version: string): Promise<ResolvedAgentDefinition>;
}

interface AgentRuntimeFactory {
    createCapabilities(agent: ResolvedAgentDefinition): Promise<AgentCapabilities>;
}
```

`resolveForChat` 可以使用 Default Agent fallback；`resolveExact` 不允许 fallback。

### 9.2 Tool/MCP

AgentDefinition 只保存权限和 profile 引用，不保存活跃 client：

- ToolBroker 根据 toolIds 创建 allowlisted facade。
- MCPConnectionManager 负责连接池、重连和凭证注入。
- AgentRun 只能看到被授权后的统一 IToolService。
- 工具元数据至少包含 `sideEffect`、`idempotent`、`concurrencyKey`。

工具并行规则：

- `sideEffect='none'` 可并行，但仍受 concurrencyKey 限制。
- 写工具是否串行由资源冲突决定，不只由 read/write 二分决定。
- 非幂等工具 retry 前必须人工确认或拥有幂等键。

### 9.3 Memory

Memory 与 conversation history 分离：

- Agent 私有 namespace；
- 可选 session/project read scope；
- ContextAssembler 只把本次检索结果加入 ContextSnapshot；
- AgentRun 写 memory 使用显式 MemoryWrite Step；
- branch context UI 不直接修改 memory。

---

## 10. 事件模型

新增或规范以下事件：

```typescript
type RuntimeEvent =
    | { type: 'round:draft_started'; roundId: RoundId; runId: AgentRunId }
    | { type: 'round:committed'; roundId: RoundId; ref: RefName }
    | { type: 'exchange:start'; runId: AgentRunId; exchange: number }
    | { type: 'exchange:end'; runId: AgentRunId; exchange: number }
    | { type: 'await_signal'; runId: AgentRunId; request: PauseRequest }
    | { type: 'context:profile_changed'; ref: RefName; profileId: ContextProfileId; revision: number }
    | { type: 'context:snapshot_created'; runId: AgentRunId; snapshotId: ContextSnapshotId; tokenCount: number }
    | { type: 'agent_run:status'; runId: AgentRunId; status: AgentRun['status'] }
    | { type: 'agent_run:artifact'; runId: AgentRunId; artifactId: ArtifactId }
    | { type: 'goal:progress'; goalId: GoalId; version: number; nodes: Record<string, string> };
```

Goal 编辑事件与运行事件分流，避免编辑器误把 runtime status 写回 definition：

```typescript
type GoalEditorEvent =
    | { type: 'goal_draft:changed'; definitionId: GoalDefinitionId; draftVersion: number; dirty: boolean }
    | { type: 'goal_draft:validated'; definitionId: GoalDefinitionId; errors: GoalValidationIssue[] }
    | { type: 'goal_revision:created'; definitionId: GoalDefinitionId; revision: number; digest: string };
```

事件 envelope 统一带：

```typescript
interface EventEnvelope<T> {
    eventId: string;
    sequence: number;
    occurredAt: number;
    sessionId?: string;
    goalId?: GoalId;
    runId?: AgentRunId;
    causationId?: string;
    correlationId?: string;
    event: T;
}
```

修复现有 branch 事件：

- `log:appended.ref` 使用实际 `forked.branchName`。
- `log:ref_created.ref` 使用 RefName，不使用 RoundId。
- `log:ref_moved.previousHead/newHead` 使用实际 RoundId。

---

## 11. UI 实施方案

### 11.1 稳定 UI ID

预分配 RoundId 后使用：

```text
round:<roundId>:user
round:<roundId>:assistant
```

每个 DOM 节点带：

```html
data-round-id="..."
data-round-role="user|assistant"
data-context-mode="include|exclude|summary"
data-context-source="default|branch"
```

所有命令传 `roundId + role`，不再从 DOM messageId 推断 RoundId。

### 11.2 Chat 时间线

Chat 保持主时间线体验：

- include：正常显示；
- exclude：半透明并显示“本分支后续上下文已排除”；
- summary：虚线边框并显示摘要 Artifact 状态；
- streaming Draft：显示运行状态，不视为 committed Round；
- interrupted：显示“执行已中断，可重试”。

菜单使用明确动作，不使用三态循环：

- 在本分支后续上下文中完整使用；
- 在本分支后续上下文中排除；
- 为本分支生成并使用摘要；
- 恢复为 Round 默认设置。

### 11.3 Context Drawer

当前已先落地轻量 Navigator 入口，而不是完整 Drawer：

- 每个 Navigator user/assistant 项都有直接 `Context` 开关；点击任一项会切换其所属整个 Round 的 include/exclude；
- 选中多个项后可用 `＋/−` 批量 include/exclude；无选择时顶部 `LLM History` 切换当前筛选范围；
- excluded Round 在 Navigator 标记 `Context off`，但不会从聊天 UI 或存储中删除；
- 操作调用 `session.context.set`，写入当前 branch 的 ContextProfile 新 revision；下一次 `fold()` 生效；
- 该入口不是 `history_visibility`，后者仍是纯 UI pane 开关。

完整 Drawer 仍是后续目标：

Composer 上方显示：

```text
当前分支 12 个 Round · 额外 Artifact 2 个 · Memory 4 条 · 18.2k / 32k tokens
```

Drawer 提供：

- 当前主线 Round 列表；
- branch override 来源；
- summary Artifact；
- 上游 Agent 输出；
- memory retrieval；
- token 预算；
- 下一 AgentRun 的预览；
- 已运行回答的 ContextSnapshot 查看器。

变更 profile 时明确提示：“从下一个 AgentRun 开始生效”。

### 11.4 Chat branch UI

- regenerate sibling 使用 `1 / N` 切换器。
- 手动 branch 使用侧栏树。
- 点击 user 与 assistant 创建 branch 的语义不同，菜单文字必须区分。
- 切换 branch 后重新投影 ConversationGraph 和对应 ContextProfile。

### 11.5 Harness Run Graph

Run Graph 主节点为 AgentRun，不显示每个工具为顶层节点：

- 节点：Agent 名称/version、状态、耗时、token、retry 次数；
- control edge：执行依赖；
- data edge：标明 outputPort → inputPort；
- 点击节点：ContextSnapshot、Attempts、Exchange/Tool trace、Artifacts；
- aggregator 是普通 AgentRun；
- Sub-agent raw trace 默认折叠，仅最终 Artifact进入下游。

### 11.6 DAG 节点与边管理 UI

实施状态：`GoalGraphEditor` 与 `GoalDraftService` 已提供 Agent 节点/边的基础 CRUD、校验、保存 revision 和 Inspector；Run 按钮只创建 revision，实际 `goal.run` command 尚未在默认引擎注册。AgentGroup、Flow node、端口化连线、自动布局、undo/redo 与 Run-mode runtime overlay 仍待实现。

Harness 需要两个明确分离的状态：

- **Design mode**：编辑 GoalDraft，可增删改节点和边；不显示为某次运行的事实。
- **Run mode**：只读显示 GoalRevision 及 AgentRun 状态；只开放 retry、cancel、HITL response 和查看详情。

Graph toolbar 至少提供：

- 新增 Agent 节点；
- 自动布局、缩放、适应画布；
- 连接模式；
- 校验；
- 保存 revision；
- Run；
- 撤销/重做。

节点管理：

- 新增：选择 AgentDefinition，冻结或选择 version，填写 prompt、mode、maxRetries、canParallel 和 joinPolicy；
- 编辑：在 inspector 中编辑节点 label、Agent、prompt、显式 InputBinding 与 output ports；
- 复制：生成新 GoalNodeId，但不复制 incoming/outgoing edges；
- 删除：二次确认节点及将一并删除的边数，后端以单事务删除节点和 incident edges；
- 多选：允许移动与批量删除，不允许用批量编辑隐式改变 Agent version；
- 校验状态：节点上直接标出缺失 Agent/version、无效 input binding、孤立必填端口等问题。

边管理：

- 从 output port 拖到 input port 创建边；
- 创建时明确选择 `control` 或 `data`，不能仅靠线条颜色推断；
- data edge inspector 可编辑 `outputPort → inputPort/order`；
- 删除边不删除节点；
- self-edge、重复 edge、未知端口和 cycle 在 draft 校验阶段阻止保存/运行；环检测必须同时考虑 control 和 data edge；
- `joinPolicy` 显示在目标节点，避免误解为 edge 属性。

画布使用 GoalNodeId，运行 overlay 使用 `Goal.nodeRuns[goalNodeId]` 对应的 AgentRunId。两种 ID 不得互换，也不得把第三方 graph library 生成的临时 ID 写入领域对象。

Run 前流程固定为：保存当前表单 → 校验完整 draft → 创建 GoalRevision → 冻结 AgentDefinition versions → 创建 AgentRuns → 切换到 Run mode。若 draft 在运行期间继续修改，UI 显示“未运行的更改”，不得覆盖当前运行图。

### 11.7 Workspace 视图与 Hide History View

Workspace 主区域从单一 History 容器升级为可组合 workbench：

```text
Titlebar
└── Workbench
    ├── HistoryPane      可见/隐藏
    ├── RunGraphPane     chat 模式可关闭，harness 模式可见
    └── InspectorPane    选中 DAG node/edge 时可见
Composer / HITL / Permission area
```

Titlebar 增加 `Show/Hide history` 按钮，行为必须满足：

- 仅切换 `UIState.history_visibility: 'visible' | 'hidden'` 和 workspace CSS class；
- 不调用 context profile API，不改变 Round 的 include/exclude/summary，不删除 DOM/message，也不等同于 collapse all；
- 隐藏时 HistoryView 继续消费 streaming、commit、branch switch 和 reload 事件；重新显示时内容与当前 branch 一致；
- 隐藏状态下发送消息不会自动展开 history；用户显式点击 Show history 才恢复；
- Composer、运行状态、HITL、permission request 和严重错误必须仍可见；当前只渲染在 HistoryView 内的严重错误需同时投影到 titlebar/toast；
- 有未读完成/错误时，在 Show history 按钮上显示 badge，恢复显示后清除；
- 偏好随当前 chat workspace 持久化，默认 `visible`；旧 `ui_state` 缺失该字段时保持现有行为；
- 按钮使用 `aria-pressed/aria-controls`，隐藏 pane 使用 `hidden`/`aria-hidden`，焦点位于 HistoryPane 内时先移动到 toggle 或 Composer。

`history_visibility` 是纯 UI 状态，不进入 ContextSnapshot digest，也不产生 `context:profile_changed`。命名上禁止使用 `historyPolicy`，避免与模型上下文语义混淆。

实施状态：`WorkspacePaneController`、titlebar toggle、未读 badge、`hidden/aria-hidden` 和 UI state 持久化已完成。Chat Navigator 同时提供 `LLM History`（模型 context）与 `DAG`（Designer pane）入口；两者不能与 titlebar 的纯 UI Hide/Show History 混用。

### 11.8 当前 UI 缺口与落点

当前仓库中：

- `LayoutTemplates` 已提供 History、RunGraph 与 Inspector pane，`WorkspacePaneController` 管理其可见性；
- `HistoryView` 仍专注消息投影，pane 显隐不由它承担；
- `GoalGraphEditor`、`GoalDraftService` 和基础 Inspector 已存在，但只覆盖 Agent/edge draft 编辑；
- `HarnessPlugin` 仍只负责单 Agent 工具/HITL 状态，不是 AgentRun runtime graph；
- 尚无 FlowRun executor、AgentGroup 编辑 UI、AgentRun runtime overlay、ContextSnapshot/Artifact/Attempt Drawer。

因此后续仍不能复用 Chat branch tree 冒充 AgentRun DAG，也不能把 DAG CRUD 塞进 `HistoryView`。Graph editor、runtime projection、inspector 和 workspace pane controller 保持独立 presenter/service，由 `LLMWorkspaceEditor` 负责组装。

---

## 12. 存储布局

继续使用现有 VFS，不引入新数据库。推荐逻辑布局：

```text
<chat asset>/
├── round-<roundId>.json
├── context-profile-<profileId>-r<revision>.json
├── context-snapshot-<snapshotId>.json
├── artifact-<artifactId>.json
└── manifest.json

<run module>/
├── definitions/
│   └── <goalDefinitionId>/
│       ├── draft.json
│       └── revision-<revision>.json
└── runs/
    └── <goalId>/
        ├── goal.json
        ├── run-<runId>.json
        └── trace-<runId>.json
```

单机单进程仍需：

- 每个 ConversationLog 一个写入队列；
- 每个 Goal 一个 scheduler；
- ref move 使用 expected head；
- profile pointer 更新使用 expected revision；
- AgentRun 状态转换幂等；
- 大工具输出保存为 Artifact，不塞入 manifest。

---

## 13. 现有文件具体改造清单

### 13.1 `common/.../loop.ts`

- 引入 branded IDs。
- `RoundContext` 改名 `ExchangeContext`。
- `beforeRound/afterRound` 改为 `beforeExchange/afterExchange`。
- ILoop 返回值逐步从 `Round[]` 收敛为 `LoopOutcome`：

```typescript
interface LoopOutcome {
    round: Round;
    finalArtifactDraft: Omit<Artifact, 'id'>;
    exchangeCount: number;
}
```

- 当前不再声明 crash-resume；`resume()` 仅用于内存中的 paused loop，或暂时保留兼容但标记 deprecated。
- LoopContext 新增 runId、ContextSnapshot 和 scoped capabilities。

### 13.2 `loop-executor.ts`

- `exchangeNumber` 保留，但所有 round 事件改为 exchange 事件。
- 不再调用 `ctx.log.fold()`；直接消费 ContextSnapshot.canonicalMessages。
- historyLength 移到 ContextAssembler，按 ContextBlock 截断。
- 当前 payload 保证形成一个完整 Round。
- assistant/tool/tool-result 协议组不能被拆分。
- retry/continue 记录为 AgentRunAttempt/Exchange，而不是多个 Round。

### 13.3 `round-log.ts`

- `fold()` 改为结构投影或提供 `readPrimaryLineage(head)`，不做 provider 清洗。
- 删除尾部 assistant pop。
- 错误不再吞掉并返回空数组。
- 暂停当前 `merge()`；重写后 parents 使用 head RoundIds，payload 不复制历史。
- append 校验 parent 存在、ID 不重复、无 self-parent。
- 空会话不创建 phantom root ID。
- committed Round 写入后不可再覆盖。
- cache key 不再只用 ref；结构 cache 使用 head RoundId。

### 13.4 `round-types.ts`

- schemaVersion=3。
- root/head nullable/derived。
- BranchMeta 加 ContextProfile pointer。
- RoundProjection 支持 finalAssistant 与 execution trace summary。

### 13.5 `draft-area.ts`

- 当前阶段不再声称跨重启恢复。
- 移除自动保存空 Round 的行为，或改为只保存可用于“显示 interrupted”的 RunDraft 元数据。
- 应用启动时归档/清理旧 draft，不自动续跑。

### 13.6 `loop-driver.ts`

- `await_signal` 先发给 UI，再等待 Signal。
- 不在每个 exchange:start 用空 Round 覆盖 DraftArea。
- 同进程 pause 直接保留 generator 与 runId。
- 进程退出后不调用伪 resume。

### 13.7 `task-runner.ts`

- submit 时冻结 branchRef、branchHead、profile revision 和 AgentDefinition version。
- 预分配 RoundId 必须发生在创建 user UI placeholder 之前。
- 删除 `buildFoldPrependLog()`。
- 使用 ContextAssembler。
- 删除“发现任意 draft 就 resume”的逻辑。
- 正常发送、regenerate、edit 全部通过 RoundDraft → committed Round。
- `rounds.length` 不再用作模型 exchange 数；使用 LoopOutcome.exchangeCount。

### 13.8 `goal.ts`

- 增加 GoalDefinitionId、GoalNodeId、GoalDraft、GoalRevision、GoalNodeDefinition 与 GoalDefinitionEdge。
- GoalRevision 实例化为运行 Goal 时生成 AgentRunSpec、RunEdge 和 GoalNodeId → AgentRunId 映射。
- Predicate 去除 hitl，或将 controller-level HITL 定义成显式 Step。

### 13.9 `dependency-scheduler.ts`

- 保存完整 specs map 或只返回 readyIds。
- 修复未知 from/to 校验。
- 修复重复 complete 导致重复递减。
- 使用 versioned notification，删除 `(this as any).resolveNotify`。
- 支持 joinPolicy 与 all-settled。
- 状态迁移统一由 scheduler 方法完成，禁止任意 setStatus。

### 13.10 `reconciler.ts`

- 改为容量持续填充，不等待整批 sibling 完成。
- 每个 AgentRun 独立 context/trace/pause/middleware。
- retry feedback 写入 attempt input。
- 上游成功时保存 Artifact，再通过 data edge 绑定下游。

### 13.11 `agent-resolver.ts`

- 返回 ResolvedAgentDefinition。
- 增加版本/hash。
- 解析 capabilityPolicy、MCP、memory、context policy。
- 提供 chat fallback 与 harness exact 两种入口。
- AgentRun 保存解析后的精确版本与模型选择。

### 13.12 `branch-service.ts`

- 全部 branch 操作改用 RoundGraphService。
- 删除对旧 engine branch API 的调用。
- 修复 branch 事件 ref/head 字段。
- 根据 user/assistant 角色采用不同 branch 语义。
- branch 创建时继承 ContextProfile pointer。

### 13.13 `round-operations.ts`

- regenerate/edit 不修改 committed Round。
- 修复 edit 新内容未落盘、旧 Round 被当作 parent 的问题。
- 删除 assistant 转换为 alternate-response branch。
- 普通删除转为 ref move/rebase，不做 DAG 全局级联 tombstone。

### 13.14 `session-state.ts`

- 使用稳定 view IDs 与 data-round-id。
- RoundProjection 选择 final assistant，而不是第一个 assistant。
- primary parent 使用 parents[0]。
- 移除无 visited 的 cascade delete。
- history 构建不再作为模型事实源；模型只使用 ContextAssembler。
- 显示 effective context mode 与规则来源。

### 13.15 `session-registry.ts`

- 仍可沿 primary parent 加载 Chat 时间线。
- merge/harness trace 不进入普通时间线遍历。
- 不从 currentHead 的重复字段读取；统一通过 branches[currentBranch]。
- reload/diff 不把 branch 切换解释成对象删除。

### 13.16 `IChatFile.ts` 与旧 ChatEngine API

- Round 格式下弃用旧 message chain/branch CRUD。
- 旧格式读取仅保留迁移 adapter。
- 新功能不得同时写 ChatNode graph 和 RoundManifest。

### 13.17 `session-recovery.ts`

- 恢复时把 running/queued/awaiting_signal 转为 interrupted。
- UI 显示 retry。
- 不自动重新执行。
- 清理旧 draft 或移动到诊断归档。

### 13.18 `LayoutTemplates.ts` 与 `LLMWorkspaceEditor.ts`

- 增加 Workbench、HistoryPane、RunGraphPane、InspectorPane 容器和 titlebar history toggle。
- Shell 只组合 `IHistoryPresenter`、`IRunGraphPresenter`、`IGoalEditorPresenter` 与 `IWorkspacePaneController`，不直接实现图编辑业务。
- chat 默认只显示 HistoryPane；进入 Harness design/run 时显示 RunGraphPane，可按用户偏好保留或隐藏 HistoryPane。

### 13.19 `HistoryView.ts`、`IHistoryPresenter.ts` 与 UI state

- HistoryView 保持消息投影职责；pane 显隐由 WorkspacePaneController 管理。
- `UIState`、`ChatManifest.ui_state`、`StateManager` 增加 `history_visibility`，兼容缺失字段。
- history 隐藏期间继续 processEvent；严重错误增加 workspace-level fallback projection。

### 13.20 `goal-draft-service.ts` 与 Goal command handlers

- 提供 `loadDraft/saveDraft/validate/createRevision`。
- 提供 `addNode/updateNode/duplicateNode/removeNode/addEdge/updateEdge/removeEdge`，统一 expected draft version。
- 删除节点与 incident edges 原子提交；所有 mutation 返回新 draftVersion 和 validation issues。
- Run command 只能接收 GoalRevision，不接受未冻结 GoalDraft。

### 13.21 `RunGraphView.ts` 与 `GoalInspectorView.ts`

- RunGraphView 只负责 graph viewport、selection、port/edge interaction 和 runtime status projection。
- GoalInspectorView 负责 node/edge 表单，保存前做字段级校验。
- 使用 adapter 隔离具体图形库；领域层不得暴露第三方 graph node 类型。
- 大图按 viewport 渲染；trace/tool 不作为顶层图节点。

### 13.22 `HarnessIntegration.ts` 与 `HarnessPlugin.ts`

- 恢复 Harness callbacks，连接 Goal draft/revision/run commands。
- HarnessPlugin 继续负责 Composer 附近的 permission/HITL/status，不承担 DAG canvas。
- hidden history 时，完成、失败和 HITL 状态仍通过 HarnessPlugin/titlebar 可见。

---

## 14. 迁移计划

> 状态说明：以下为剩余迁移路线图，不代表每个 Phase 尚未开始。当前已完成 Phase 1 的 RoundGraphService 基础、Phase 2 的 profile include/exclude 最小闭环，以及 Phase 5 的 workspace/GoalDraft 基础 UI；未完成项以各 Phase 的条目为准。

### Phase 0：正确性止血

目标：在不增加新功能前修复会污染上下文或图结构的问题。

- 修复 fold 删除最终 assistant。
- Provider 清洗移出 RoundLog。
- 禁用错误 merge。
- final assistant 投影。
- Round/Exchange 命名。
- `await_signal` UI 通知。
- 取消伪 crash-resume。
- 修复 scheduler ready/edge/complete。
- task submit 冻结 branch/head。

验收：现有 chat、tool loop、regenerate 测试全部通过，且新增 P0 回归测试。

### Phase 1：ConversationGraph 单一事实源

状态：进行中。RoundGraphService、RoundManifest、branch 基础操作与稳定 Round projection 已落地；旧 ChatNode/部分 legacy message mutation 路径尚未完全移除。

- 建立 RoundGraphService。
- BranchService 全量迁移。
- 旧 IChatFile branch API 只读/弃用。
- committed Round 不可变。
- regenerate/edit/delete 转换为 ref/draft 操作。
- 稳定 UI view ID。

验收：所有 branch 操作只修改 RoundLog/Manifest，不触达旧 ChatNode graph。

### Phase 2：Branch Context

状态：进行中。ContextProfileStore、copy-on-write、Navigator 单 Round include/exclude 与 `RoundLog.fold()` 生效已完成；ContextSnapshot 主路径、summary、token preview 和 Drawer 尚未完成。

- Manifest v3 迁移。
- BranchContextProfileStore。
- copy-on-write revision。
- ContextAssembler、ProviderMessageAdapter。
- ContextSnapshotStore。
- UI context menu/Drawer/token preview。

验收：同一 Round 在两个 branch 可以有不同 effective mode；旧回答仍能查看其 ContextSnapshot。

### Phase 3：AgentDefinition 与 AgentRun

状态：部分完成。AgentRun 类型、持久化和 GoalDraft 基础已存在；TaskRunner 尚未完整统一为 AgentRun/Attempt + ContextSnapshot。

- AgentDefinition version/hash。
- capability/MCP/memory policy。
- AgentRun、Attempt、ArtifactStore。
- TaskRunner 统一执行 AgentRun。
- Chat 使用单个 AgentRun；Harness 使用 Goal 中的多个 AgentRun。

验收：同一 AgentDefinition 可并发运行，且每个运行的 ContextSnapshot、tool scope、memory scope 独立。

### Phase 4：AgentRun DAG

状态：部分完成。typed edge、scheduler/reconciler 和 GoalDraft 的基础校验存在；FlowRun、AgentGroup、完整实例化映射和默认可执行 DAG 尚未完成。

- typed RunEdge。
- GoalNodeId → AgentRunId 实例化映射；每次执行分配新的运行 ID。
- Scheduler/Reconciler 重构。
- join policy。
- 上游 Artifact → 下游 InputBinding。
- aggregator AgentRun。
- retry、failure propagation、cancel。

验收：A、B 并行时，依赖 A 的 C 在 A 完成后立即执行，不等待 B；下游默认看不到上游 raw trace。

### Phase 5：Harness UI

状态：部分完成。History pane、Hide/Show、Navigator 的 LLM context 控制、GoalDraft Designer 与基础 Inspector 已完成；Run mode、runtime projection、AgentGroup/Flow 编辑和 trace drawers 未完成。

- Workbench pane controller 与 Hide/Show History，持久化纯 UI visibility。
- GoalDraft graph editor：节点/边 CRUD、端口连接、校验、undo/redo。
- GoalRevision 创建与 Design/Run mode 切换。
- AgentRun graph runtime projection。
- 节点/边 inspector。
- ContextSnapshot/Artifact/Attempt/Trace。
- 状态、HITL、retry、cancel 操作。

### Phase 6：清理和文档

- 删除旧 branch/message mutation API。
- 删除 summary-in-fold 和 dagFold 提案代码。
- 清理旧 v4.1 C4 图。
- 更新 v4.2 C1–C4、事件表和存储布局。

---

## 15. 兼容性迁移

### 15.1 Manifest v2 → v3

加载旧 manifest 时：

1. 校验 `currentHead === branches[currentBranch]`；不一致时以 branch pointer 为准。
2. 为每个 branch 创建默认 ContextProfile revision 1。
3. 旧 Round `historyPolicy` 不立即重写，作为 immutable default 读取。
4. 旧 `summary` 若没有 Artifact，降级为 include 并记录迁移告警，不能生成虚假摘要。
5. 扫描 Round.parents 重建 children。
6. 检测 refs 被误写进 parents 的旧 merge Round，标记 invalid，不自动猜测修复。

### 15.2 旧 UI IDs

命令处理器在迁移期接受：

- 旧 assistant ID = roundId；
- 旧 user ID = `${roundId}-user`；
- 新 ID = `round:${roundId}:role`。

统一解析为 `{ roundId, role }`，一到两个版本后删除旧解析。

### 15.3 旧 ChatNode 格式

- 首次写入前执行一次性转换为 Round。
- 转换完成后只写 RoundLog。
- 保留只读导出 fallback，不再双写。

---

## 16. 测试矩阵

### 16.1 Round/Context 单元测试

- 完整 user/assistant/tool 协议组保持顺序。
- 下一请求包含上一轮最终 assistant。
- exclude 一个 Round 不切断更早 ancestors。
- exclude 工具 Round 不产生孤立 tool_result。
- summary 必须引用存在且 hash 匹配的 Artifact。
- history/token 截断只在 ContextBlock 边界发生。
- Provider adapter 在 pending user 加入后校验。
- ContextSnapshot digest 稳定。

### 16.2 Branch 测试

- 新 branch 继承 profile revision。
- 子 branch 修改后父 branch 不变。
- 父 branch 后续修改不影响已存在子 branch。
- switch/rename/delete/tree 全部读取同一 RoundManifest。
- regenerate 新 Round 的 parent 是原 primary parent。
- edit 不包含旧 user/assistant Round。
- 手动从 assistant 创建 branch 不复制 user。
- branch 事件携带真实 RefName 和 RoundId。

### 16.3 Scheduler 测试

- unknown from/to 立即报错。
- self-edge、重复 node、cycle 报错。
- data edge 与 control edge 都参与依赖和环检测，data edge 下游不会提前启动。
- complete 幂等。
- A→C、B 独立时，C 不等待 B。
- all-success、all-settled、any-success。
- retry 不污染其他节点 middleware/context。
- 失败传播只影响依赖路径。
- concurrency limit 始终满足。
- notification 不丢事件。

### 16.4 AgentRun 测试

- AgentDefinition 精确版本冻结。
- Harness 缺失版本时失败，不 fallback。
- tool allowlist 生效。
- MCP profile 隔离。
- memory namespace 隔离。
- 上游只传最终 Artifact。
- 显式 raw trace binding 才能读取 trace。
- retry 生成新 Attempt。

### 16.5 HITL/恢复测试

- await_signal 先显示 UI，再等待。
- respond 恢复同一内存 generator。
- abort 正确取消。
- 应用重启后任务为 interrupted。
- 旧 draft 不会劫持下一次新请求。
- retry 创建新的 AgentRunAttempt/AgentRun，不伪装成中间续跑。

### 16.6 UI 测试

- streaming 与 reload 使用同一 RoundId。
- reload 显示 final assistant。
- context badge 显示 effective mode 和来源。
- 修改 profile 提示“下次运行生效”。
- ContextSnapshot inspector 与实际请求消息一致。
- Chat branch 与 Run Graph 导航互不混淆。
- DAG 新增/编辑/复制/删除节点后 draft 与画布一致。
- 删除节点同时删除 incident edges，undo 可恢复两者。
- self-edge、cycle、dangling port 和缺失 Agent version 阻止 Run。
- Run 开始后当前 GoalRevision 结构只读；继续编辑生成新 draft/revision。
- data/control edge 在颜色之外还有文本/图形区分，键盘可选中和删除。
- 同一 GoalRevision 连续运行两次产生不同 AgentRunId，画布仍以同一组 GoalNodeId 投影。
- Hide History 不改变 BranchContextProfile、ContextSnapshot digest 或下一次请求消息。
- history 隐藏期间 streaming/commit/branch switch 正常处理，重新显示无丢失或重复节点。
- history 隐藏期间 HITL、permission 和严重错误仍可见且可操作。
- reload 恢复 `history_visibility`；旧 ui_state 默认 visible。

---

## 17. 阶段验收标准

最终功能完成必须满足：

1. 不存在 Harness `dagFold(all ancestors)`。
2. 不存在把 RefName 写入 Round.parents 的路径。
3. 不存在 committed Round payload 原地修改路径。
4. 不存在 RoundLog 与旧 Chat branch graph 双写。
5. 每个 AgentRun 都有 AgentDefinition version 和 ContextSnapshot。
6. 当前 branch 上下文修改持续生效且不影响 sibling branch。
7. 下游 AgentRun 默认只收到上游最终 Artifact。
8. 并行 AgentRun 拥有独立 trace、pause state 和 middleware。
9. `await_signal` 可见、可响应、可 abort。
10. 应用重启后旧任务明确显示 interrupted，不自动错误续跑。
11. Chat UI 默认保持线性易用，Harness DAG 使用独立视图。
12. v4.1 旧架构文档不再被标记为当前实现。
13. GoalDraft/GoalRevision 使用稳定 GoalNodeId；每次 Run 都生成新的 AgentRunId 并保存映射。
14. Hide History 是纯 UI 状态，不能改变任何模型上下文或运行调度结果。

---

## 18. 明确禁止的实现方式

以下方式不得进入实现：

- 用 Round DAG 同时表示聊天 lineage、工具并行和 Agent 调度。
- 对全部 DAG ancestors 做拓扑排序后直接拼成 LLM messages。
- 用户修改上下文时直接修改 `RoundMeta.historyPolicy`。
- 在 `fold()` 中同步调用 LLM 生成 summary。
- 把 summary 伪装成普通 user message 而不记录来源。
- 为加速而同时维护 `merges`、`excludedRounds` 等重复事实字段。
- 让 AgentDefinition 持有活跃 MCP client 或 memory DB 实例。
- Harness Agent 缺失时静默换成默认 Agent。
- 删除一个 parent 时无条件级联删除共享 DAG child。
- 用 `catch { return [] }` 隐藏上下文或图损坏。

---

## 19. 推荐开发工作包

为降低并行修改冲突，按以下工作包拆分：

1. `WP-01 Round correctness`：fold、projection、IDs、provider adapter。
2. `WP-02 RoundGraphService`：branch 单一事实源、immutable operations。
3. `WP-03 Context core`：profile、assembler、snapshot、summary artifact。
4. `WP-04 Context UI`：badge、menu、drawer、preview。
5. `WP-05 AgentDefinition`：version、tools/MCP/memory policy。
6. `WP-06 AgentRun`：run/attempt/artifact、TaskRunner 集成。
7. `WP-07 Scheduler`：typed edge、join、reconciler、retry。
8. `WP-08A Workspace UI`：workbench panes、Hide/Show History、UI state、可见性回归测试。
9. `WP-08B Goal editor UI`：GoalDraft 节点/边 CRUD、校验、revision、undo/redo。
10. `WP-08C Harness runtime UI`：Run Graph、inspector、HITL/cancel/retry。
11. `WP-09 Migration`：manifest v3、legacy IDs、ChatNode 退役。
12. `WP-10 Docs/tests`：C4 更新、完整验收矩阵。

工作包依赖关系：

```text
WP-01 → WP-02 → WP-03 → WP-04
WP-05 → WP-06 → WP-07
WP-02 → WP-08A
WP-05 + WP-07 → WP-08B
WP-07 + WP-08A + WP-08B → WP-08C
WP-02 + WP-03 + WP-06 → WP-09 → WP-10
```

---

## 20. 最终架构结论

系统应当坚持以下边界：

> Round 管会话，Ref 管分支，BranchContextProfile 管持续上下文规则，ContextSnapshot 管可复现输入，AgentDefinition 管能力配置，GoalDefinition/Revision 管可编辑且可复现的 DAG 定义，Goal 管一次 DAG 执行，AgentRun 管一次节点执行，Artifact 管 Agent 间数据，Loop 管单个 AgentRun 内部推理。

这样既保留四原语内核，也避免 Round 成为承担所有职责的万能节点；Chat、Harness、多 Agent、Tools/MCP/Memory 和后续扩展均可在稳定边界上独立演进。
