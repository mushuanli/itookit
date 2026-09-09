# @itookit/llm-flow — API 参考

> DAG 编排层：把 `llm-tasks` 的 LLM 任务单元连成动态图（route/loop/spawn/compensate/on_failure/budget），并持久化 Flow 定义。提供 `DurableFlowExecutor`（动态图调度）、`DagCommandService`（命令面）、内置 Flow Programs 与插件。所有 API 从 `@itookit/llm-flow` 根导出。

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
    async submit(sessionId: string, spec: DagRunSpec): Promise<FlowExecutionHandle>;
}
```

**`DurableFlowExecutorOptions`**：

```ts
interface DurableFlowExecutorOptions {
    kernel: Kernel;                            // 执行内核
    plugins: DagPluginCatalog;                   // 插件目录（节点类型 → Manifest）
    sessionContext?: { projectInstructions: string; skillInstructions: string; skillIndex: string };
    bindPatchNode?(sessionId: string, node: DagNodeDefinition, defaults?: Record<string, unknown>): Promise<Partial<Pick<DagNodeDefinition, 'config' | 'inputs'>>>;
    resolveTools?(sessionId, allowedIds): Promise<{
        definitions: ToolDefinition[];
        externalIds: string[];
    }>;
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

**其他导出**：`upstreamOf(edges, nodeId): string[]` —— 取某节点的上游边。

---

## Flow Programs

三个内置 Program（注册为 `flow.*@1`），节点类型为 value / human / aggregate：

| Program | manifest | 输入 | 输出 |
|---|---|---|---|
| `FlowValueProgram` | `flow.value@1` | `FlowValueInput`（含 `op` 纯操作 + 依赖） | `DagNodeOutcome` |
| `FlowHumanProgram` | `flow.human@1` | `FlowHumanInput`（HITL 交互） | `DagNodeOutcome` |
| `FlowAggregateProgram` | `flow.aggregate@1` | `FlowAggregateInput`（聚合策略） | `JsonValue` |

**`FlowDependencyBinding`**：`{ taskId: string; output?: string; … }` —— 节点对上游输出的引用。

**纯操作**（`operations.ts`，供 `FlowValueProgram` 使用）：

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

**`DagCommandServiceOptions`**：`{ flowStore: FlowDefinitionStore; kernel: Kernel; plugins: DagPluginCatalog; resolveTools?; resolveSessionContext?; bindNode? }`。`bindNode(sessionId, node, defaults?)` 用于静态/Composite 编译及动态 patch 身份解析；动态节点传入产生节点所属 Flow 的 defaults。编译结果 `DagRunSpec.nodeDefaults` 保存按节点划分的默认身份层，Composite 展开保留子 Flow 的作用域；执行器提交时冻结它，并由动态 patch/委派后代沿用。默认配置不扩大动态节点的原能力声明。`DagRunSpec.nodeConnections` 同样按节点保存连接别名、默认槽位与宿主回退连接，供动态 patch 和委派子节点在提交前解析，Composite 保留子 Flow 的作用域。动态绑定在整批发布前完成，仅采用 config/inputs，并保留原工具能力、预算及委派调度策略；递归保留 resolvedTemplate 的身份内容，将每级模板能力限定为原声明，缺省为空。`resolveSessionContext(sessionId, userMessage)` 返回项目规则、已加载 Skill 规则及 Skill 索引；独立入口传空 userMessage，由执行器冻结并提供给每个 Agent 实例。

**`DurableFlowSnapshot`**：运行快照类型（命令面查询用）。

---

## Flow 定义持久化

```ts
class FlowDefinitionStore {
    constructor(engine: FlowAssetStore, flowDirName: string, plugins: DagPluginCatalog);
    async createDraft(input: { id: string; name: string }): Promise<FlowDraft>;
    async listDrafts(): Promise<FlowDraft[]>;
    async loadDraft(id: string): Promise<FlowDraft | null>;
    async saveDraft(draft: FlowDraft, expectedDraftVersion: number): Promise<FlowDraft>;
    async saveRevision(revision: FlowRevision): Promise<FlowRevision>;
    // …
}
```

**`FlowAssetStore`**（最小存储接口，由 `IChatEngine` 适配）：

```ts
interface FlowAssetStore {
    getAssets(ownerNodeId: string): Promise<Array<{ path?: string; name?: string }>>;
    createAsset(ownerNodeId: string, filename: string, content: string | ArrayBuffer): Promise<unknown>;
    readAsset(ownerNodeId: string, filename: string): Promise<string | ArrayBuffer | null>;
}
```

**`FlowDraftVersionConflictError`**：草稿版本冲突（CAS 失败）抛错。

---

## DAG 编译

```ts
type FlowNodeBinder = (…args) => …;                 // Flow 节点 → TaskSpec 绑定器
flowToDag(flow: FlowDraft, binders): DagRunSpec;     // FlowDraft → DagRunSpec
findCycles(nodes: GraphNode[], edges: GraphEdge[]): GraphCycles;   // 通用环检测
```

**`GraphNode`** / **`GraphEdge`** / **`GraphCycles`**：泛型图结构（`node.id` / `edge.from→to`），`findCycles` 返回环集合。

---

## 校验

```ts
interface ValidationIssue { … }                     // 校验问题（severity/message/path）
validateFlowRevision(flow: FlowRevision): ValidationIssue[];   // 结构 + 环 + 引用校验
flowRevisionDigest(flow: Omit<FlowRevision, 'digest'>): string; // 修订摘要（内容寻址）
```

---

## 插件

```ts
class DagPluginRegistry implements DagPluginCatalog { … }       // 插件注册表
createBuiltinDagPluginRegistry(): DagPluginRegistry;            // 内置插件（transform/reduce/route/spawn/agent/human）
```

内置插件集：`transform`、`reduce`、`route`、`spawn`、`agent`、`human`（节点类型 → Manifest/UI Contribution）。

---

## 源码结构：文件与路径

`@itookit/llm-flow` 的公共 API 从 `packages/llm-flow/src/index.ts` 根导出（barrel 转发 `flow/index.ts`）。包内结构：

```
packages/llm-flow/src/
├── index.ts                   根导出（flow/* + FlowDefinitionStore）
├── flow-definition-store.ts   FlowDefinitionStore + FlowAssetStore + FlowDraftVersionConflictError
└── flow/
    ├── index.ts               flow 层 barrel
    ├── executor.ts            DurableFlowExecutor + DurableFlowExecutorOptions/FlowExecutionHandle/upstreamOf
    ├── commands.ts            DagCommandService + DagCommandServiceOptions/DurableFlowSnapshot
    ├── programs.ts            FlowValueProgram/FlowHumanProgram/FlowAggregateProgram + 输入类型
    ├── operations.ts          transformOutcome/spawnOutcome/reduceOutcome/routeOutcome（纯操作）
    ├── to-dag.ts              flowToDag + FlowNodeBinder
    ├── validation.ts          validateFlowRevision/flowRevisionDigest + ValidationIssue
    ├── graph.ts               findCycles + GraphNode/GraphEdge/GraphCycles
    ├── plugin-registry.ts     DagPluginRegistry
    ├── builtin-plugins.ts     createBuiltinDagPluginRegistry（内置插件集）
    └── (无持久化路径常量 — Flow 草稿/修订经 FlowAssetStore 落到会话资产目录，见 llm-session)
```

**约定**：只编排 DAG，不持有 Round/Branch/ChatEngine 语义；不依赖 `llm-session`、UI、DOM 或具体设备；`FlowDefinitionStore` 只依赖最小 `FlowAssetStore` 接口（由 `IChatEngine` 适配），Flow 修订以 JSON asset 形式持久化在会话资产目录（默认 `llm-flows/`，见 `llm-session` 的 `initializeConversationSystem`）。

## 持久任务 Transcript

`FlowCommand.RunTranscript`（`dag.run.transcript`）接受 `{ sessionId, taskId, targetTaskId }`，taskId 是 Run 根聚合任务 ID。返回 `FlowTaskTranscript`，包含任务 input/output、status/version、完整持久 Effect 交换与 interaction 记录；也可直接调用 `readFlowTaskTranscript(kernel, sessionId, runTaskId, taskId)`。以根任务 input.runTasks 验证归属，无需原 DagCommandService 句柄，拒绝其他 Run 的任务。runTasks 包含全部循环实例、未汇总及 detached 节点。支持可选 `query: { version?, offset?, limit? }`：默认每页 100 条 Effect、最多 500 条，返回 totalEffects 与可选 nextOffset。后续页携带首屏 version 固定历史快照；未提供 version 的非零 offset 拒绝。这是结构化记录；DagWorkbench 的任务记录对话框按交换分段展示并支持 JSON 和 UTF-8 纯文本文件导出，加载更多会合并同一版本的交换，全部加载完才启用导出。底层仍整任务读取，输入/输出/interaction 不分页，尚无字节上限。纯文本导出包含快照身份与 version，以及完整输入、交换、交互和输出。

`dag.run.get({ taskId, sessionId? })` 支持从保存的 Run 根记录重新连接；没有内存句柄时必须提供 sessionId，返回 `attachedFromStorage: true`。依靠 input.run（v1 目标/用量）与 input.runTasks 恢复任务树、最新节点、实例计数及 detached 标记。目标更新使用 Session shared 状态持久保存，读取优先于初始目标。`DagWorkbench.openRun(taskId, sessionId?)` 可打开这类记录。调度循环及 workspace 收尾没有恢复，旧根记录缺少 v1 元数据时拒绝猜测重建。

`prepareFlowTaskRetry(session, rootTaskId, sourceTaskId, requestId)` 返回已登记 Run 成员的 deferred 新 Task，要求非空请求 ID 和当前 Run 的终态源任务。成员含 nodeId/iteration/retryOfTaskId/budget，保存在 `flow.run.<rootTaskId>.retries`；RunGet、重连及 transcript 合并读取。此 API 不授权或启动，不重写旧根输出，也不重算下游，`retryFlowTask` 与 `FlowCommand.RunTaskRetry`（`dag.run.task.retry`）则继续按原 input 白名单和成员预算授权/启动，命令接受 `{ sessionId, taskId, targetTaskId, requestId }`，返回新的 targetTaskId 与 retryOfTaskId。旧根输出不改写，新的 Task 结果进入成员查询/transcript；UI 已提供终态任务重试入口与来源标记，进行中禁重，失败复用请求身份；根结束后仍刷新活动成员。RunCancel 包括所有持久成员。下游重算与图级结果收敛尚未完成。

并发重试的人工交互按具体 Task 匹配：`dag.run.respond` 接受可选 `targetTaskId`，先刷新持久成员清单并校验目标属于当前 Run；省略目标时，仅在所有成员中恰有一个同名 pending 请求时回应，多于一个则报歧义。Run 面板逐 Task 展示等待请求，回应窗口固定打开时的根 Task 与目标 Task，切换 Run 不改变提交目标。指定 targetTaskId 时支持已 resolved 交互同值重放，终态 Task 也可返回已保存结果；不同值拒绝。省略目标仍只搜索 pending 请求，不猜测已完成回应的目标。

Run 控制会在信号注入和单任务取消前刷新持久成员清单，允许控制其他调用方刚登记的重试任务；按 nodeId 注入信号选择当前最大 iteration 对应的任务，按 targetTaskId 则校验 Run 成员身份。Goal 编辑窗口固定打开时的 Run，信号和取消回调也固定发起时的 Run，异步完成不会刷新切换后的其他 Run；失败通过错误提示呈现。Goal 状态对 Session suspend/resume 的影响及其与目标持久化非原子的边界保持不变。

端口结构注册：`DagPluginRegistry.registerSchema(ref, schema)` / `getSchema(ref)`，或实现 `DagPluginCatalog.getSchema`。相同引用不得重复注册，版本精确匹配，返回值为副本。FlowSchemaRegistry / flowSchemaIssue 从包出口导出。目标有 schema 的 data edge 必须解析到已注册定义；发布、直接执行和 patch 拒绝未知引用，下游创建前校验成功上游的实际消费值。支持 boolean schema、type、properties、required、items、additionalProperties、enum 及 title/description 注释，未知关键字拒绝。无效数据使 submit 失败；不自动解析 JSON 字符串，不提供结构子类型推导或端口 repair 策略。

单次运行定义隔离：DurableFlowExecutor.submit 在首次异步操作前复制 DagRunSpec 和 parameters；初始节点的插件清单及其端口 schema 同时缓存，后续动态节点的定义在首次读取时缓存，包含未找到的引用。修改调用方原始对象或宿主之后返回的同名 schema 不影响已缓存定义。DagPluginRegistry 注册时复制清单并保留 runtime/UI 方法的调用接收者。此隔离不等于将定义持久化，也不冻结宿主 runtime 实现代码；跨进程恢复仍需额外持久定义机制。

工作区收尾：DurableFlowSnapshot.workspaceFinalization 返回 pending/succeeded/failed 与可选 message，来源为执行句柄状态或 Session shared `flow.run.<rootTaskId>.workspace`。执行器在清理前保存 pending，成功/失败后保存结果，workspaceCompletion 继续可等待并在失败时拒绝。Run 面板显示收尾状态，pending 时继续轮询，失败不改写根 Task 的成功结果。DagCommandServiceOptions.workspaceManager 可注入宿主管理器；本机制不负责崩溃后的清理重启。

工作区收尾的 status 表示清理本身的结果，和状态记录保存结果分开。清理成功但最终 shared 写入失败时，活动句柄保留 succeeded 并附加 persistenceError，workspaceCompletion 拒绝；UI 同时显示清理结果和保存错误。清理与保存同时失败以 AggregateError 保留两个原因，不重复调用 workspace.finish。此时重连只能读取最后成功写入的状态（可能仍为 pending），活动句柄的保存错误尚无可靠持久副本。
