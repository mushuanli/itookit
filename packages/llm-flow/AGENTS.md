# llm-flow 开发说明

本包是 DAG 编排层：把 `llm-tasks` 的 LLM 任务单元连成动态图（route/loop/spawn/compensate/on_failure/budget），并持久化 Flow 定义。详见 [llm-flow API](../../doc/llm-flow-api.md)。

## 目录

```text
src/
├── index.ts                  统一导出
├── flow-definition-store.ts  FlowDefinitionStore（最小 FlowStore 接口 + 版本冲突）
└── flow/
    ├── executor.ts           DurableFlowExecutor（动态图调度 / 补偿 / 工作区）
    ├── builtin-plugins.ts    内置插件 transform/reduce/route/spawn/flow/human/agent
    ├── programs.ts           FlowValue / FlowHuman / FlowAggregate Program
    ├── operations.ts         transform/reduce/route/spawn 纯操作
    ├── plugin-registry.ts    插件注册表 + schema 注册
    ├── to-dag.ts             FlowRevision → DagRunSpec
    ├── validation.ts         Flow 校验（环检测、预算校验）
    ├── graph.ts              泛型 findCycles
    ├── commands.ts           DagCommandService
    ├── delegation-runtime.ts 动态委派（fan-out / join / 预算）
    ├── parameters.ts         运行参数模板解析与校验
    ├── connections.ts        节点连接槽解析
    ├── run-members.ts        运行成员读取与重试准备
    └── workflow/             工作流 DSL：类型 + compile + route 表达式
```

## 约束

- 只编排 DAG，不持有会话语义（Round/Branch/SessionRepository 属于 llm-session）。
- 不依赖 llm-session、UI、DOM 或具体设备；能力通过 kernel Effect 使用。
- FlowDefinitionStore 只依赖最小 `FlowStore` 接口（listFiles/findFile/createFile/readFile/writeFile/renameFile/deleteFile/createAsset/readAsset/listAssets），由会话层的 `FlowEngine`（`llm-session/src/persistence/flow-engine.ts`，`flows` VFS 模块）适配。

运行：

```bash
pnpm --filter @itookit/llm-flow typecheck
pnpm --filter @itookit/llm-flow test
```
