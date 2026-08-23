# 跨包接口契约

业务共享协议定义在 `@itookit/common`；执行协议由 `@itookit/durable-kernel` 提供，
能力抽象由 `@itookit/kernel-adapters` 提供，具体实现由 `app-shell` 注入。

## LLM 执行

| 接口 | 消费者 | 实现者 |
| --- | --- | --- |
| `DurableTaskProgram` | Kernel | llm-runtime、Conversation Flow |
| `SessionHandle` | Conversation、UI | Kernel |
| `TaskHandle` | Conversation、UI、CLI | Kernel |
| `EffectAdapter` | Kernel | kernel-adapters 插件及应用插件 |
| `KernelPlugin` | App Shell | kernel-adapters 与功能插件 |
| `DagPluginCatalog` | Conversation、UI | `FlowPluginRegistry` |
| `LLMCapability` | kernel-adapters Effect | App-shell LLM adapter |
| `ToolCapability` | kernel-adapters Effect | Tool service |
| `SkillCapability` | kernel-adapters Effect | Browser/Tauri adapter |

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
