# @itookit/llm-flow

DAG 编排层：把 `llm-tasks` 的 LLM 任务单元连成动态图（route / loop / spawn / supervisor / compensate / on_failure / budget），并持久化 Flow 定义。

```bash
pnpm --filter @itookit/llm-flow typecheck
pnpm --filter @itookit/llm-flow test
```

- 开发说明：[AGENTS.md](./AGENTS.md)
- API：[doc/llm-flow-api.md](../../doc/llm-flow-api.md)
- 设计：[doc/design/flow-execution-model.md](../../doc/design/flow-execution-model.md)
