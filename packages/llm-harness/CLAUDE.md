# llm-harness 开发说明

本包是 LLM Process Kernel，负责生命周期、资源注入、调度和编排插件。

## 目录

```text
src/
├── kernel/       HarnessKernel、Dispatcher、ProcessTable
├── scheduling/   SchedulingPolicy、DirectScheduler、DagScheduler
├── plugins/      DAG Manifest/Runtime/UI 注册
├── persistence/  Event 与 Checkpoint Store
├── adapters/     外部服务到资源端口的适配
└── tools/        进程可用工具
```

## 约束

- Dispatcher 不理解 Chat、Round、DAG 节点类型。
- Scheduler 只决定何时提交 Process。
- DAG 节点行为必须通过 `DagPluginCatalog` 加载。
- UI、CLI 只通过 `RunHandle` 控制执行。
- Budget、Capability、并发属于 Harness 资源策略。
- 新 Provider、Tool、VFS 通过端口注入，不能成为 Engine 硬依赖。

运行：

```bash
pnpm --filter @itookit/llm-harness typecheck
pnpm --filter @itookit/llm-harness exec vitest run
```
