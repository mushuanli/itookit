# 跨包接口契约

所有接口定义在 `@itookit/common`，具体实现通过 `app-shell/bootstrap.ts` 注入。

## VFS 体系

| 接口 | 所在文件 | 消费者 | 实现者 |
|---|---|---|---|
| `IVFSManager` | `common/interfaces/fs/services/vfs-manager.ts` | `app-shell`, 各 Service | `vfslib/VFSManager` |
| `IModuleFS` | `common/interfaces/fs/services/module-fs.ts` | 所有需要文件操作的 Service | `vfslib/ModuleFS` |
| `ISessionEngine` | `common/interfaces/ISessionEngine.ts` | `vfs-ui`, `memory-manager` | `vfslib/VFSModuleEngine`, `llm-engine/LLMSessionEngine`, `app-settings/SkillsEngine` |
| `IStorageBackend` | `common/interfaces/fs/storage/backend.ts` | `vfslib/VFSEngine` | `vfsdriver-indexeddb`, `vfsdriver-fs` |
| `IConfigService` | `common/interfaces/fs/services/config-service.ts` | `app-settings`, 各 Service | `vfslib/ConfigService` |

## LLM 体系

| 接口 | 所在文件 | 消费者 | 实现者 |
|---|---|---|---|
| `IAgentRuntime` | `common/interfaces/agent/agent-service.ts` | `llm-engine`, `llm-ui` | `llm-harness/AgentLoopExecutor` |
| `ILLMService` | `common/interfaces/llm/llm-service.ts` | `llm-harness` | `llm-harness/LLMServiceAdapter` |
| `IDeviceDriver` | `common/interfaces/fs/device/device.ts` | `vfslib` (VFS 设备树) | `device-llm/LLMDeviceDriver` |
| `IToolService` | `common/interfaces/tools/tool-service.ts` | `llm-harness`, `llm-engine` | `llm-harness/ToolDeviceDriver` |
| `ISkillService` | `common/interfaces/skills/skill-service.ts` | `llm-harness`, `llm-engine` | `llm-harness/SkillDeviceDriver` |
| `ILLMSessionEngine` | `llm-engine/persistence/types.ts` | `llm-ui`, `llm-engine` | `llm-engine/LLMSessionEngine` |

## UI 体系

| 接口 | 所在文件 | 消费者 | 实现者 |
|---|---|---|---|
| `ISessionUI` | `common/interfaces/ISessionUI.ts` | `memory-manager` | `vfs-ui/VFSUIShell` |
| `IEditor` | `common/interfaces/IEditor.ts` | `vfs-ui` (editor-connector) | `mdx/MDxEditor`, `llm-ui/LLMWorkspaceEditor` |
| `EditorFactory` | `common/interfaces/IEditorFactory.ts` | `memory-manager` | 各编辑器的工厂函数 |
| `ISettingsWidget` | `common/interfaces/ISettingsWidget.ts` | `app-settings/SettingsEngine` | 各 Settings Editor |
