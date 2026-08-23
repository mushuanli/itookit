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
    resolveTools?(sessionId, allowedIds): Promise<{
        definitions: ToolDefinition[];
        externalIds: string[];
    }>;
}
```

**`FlowExecutionHandle`** —— 一次 DAG 运行的句柄：

```ts
interface FlowExecutionHandle {
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

**`DagCommandServiceOptions`**：`{ flowStore: FlowDefinitionStore; kernel: Kernel; plugins: DagPluginCatalog; resolveTools? }`。

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
