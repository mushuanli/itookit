# @itookit/llm-flow — API 参考

> DAG 编排层：把 `llm-tasks` 的 LLM 任务单元连成动态图（route/loop/spawn/compensate/on_failure/budget），并持久化 Flow 定义。提供 `DurableFlowExecutor`（动态图调度）、`DagCommandService`（命令面）、内置 Flow Programs 与插件。公共 API 从 `@itookit/llm-flow` 根导出；`flow/operations.ts` 的纯操作、`flow/programs.ts` 的输入类型（`FlowDependencyBinding` / `FlowValueInput` / `FlowHumanInput` / `FlowAggregateInput`）与 `flow/executor.ts` 的 `upstreamOf` 未从根导出，需按源码路径导入。

**依赖方向**：`llm-flow → durable-kernel + llm-tasks`（`llm-session` 依赖本包）。不持有会话语义（Round/Branch 属于 `llm-session`）；能力经 Kernel Effect 使用。

## 目录

- [入口：DurableFlowExecutor](#入口durableflowexecutor)
- [Flow Programs：value / human / aggregate](#flow-programs)
- [命令面：DagCommandService](#命令面dagcommandservice)
- [Flow 定义持久化：FlowDefinitionStore](#flow-定义持久化)
- [DAG 编译：flowToDag / findCycles](#dag-编译)
- [校验：validateFlowRevision / flowRevisionDigest](#校验)
- [插件：DagPluginRegistry / builtin-plugins](#插件)
- [源码结构：文件与路径](#源码结构文件与路径)

---

## 入口：DurableFlowExecutor

动态图调度器 —— 把 `DagRunSpec` 编译为 Task DAG 并驱动执行。

```ts
class DurableFlowExecutor {
    constructor(options: DurableFlowExecutorOptions);
    async submit(sessionId: string, spec: DagRunSpec, parameters?: Record<string, JsonValue>): Promise<FlowExecutionHandle>;
    async resume(sessionId: string, rootTaskId: string): Promise<FlowExecutionHandle>;
    async waitForCheckpoint(sessionId: string, rootTaskId: string, taskIds: string[], timeoutMs?: number): Promise<void>;
    async waitIdle(): Promise<void>;
}
```

**`DurableFlowExecutorOptions`**：

```ts
interface DurableFlowExecutorOptions {
    kernel: Kernel;                            // 执行内核
    plugins: DagPluginCatalog;                   // 插件目录（节点类型 → Manifest）
    sessionContext?: { projectInstructions: string; skillInstructions: string; skillIndex: string };
    /** 仅新 Run 解析一次；恢复始终使用其持久化快照 */
    resolveNewRunContext?(sessionId: string): Promise<NonNullable<DurableFlowExecutorOptions['sessionContext']>>;
    bindPatchNode?(sessionId: string, node: DagNodeDefinition, defaults?: Record<string, unknown>): Promise<Partial<Pick<DagNodeDefinition, 'config' | 'inputs'>>>;
    resolveTools?(sessionId, allowedIds): Promise<{
        definitions: ToolDefinition[];
        externalIds: string[];
    }>;
    hooks?: HarnessHookRunner;                   // 可信宿主钩子
    workspaceManager?: FlowWorkspaceManager;     // 宿主工作区管理器
}
```

**`FlowExecutionHandle`** —— 一次 DAG 运行的句柄：

```ts
interface FlowExecutionHandle {
    attachedFromStorage?: boolean; // 只重新连接已有任务，不代表恢复调度
    workspaceCompletion?: Promise<void>; // 可等待工作目录收尾；失败不会改写根 Task 结果
    root: TaskHandle<JsonValue>;                 // 根任务（汇总输出）
    nodes: Map<string, TaskHandle>;              // 节点 id → TaskHandle
    iterations: Map<string, number>;             // 每节点实际执行实例数（Loop 节点 > 1）
}
```

**辅助函数**：`upstreamOf(edges, nodeId): string[]` —— 取某节点的上游边（`flow/executor.ts`，未从包根导出）。

**隔离工作区租约**（`FlowWorkspaceManager`）：`prepare(sessionId, policy)` 创建隔离工作区并返回
`FlowWorkspaceLease`；可选 `restore(sessionId, policy, record)` 让新宿主重新挂载崩溃前的工作区。
`FlowWorkspaceLease.record` 是 JSON 可序列化的租约描述，执行器写入 Session shared
`flow.run.<rootTaskId>.workspace-lease`，因此 `resume` 不会新建第二个工作区，并会补跑中断的
finalization（`workspaceFinalizationKey` 仍为 `flow.run.<rootTaskId>.workspace`）。
`GitWorktreeFlowWorkspaceManager` 是参考实现：record 保存 `{version, directory, branch}`，
restore 校验目录归属与存在性，finish 对「工作区已被上一宿主移除」幂等。

---

## Flow Programs

三个内置 Program 注册为 `flow.value@1` / `flow.human@1` / `flow.aggregate@1`（kind 为 `flow.value` / `flow.human` / `flow.aggregate`，version `1`）。它们是 **Program kind**，不是 Flow 节点类型；Flow 节点类型（plugin id）为 `builtin.transform` / `builtin.reduce` / `builtin.route` / `builtin.spawn` / `builtin.flow` / `builtin.human` / `builtin.agent`，其中前四种映射到 `flow.value@1`，`builtin.human` 映射到 `flow.human@1`，`builtin.agent` 映射到 `llm.agent@1`，`builtin.flow` 是 composite，在执行前展开子 Flow 而不产生 Program；`flow.aggregate@1` 由执行器创建 Run 根任务时使用。

| Program | manifest | 输入 | 输出 |
|---|---|---|---|
| `FlowValueProgram` | `flow.value@1` | `FlowValueInput`（`operation` 纯操作 + 依赖） | `DagNodeOutcome` |
| `FlowHumanProgram` | `flow.human@1` | `FlowHumanInput`（HITL 交互） | `DagNodeOutcome` |
| `FlowAggregateProgram` | `flow.aggregate@1` | `FlowAggregateInput`（聚合策略） | `JsonValue` |

**`FlowDependencyBinding`**：`{ taskId: string; input: string; output?: string; edgeId?: string }` —— 节点对上游输出的引用（`flow/programs.ts`，输入类型未从包根导出）。

**纯操作**（`flow/operations.ts`，供 `FlowValueProgram` 内部使用，未从包根导出）：

| 函数 | 语义 |
|---|---|
| `transformOutcome(...)` | 转换节点输出 |
| `spawnOutcome(...)` | 展开 spawn 子图 |
| `reduceOutcome(...)` | 归约聚合 |
| `routeOutcome(...)` | 路由分发（route 语义） |

---

## 命令面：DagCommandService

把 Flow 草稿/修订命令注册到会话 `CommandBus`（slash 命令控制面）。

```ts
class DagCommandService {
    constructor(options: DagCommandServiceOptions);   // flowStore + kernel + plugins + resolveTools
    register(bus: ICommandBus): void;                 // 注册全部 DAG 命令
}
```

**`DagCommandServiceOptions`**：`{ flowStore: FlowDefinitionStore; kernel: Kernel; plugins: DagPluginCatalog; resolveTools?; resolveSessionContext?; bindNode?; workspaceManager? }`。`bindNode(sessionId, node, defaults?)` 用于静态/Composite 编译及动态 patch 身份解析；动态节点传入产生节点所属 Flow 的 defaults。编译结果 `DagRunSpec.nodeDefaults` 保存按节点划分的默认身份层，Composite 展开保留子 Flow 的作用域；执行器提交时冻结它，并由动态 patch/委派后代沿用。默认配置不扩大动态节点的原能力声明。`DagRunSpec.nodeConnections` 同样按节点保存连接别名、默认槽位与宿主回退连接，供动态 patch 和委派子节点在提交前解析，Composite 保留子 Flow 的作用域。动态绑定在整批发布前完成，仅采用 config/inputs，并保留原工具能力、预算及委派调度策略；递归保留 resolvedTemplate 的身份内容，将每级模板能力限定为原声明，缺省为空。`resolveSessionContext(sessionId, userMessage)` 返回项目规则、已加载 Skill 规则及 Skill 索引；独立入口传空 userMessage，由执行器冻结并提供给每个 Agent 实例。

**`DurableFlowSnapshot`**：运行快照类型（命令面查询用）。

---

## Flow 定义持久化

```ts
class FlowDefinitionStore {
    constructor(store: FlowStore, plugins?: DagPluginCatalog);
    async createDraft(input: { id: string; name: string }): Promise<FlowDraft>;
    async listDrafts(): Promise<FlowDraft[]>;
    async loadDraft(id: string): Promise<FlowDraft | null>;
    async saveDraft(draft: FlowDraft, expectedDraftVersion: number): Promise<FlowDraft>;
    async createRevision(draft: FlowDraft): Promise<FlowRevision>;
    async saveRevision(revision: FlowRevision): Promise<FlowRevision>;
    async loadRevision(id: string, revision?: number): Promise<FlowRevision | null>;
    async listRevisions(id: string): Promise<FlowRevision[]>;
    async adoptDraft(nodeId: string, name: string): Promise<FlowDraft>;
    // …
}
```

**`FlowStore`**（最小存储接口，由 `llm-session` 的 `FlowEngine` 实现）：

```ts
interface FlowStore {
    listFiles(): Promise<FlowFileRef[]>;
    findFile(name: string): Promise<FlowFileRef | null>;
    createFile(name: string, content: string): Promise<FlowFileRef>;
    readFile(nodeId: string): Promise<string | null>;
    writeFile(nodeId: string, content: string): Promise<void>;
    renameFile(nodeId: string, newName: string): Promise<void>;
    deleteFile(nodeId: string): Promise<void>;
    createAsset(ownerNodeId: string, filename: string, content: string | ArrayBuffer): Promise<unknown>;
    readAsset(ownerNodeId: string, filename: string): Promise<string | ArrayBuffer | null>;
    listAssets(ownerNodeId: string): Promise<Array<{ path?: string; name?: string }>>;
}
```

**`FlowFileRef`**：`{ nodeId: string; name: string }`。**`generateFlowId(name)`**：由显示名派生 ASCII、文件名安全的 Flow id（根导出）。

**`FlowDraftVersionConflictError`**：草稿版本冲突（CAS 失败）抛错。

---

## DAG 编译

```ts
type FlowNodeBinder = (
    node: FlowNodeDefinition,
    flowDefaults?: FlowNodeDefinition['config'],
) => Partial<Pick<FlowNodeDefinition, 'config' | 'inputs' | 'capabilities' | 'budget'>>
    | Promise<Partial<Pick<FlowNodeDefinition, 'config' | 'inputs' | 'capabilities' | 'budget'>>>;

flowToDag(
    flow: FlowRevision,
    bind?: FlowNodeBinder,
    fallbackConnectionId?: string,
    resolveComposite?: (id: string, revision?: number) => Promise<FlowRevision | null>,
    compositeStack?: string[],
): Promise<DagRunSpec>;
findCycles(nodes: GraphNode[], edges: GraphEdge[]): GraphCycles;   // 通用环检测
```

**`GraphNode`** / **`GraphEdge`** / **`GraphCycles`**：泛型图结构（`node.id` / `edge.from→to`），`findCycles` 返回环集合。

---

## 校验

```ts
interface ValidationIssue {
    code: string;
    message: string;
    nodeId?: string;
    edgeId?: string;
    severity?: 'error' | 'warning';
}
validateFlowRevision(flow: FlowRevision, plugins?: DagPluginCatalog): ValidationIssue[];   // 结构 + 环 + 引用校验
flowRevisionDigest(flow: Omit<FlowRevision, 'digest'>): string; // 修订摘要（内容寻址）
```

---

## 插件

```ts
class DagPluginRegistry implements DagPluginCatalog { … }       // 插件注册表
createBuiltinDagPluginRegistry(): DagPluginRegistry;            // 内置插件
```

内置插件集共 7 个，id 一律为 `builtin.<kind>`、version `1.0.0`：`builtin.transform`、`builtin.reduce`、`builtin.route`、`builtin.spawn`、`builtin.flow`（composite，展开子 Flow）、`builtin.human`、`builtin.agent`（节点类型 → Manifest/UI Contribution）。

---

## 源码结构：文件与路径

`@itookit/llm-flow` 的公共 API 从 `packages/llm-flow/src/index.ts` 根导出（barrel 转发 `flow/index.ts`）。包内结构：

```
packages/llm-flow/src/
├── index.ts                   根导出（flow/* + FlowDefinitionStore/FlowStore/FlowFileRef/generateFlowId）
├── flow-definition-store.ts   FlowDefinitionStore + FlowStore + FlowFileRef + FlowDraftVersionConflictError + generateFlowId
└── flow/
    ├── index.ts               flow 层 barrel
    ├── executor.ts            DurableFlowExecutor + DurableFlowExecutorOptions/FlowExecutionHandle + upstreamOf（未根导出）
    ├── commands.ts            DagCommandService + DagCommandServiceOptions/DurableFlowSnapshot
    ├── programs.ts            FlowValueProgram/FlowHumanProgram/FlowAggregateProgram + 输入类型
    ├── operations.ts          transformOutcome/spawnOutcome/reduceOutcome/routeOutcome（纯操作，未根导出）
    ├── to-dag.ts              flowToDag + FlowNodeBinder
    ├── validation.ts          validateFlowRevision/flowRevisionDigest + ValidationIssue
    ├── graph.ts               findCycles + GraphNode/GraphEdge/GraphCycles
    ├── plugin-registry.ts     DagPluginRegistry
    ├── builtin-plugins.ts     createBuiltinDagPluginRegistry（内置插件集）
    └── (无持久化路径常量 — Flow 草稿/修订经 FlowStore 落到 llm-session 的 flows 模块)
```

**约定**：只编排 DAG，不持有 Round/Branch/SessionRepository 语义；不依赖 `llm-session`、UI、DOM 或具体设备；`FlowDefinitionStore` 只依赖最小 `FlowStore` 接口（由 `llm-session` 的 `FlowEngine` 适配），每个 Flow 是一个 `.flow` 文件（可变草稿），修订以 asset 形式存放在该文件下（`revision-<n>.json` / `latest.json`）。flows 模块与应用装配路径见 `llm-session-api.md` 的 VFS 路径设定。

## 持久任务 Transcript

`FlowCommand.RunTranscript`（`dag.run.transcript`）接受 `{ sessionId, taskId, targetTaskId }`，taskId 是 Run 根聚合任务 ID。返回 `FlowTaskTranscript`，包含任务 input/output、status/version、完整持久 Effect 交换与 interaction 记录；也可直接调用 `readFlowTaskTranscript(kernel, sessionId, runTaskId, taskId)`。以根任务 input.runTasks 验证归属，无需原 DagCommandService 句柄，拒绝其他 Run 的任务。runTasks 包含全部循环实例、未汇总及 detached 节点。支持可选 `query: { version?, offset?, limit?, maxBytes? }`：默认每页 100 条 Effect、最多 500 条，返回 totalEffects 与可选 nextOffset；`maxBytes`（≥64）限制本页 JSON 编码后的 UTF-8 字节数，超出时按固定顺序裁剪——先丢弃尾部 Effect 并前移 nextOffset，再缩短 input/output 与 Effect 负载，最后只保留首个 Effect 或退化为仅头部——结果带 `bytes` 与 `truncated: true`。后续页携带首屏 version 固定历史快照；未提供 version 的非零 offset 拒绝。这是结构化记录；DagWorkbench 的任务记录对话框按交换分段展示并支持 JSON 和 UTF-8 纯文本文件导出，加载更多会合并同一版本的交换，全部加载完才启用导出。底层仍整任务读取，输入/输出/interaction 不分页，但整页受 `maxBytes` 字节预算约束。CLI 提供 `mindos export <run-id> [--out file.json] [--max-bytes N]`：以 control 模式读取 transcript（默认 256 KiB/节点）并连同 manifest 写入真实文件，已在 LocalFS 上通过集成测试。纯文本导出包含快照身份与 version，以及完整输入、交换、交互和输出。

`dag.run.get({ taskId, sessionId? })` 支持从保存的 Run 根记录重新连接；没有内存句柄时必须提供 sessionId，返回 `attachedFromStorage: true`。依靠 input.run（v1 目标/用量）与 input.runTasks 恢复任务树、最新节点、实例计数及 detached 标记。目标更新使用 Session shared 状态持久保存，读取优先于初始目标。`DagWorkbench.openRun(taskId, sessionId?)` 可打开这类记录。若需要继续调度，用 `DurableFlowExecutor.resume(sessionId, rootTaskId)` 从 `flow.run.<rootTaskId>.scheduler` 检查点恢复（检查点缺失或版本不支持时抛错；隔离 workspace 的恢复需要租约重建，同样抛错），`waitForCheckpoint(sessionId, rootTaskId, taskIds, timeoutMs?)` 可等待检查点已包含指定任务。旧根记录缺少 v1 元数据时拒绝猜测重建。

`prepareFlowTaskRetry(session, rootTaskId, sourceTaskId, requestId)` 返回已登记 Run 成员的 deferred 新 Task，要求非空请求 ID 和当前 Run 的终态源任务。成员含 nodeId/iteration/retryOfTaskId/budget，保存在 `flow.run.<rootTaskId>.retries`；RunGet、重连及 transcript 合并读取。此 API 不授权或启动，不重写旧根输出，也不重算下游，`retryFlowTask` 与 `FlowCommand.RunTaskRetry`（`dag.run.task.retry`）则继续按原 input 白名单和成员预算授权/启动，命令接受 `{ sessionId, taskId, targetTaskId, requestId, downstream? }`，返回新的 targetTaskId 与 retryOfTaskId。旧根输出不改写，新的 Task 结果进入成员查询/transcript；UI 已提供终态任务重试入口与来源标记，进行中禁重，失败复用请求身份；根结束后仍刷新活动成员。RunCancel 包括所有持久成员。

### 图级 retry（下游重算）

`requestFlowGraphRetry(session, rootTaskId, sourceTaskId, requestId)` 在单任务 retry 之上登记「重算下游」意图：

- 从持久化的调度检查点计算源节点的下游闭包（`downstreamNodes(source, nodes, edges)`，含回边，因此重试循环节点会重算整个环）；委派子节点与委派父节点被明确拒绝（它们由 group 的预算/等待策略拥有）。
- 调用 `retryFlowTask` 启动重试 Task（成员、预算、`retryOfTaskId` 语义与单任务 retry 一致），再以 CAS 追加意图到 Session shared `flow.run.<rootTaskId>.graph-retry`。
- 下一次调度回合（`resume` 或新宿主）消费意图：把重试 Task 作为该节点的最新实例，丢弃下游各节点已提交实例（取消未终态者）、清 `completed`/`skipped`、把入边重置为 `active`（route 边回到 `pending`），并递增这些节点的提交代数 `nodeGenerations`。代数进入节点 requestId（`flow:<root>:<node>#<iteration>@<generation>`），使重算实例不会命中旧提交的 Kernel 去重，而崩溃恢复的同代重提交仍复用原 Task。
- 要求 Run 可恢复（非终态且存在调度检查点）；已终态 Run 的根不可改写，因此拒绝。预算按实际执行累计，被丢弃实例已消耗的 token 不退款；工作区收尾仍由 Run 结束时统一执行。

回归：`packages/llm-flow/__tests__/graph-retry.test.ts`（闭包/回边/未知节点）、`durable-flow-executor.test.ts` 的「recomputes downstream nodes after a graph retry of an upstream node」。仍未完成：UI 的图级 retry 入口与结果收敛提示、委派组的图级重算。

并发重试的人工交互按具体 Task 匹配：`dag.run.respond` 接受可选 `targetTaskId`，先刷新持久成员清单并校验目标属于当前 Run；省略目标时，仅在所有成员中恰有一个同名 pending 请求时回应，多于一个则报歧义。Run 面板逐 Task 展示等待请求，回应窗口固定打开时的根 Task 与目标 Task，切换 Run 不改变提交目标。指定 targetTaskId 时支持已 resolved 交互同值重放，终态 Task 也可返回已保存结果；不同值拒绝。省略目标仍只搜索 pending 请求，不猜测已完成回应的目标。

Run 控制会在信号注入和单任务取消前刷新持久成员清单，允许控制其他调用方刚登记的重试任务；按 nodeId 注入信号选择当前最大 iteration 对应的任务，按 targetTaskId 则校验 Run 成员身份。Goal 编辑窗口固定打开时的 Run，信号和取消回调也固定发起时的 Run，异步完成不会刷新切换后的其他 Run；失败通过错误提示呈现。Goal 状态对 Session suspend/resume 的影响及其与目标持久化非原子的边界保持不变。

端口结构注册：`DagPluginRegistry.registerSchema(ref, schema)` / `getSchema(ref)`，或实现 `DagPluginCatalog.getSchema`。相同引用不得重复注册，返回值为副本。FlowSchemaRegistry / flowSchemaIssue / schemaCompatibilityIssue 从包出口导出。目标有 schema 的 data edge 必须解析到已注册定义；发布、直接执行和 patch 拒绝未知引用，下游创建前校验成功上游的实际消费值。id 不同一律拒绝；同一 id 版本不同时要求注册表能证明来源结构是目标结构的子类型（`llm-flow/src/flow/schema-compat.ts`：boolean schema、`integer ⊆ number`、enum 子集、object 的 required/properties/additionalProperties、array items 递归推导）。支持 boolean schema、type、properties、required、items、additionalProperties、enum 及 title/description 注释，未知关键字拒绝。无效数据使 submit 失败；不自动解析 JSON 字符串，不提供端口 repair 策略。

单次运行定义隔离：DurableFlowExecutor.submit 在首次异步操作前复制 DagRunSpec 和 parameters；初始节点的插件清单及其端口 schema 同时缓存，后续动态节点的定义在首次读取时缓存，包含未找到的引用。修改调用方原始对象或宿主之后返回的同名 schema 不影响已缓存定义。DagPluginRegistry 注册时复制清单并保留 runtime/UI 方法的调用接收者。此隔离不等于将定义持久化，也不冻结宿主 runtime 实现代码；跨进程恢复仍需额外持久定义机制。

工作区收尾：DurableFlowSnapshot.workspaceFinalization 返回 pending/succeeded/failed 与可选 message，来源为执行句柄状态或 Session shared `flow.run.<rootTaskId>.workspace`。执行器在清理前保存 pending，成功/失败后保存结果，workspaceCompletion 继续可等待并在失败时拒绝。Run 面板显示收尾状态，pending 时继续轮询，失败不改写根 Task 的成功结果。DagCommandServiceOptions.workspaceManager 可注入宿主管理器；本机制不负责崩溃后的清理重启。

工作区收尾的 status 表示清理本身的结果，和状态记录保存结果分开。清理成功但最终 shared 写入失败时，活动句柄保留 succeeded 并附加 persistenceError，workspaceCompletion 拒绝；UI 同时显示清理结果和保存错误。清理与保存同时失败以 AggregateError 保留两个原因，不重复调用 workspace.finish。此时重连只能读取最后成功写入的状态（可能仍为 pending），活动句柄的保存错误尚无可靠持久副本。
