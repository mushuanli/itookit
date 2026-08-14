# llm-flow 开发说明

本包是 DAG 编排层：把 `llm-programs` 的 LLM 任务单元连成动态图（route/loop/spawn/compensate/on_failure/budget），并持久化 Flow 定义。

## 目录

```text
src/
├── index.ts                   统一导出
├── flow-definition-store.ts   Flow 定义持久化（依赖最小 FlowAssetStore 接口）
└── flow/
    ├── executor.ts            DurableFlowExecutor（动态图调度）
    ├── builtin-plugins.ts     transform/reduce/route/spawn/agent/human 插件
    ├── programs.ts            FlowValue / FlowHuman / FlowAggregate Program
    ├── operations.ts          transform/reduce/route/spawn 纯操作
    ├── to-dag.ts              FlowDraft → DagRunSpec
    ├── validation.ts          Flow 校验（含环检测）
    ├── graph.ts               泛型 findCycles
    ├── plugin-registry.ts     插件注册表
    └── commands.ts            DagCommandService
```

## 约束

- 只编排 DAG，不持有会话语义（Round/Branch/ChatEngine 属于 llm-session）。
- 不依赖 llm-session、UI、DOM 或具体设备；能力通过 harness Effect 使用。
- FlowDefinitionStore 只依赖最小 `FlowAssetStore` 接口，由会话层的 `IChatEngine` 适配。

运行：

```bash
pnpm --filter @itookit/llm-flow typecheck
pnpm --filter @itookit/llm-flow test
```
