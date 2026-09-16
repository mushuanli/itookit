# llm-session 开发说明

本包管理用户可见的对话语义与运行协调，不实现执行内核（Task 执行由 `@itookit/durable-kernel` 负责）；DAG 编排由 `@itookit/llm-flow` 负责。详见 [llm-session API](../../doc/llm-session-api.md)。

## 目录

```text
src/
├── session/        会话语义：SessionManager / BranchService / ConversationRunCoordinator /
│                   SessionRunCoordinator / AgentResolver / SessionState
├── persistence/    持久化与投影：RoundLog / RoundGraphService / SessionRepository /
│                   FlowEngine（flows VFS 模块）/ 会话与对话投影
├── services/       Agent 配置契约 / PromptHistoryService / VFSAgentService
├── plugins/        history / session / vcs 命令插件
├── core/           类型、CommandBus、ExtensionRegistry
└── utils/          日志、错误格式化、VFS 实体存储
```

## 约束

- Round 只表达对话历史，使用 `historyParentIds`。
- Run 引用通过 `executions` 附着到 Round。
- Branch、merge、context fold 只在本包实现（`BranchService` / `RoundLog`）。
- Chat/Agent 与 Flow 的提交统一经过 llm-flow 的 `submitRun(CompiledRunDefinition)`；上下文组装和结果解析保留各自策略，运行成员使用 `RunExecution.tasks()` 实时读取。
- 普通 Chat 走 `ConversationRunCoordinator` 的直接任务路径（`directTaskSpec`），不包装成单节点 DAG。
- DAG/Flow 依赖 `@itookit/llm-flow`（本包通过它编排，不直接持有动态图语义）。
- 只通过 `@itookit/durable-kernel` 公开类型（`Kernel` / `SessionHandle` 等）与 Effect 访问内核，不触碰内核内部实现。

Flow 重新运行通过 `FlowRerunService` 校验参数并创建替代分支，调用参数固定在 `Round.flow`。`FlowHistory` 将 Task 事件投影为 History 交互并存入 `RoundResult.flowInteractions`，与模型 history 独立；内部逻辑节点不展示，流式内容按 Task 隔离。见 [Flow 能力与输出](../../doc/design/flow-capabilities-and-output.md)。

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

Memory 默认使用 Session shared；显式 sharedMemory 引用经 SharedMemoryStore 的独立 SeqFile 与 Session/scope grants 授权。数据、操作回执、审计在同一事务写入；管理权限不暴露为模型工具。memory_compact 复验源版本与读写授权，保留原文和来源引用。语义检索仍延期。

CLI 使用共享 `FlowRunProjection` 按根 Task 幂等写入 History Round；节点、工具、输入和批准携带 `FlowActor` 身份。Skill 作为节点/工具来源展示，工具调用按 Task 和 call ID 隔离；分支切换保留 Flow 交互。验证见 [CLI 能力验收](../../doc/design/flow-cli-capabilities-verification.md)。
