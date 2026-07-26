# 跨包接口契约

所有跨包协议定义在 `@itookit/common`，具体实现由 `app-shell` 注入。

## LLM 执行

| 接口 | 消费者 | 实现者 |
| --- | --- | --- |
| `ProcessProgram` | Harness | llm-engine、DAG 插件 |
| `ProcessHost` | Conversation | HarnessKernel |
| `HarnessControlPlane` | UI、CLI | HarnessKernel |
| `SchedulerModule` | HarnessKernel | DirectScheduler、DagScheduler |
| `SchedulingPolicy` | Dispatcher | FifoSchedulingPolicy |
| `DagPluginCatalog` | Conversation、UI、DagScheduler | DagPluginRegistry |
| `LLMPort` | ProcessProgram | LLMServiceAdapter |
| `ToolPort` | ProcessProgram | Tool service |
| `VfsPort` | ProcessProgram | App-shell VFS adapter |

## Conversation

| 接口 | 消费者 | 实现者 |
| --- | --- | --- |
| `IChatEngine` | Conversation、UI 工厂 | ChatEngine |
| `ICommandBus` | UI | Conversation CommandBus |
| `ConversationRound` | Conversation | RoundLog |

## VFS/UI

| 接口 | 消费者 | 实现者 |
| --- | --- | --- |
| `IVFSManager` | App-shell、服务 | vfslib |
| `IModuleFS` | 文件工作区 | vfslib |
| `ISessionUI` | memory-manager | vfs-ui |
| `IEditor` | vfs-ui | 各编辑器 |
