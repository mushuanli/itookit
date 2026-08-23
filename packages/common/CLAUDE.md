# @itookit/common 开发说明

共享接口、类型、工具和 i18n。运行时包通过这里的协议解耦。

## LLM 核心协议（@itookit/llm-common）

LLM 领域协议已拆分为独立包 `@itookit/llm-common`（`llm-common/src/agent/`、`llm-common/src/llm/`、`llm-common/src/skills/` 等），本包 `index.ts` re-export 保持向后兼容：

```text
llm-common/src/agent/
├── agent-event.ts       Agent 业务事件
├── conversation.ts      Round、ILog、Signal
├── dag-plugin.ts        DAG Manifest/Runtime/UI 协议
├── flow-definition.ts   FlowDraft、FlowRevision、Artifact
├── context-types.ts     ContextSnapshot
└── session.ts           Session 事件与状态
```

边界：

- `ConversationRound.historyParentIds` 只表达对话历史。
- `ExecutionRef.taskId` 只关联 Conversation Round 与 Durable Task。
- `DagRunSpec.edges` 只表达节点依赖，执行时编译为 `TaskSpec.dependsOn`。
- Task 使用 Kernel Resource/Effect 契约，不得引用具体 Provider、Tool 或 VFS 实现。
- UI 通过 `SessionHandle` 和 `TaskHandle` 控制 Task。
- 联网搜索：`WebSearchMode` + `resolveWebSearchStrategy` 在 `llm-common/llm/connection.ts`；`Citation` 在 `llm-common/llm/completion.ts`。

## VFS 核心协议（@itookit/vfs-core）

VFS 协议与事件总线已迁至 `@itookit/vfs-core`（`vfs-core/src/interfaces/` + `vfs-core/src/eventbus/`）：

| 层级 | 接口（位于 vfs-core） |
| --- | --- |
| 存储 | `IStorageBackend` |
| 系统管理 | `IVFSManager` |
| 模块 | `IModuleFS` |
| 驱动 | `IFSDriver`、`IFSMetaDriver` |
| 文件 | `IFile`、`AssetObj` |

## 约束

- 新增跨包 LLM 协议定义在 `@itookit/llm-common`，VFS 协议定义在 `@itookit/vfs-core`，本包不再新增协议。
- 接口优先使用 `interface`，判别联合使用 `type`。
- 公共协议不得 import 上层包。
- 不在本包实现 Kernel、Session Service 或 UI Projection。
- 新增 i18n key 时同步更新中英文资源。
