# llm-session 开发说明

本包管理用户可见的对话语义，不运行或调度 Process；DAG 编排由 `@itookit/llm-flow` 负责。

## 约束

- Round 只表达对话历史，使用 `historyParentIds`。
- Run 引用通过 `executions` 附着到 Round。
- Branch、merge、context fold 只在本包实现。
- 普通 Chat 使用 Direct Scheduler，不能伪装成单节点 DAG。
- DAG/Flow 依赖 `@itookit/llm-flow`（本包通过它编排，不直接持有动态图语义）。
- 不访问 Kernel Dispatcher、ProcessTable 等内部对象。
- 不接收旧 ChatNode manifest，不增加兼容迁移路径。

## 联网搜索

- 三态 `ExecutorConfig.webSearchMode`（`WebSearchMode`）由 `AgentResolver.resolveWebSearch` 经 `resolveWebSearchStrategy` 解析。
- `ConversationRunCoordinator.directTaskSpec` 派生 `webSearch` 布尔（仅 builtin）+ 按 mode 剥离客户端 WebSearchTool。
- `applyOverrides` 中 `webSearchEnabled=false` → `webSearchMode='disabled'`。
- citations 投影为 `message:citations`（投影后不重复发射原始 citations）。
- 详见 [web-search.md](../../doc/web-search.md)。

运行：

```bash
pnpm --filter @itookit/llm-session typecheck
pnpm --filter @itookit/llm-session test
```
