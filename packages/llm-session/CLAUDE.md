# llm-session 开发说明

本包管理用户可见的对话语义，不运行或调度 Process；DAG 编排由 `@itookit/llm-flow` 负责。

## 约束

- Round 只表达对话历史，使用 `historyParentIds`。
- Run 引用通过 `executions` 附着到 Round。
- Branch、merge、context fold 只在本包实现。
- 普通 Chat 使用 Direct Scheduler，不能伪装成单节点 DAG。
- DAG/Flow 依赖 `@itookit/llm-flow`（本包通过它编排，不直接持有动态图语义）。
- 不访问 Harness Dispatcher、ProcessTable 等内部对象。
- 不接收旧 ChatNode manifest，不增加兼容迁移路径。

运行：

```bash
pnpm --filter @itookit/llm-session typecheck
pnpm --filter @itookit/llm-session test
```
