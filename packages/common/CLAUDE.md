# @itookit/common 开发说明

共享接口、类型、工具、i18n 和 EventBus。运行时包通过这里的协议解耦。

## LLM 核心协议

```text
interfaces/agent/
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
- Task 使用 Harness Resource/Effect 契约，不得引用具体 Provider、Tool 或 VFS 实现。
- UI 通过 `SessionHandle` 和 `TaskHandle` 控制 Task。

## VFS 核心协议

| 层级 | 接口 |
| --- | --- |
| 存储 | `IStorageBackend` |
| 系统管理 | `IVFSManager` |
| 模块 | `IModuleFS` |
| 驱动 | `IFSDriver`、`IFSMetaDriver` |
| 文件 | `IFile`、`AssetObj` |

## 约束

- 跨包协议必须定义在本包。
- 接口优先使用 `interface`，判别联合使用 `type`。
- 公共协议不得 import 上层包。
- 不在本包实现 Harness、Session Service 或 UI Projection。
- `FSNode` 使用前必须按 `type` 收窄。
- 新增 i18n key 时同步更新中英文资源。
