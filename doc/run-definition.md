# RunDefinition

`RunDefinition` 是 YAML 与 `.flow` 两种输入格式的 canonical 运行时定义。

## 数据流

```text
mindos.yml ──┐
             ├→ RunDefinition → DagRunSpec
*.flow ──────┘
```

- `RunDefinition`：统一身份、图、参数、环境和策略。
- `DagRunSpec`：`DurableFlowExecutor` 的执行输入。
- `RunRecord`：运行状态投影；权威 Task/Effect 状态仍在 durable-kernel。

当前实现：

- CLI YAML 已通过 `apps/cli/src/run-definition.ts` 编译为 `RunDefinition`；
- `.flow` 已通过 `packages/app-core/src/run/run-definition.ts` 的 `createRunDefinitionFromFlow()` 转为 `RunDefinition`；
- `RunDefinition → DagRunSpec` 已通过 `toDagRunSpec()` 实现，CLI `run` 已走该路径；
- CLI `run -f xxx.flow` 已支持 inline `.flow` 节点和 desktop profile LLM 配置；
- `RunCatalog` 只读投影已提供；
- `.flow` 的 `agentId` / `systemPromptId` / `skillIds` 引用解析已由 `packages/llm-session/src/session/flow-node-binder.ts`（`bindFlowNode` / `bindStandaloneFlowNode`）实现，并被 `packages/llm-session/src/session/session-run-coordinator.ts` 与 `DagCommandService` 使用；CLI `.flow` 入口（`apps/cli/src/commands.ts` 调用 `createRunDefinitionFromFlow()` 时未传 `bind`）与 Tauri Runs 视图仍待接线。

## 字段

```ts
interface RunDefinition {
  id: string;
  name: string;
  revision: number;
  digest: string;
  source: 'yaml' | 'flow';
  graph: {
    nodes: DagNodeDefinition[];
    edges: DagEdgeDefinition[];
    nodeDefaults?: Record<string, Record<string, JsonValue>>;
    nodeConnections?: Record<string, Record<string, JsonValue>>;
    maxNodes?: number;
  };
  parameters?: FlowParameter[];
  environment: {
    providers?: RunProviderConfig[];
    connections?: RunConnectionConfig[];
    agents?: RunAgentConfig[];
    sandbox?: RunSandboxConfig;
  };
  policy: {
    runPolicy?: FlowRunPolicy;
    result?: { task: string; output: string };
    workspaceRoot?: string;
    additionalDirectories?: Array<{ path: string; access: 'ro' | 'rw'; at?: string }>;
  };
  metadata?: Record<string, JsonValue>;
  createdAt: number;
}
```

`apiKeyEnv` 只记录环境变量名，密钥由 host 的 `CredentialResolver` 解析，不进入 RunDefinition 快照。

## CLI 参数映射

| CLI | RunDefinition |
|---|---|
| `--profile <name>` | 选择数据根，不属于 RunDefinition |
| `--set-home <dir>` | `policy.workspaceRoot`，并生成 `/workspace` Session mount |
| `--add-dir <dir>[:ro\|rw]` | 尚未映射：CLI 只把目录作为宿主挂载交给 `CliRuntimeOptions.addDir` → `DirectoryMountService`，从不写入 `policy.additionalDirectories` |
| `-f mindos.yml` | `source: 'yaml'`，编译 YAML 后填充 graph/environment |
| `.flow` 输入 | `source: 'flow'`，从 `FlowRevision` 编译 |

## 状态与投影

`RunRecord` 只保存跨入口恢复和控制所需的最小状态：

```ts
interface RunRecord {
  id: string;
  sessionId: string;
  definitionId: string;
  definitionRevision: number;
  definitionDigest: string;
  status: RunStatus;
  rootTaskId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  resultPath?: string;
}
```

`events.jsonl`、`result.json` 和 CLI stdout/JSONL 是投影，不是权威状态。

CLI Agent memory_policy 经 memoryPolicyForAgent 转换为 RunAgentConfig.memoryPolicy 与节点 config.memoryPolicy，嵌套 scope/retention 深复制；RunDefinition 保留该策略快照。记忆工具权限仍要求节点 capabilities 中显式列出 memory_list/write/remove，namespace 不赋予跨 Session 共享。
