# @itookit/common 开发说明

共享接口、类型、工具和 i18n。运行时包通过这里的协议解耦。

`src/` 分五组：`events/`（导航事件）、`i18n/`（`t()`/`setLocale`、zh-CN 与 en 资源、图标表）、`interfaces/`、`types/`、`utils/`。

## LLM 核心协议（@itookit/llm-common）

LLM 领域协议定义在独立包 `@itookit/llm-common`（`src/agent/`、`src/llm/`、`src/skills/`、`src/tools/`、`src/tty/`），本包 `index.ts` 通过 `export * from '@itookit/llm-common'` 保持向后兼容：

```text
llm-common/src/agent/   ← 关键文件
├── agent-event.ts       Agent 业务事件
├── conversation.ts      Round、ILog、Signal、ExecutionRef
├── dag-plugin.ts        DAG Manifest/Runtime/UI 协议
├── flow-definition.ts   FlowDraft、FlowRevision、Artifact
├── context-types.ts     ContextSnapshot
└── session.ts           ISession
```

边界：

- `ConversationRound.historyParentIds` 只表达对话历史。
- `ExecutionRef.taskId` 只关联 Conversation Round 与 Durable Task。
- `DagRunSpec.edges` 只表达节点依赖，执行时编译为 `TaskSpec.dependsOn`。
- Task 使用 `@itookit/durable-kernel` 的 Resource/Effect 契约，不得引用具体 Provider、Tool 或 VFS 实现。
- UI 通过 `@itookit/durable-kernel` 的 `SessionHandle` / `TaskHandle` 控制 Task。
- 联网搜索：`WebSearchMode` + `resolveWebSearchStrategy` 在 `llm-common/src/llm/connection.ts`；`Citation` 在 `llm-common/src/llm/completion.ts`。

## VFS 核心协议（@itookit/vfs-core）

VFS 协议与事件总线在 `@itookit/vfs-core`（`src/interfaces/` + `src/eventbus/`）：

| 层级 | 接口（位于 vfs-core） |
| --- | --- |
| 存储 | `IStorageBackend` |
| 系统管理 | `IVFSManager` |
| 文件系统视图 | `IFileSystem` |
| 驱动 | `IFileSystemDriver`（= `IFSDriver`）、`IFSMetaDriver` |
| 文件 | `IFile`、`AssetObj` |

## 命令

```bash
pnpm --filter @itookit/common build       # tsup
pnpm --filter @itookit/common typecheck
```

## 约束

- 新增跨包 LLM 协议定义在 `@itookit/llm-common`，VFS 协议定义在 `@itookit/vfs-core`，本包不再新增协议。
- 接口优先使用 `interface`，判别联合使用 `type`。
- 公共协议不得 import 上层包。
- 不在本包实现 Kernel、Session Service 或 UI Projection。
- 新增 i18n key 时同步更新中英文资源（`src/i18n/zh-CN.ts` → `en.ts`）。

相关文档：[架构设计](../../doc/architecture.md)、[接口契约](../../doc/interface-contracts.md)
