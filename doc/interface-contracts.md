# 跨包接口契约

调用方只依赖接口，不依赖实现。所有接口定义在 `packages/common/src/interfaces/`。

## VFS 体系

| 接口 | 核心方法 | 定义文件 | 实现 | 消费 |
|---|---|---|---|---|
| `IStorageBackend` | `stat`, `list`, `read`, `write`, `mkdir`, `delete`, `rename` | `common/interfaces/fs/storage/backend.ts` | `vfsdriver-indexeddb`, `vfsdriver-localfs` | `vfslib (VFSEngine)` |
| `IVFSManager` | `getEngine()`, `mountModule()`, `on()` | `common/interfaces/fs/services/vfs-manager.ts` | `vfslib (VFSManager)` | `app-shell`, `memory-manager` |
| `IModuleFS` | `openFile()`, `driver`, `meta`, `capabilities` | `common/interfaces/fs/services/module-fs.ts` | `vfslib (ModuleFS)` | `vfs-ui`, `mdx`, `llm-ui` |
| `IFSDriver` | `read`, `write`, `create`, `delete`, `getChildren`, `stat`, `search` | `common/interfaces/fs/services/fs-driver.ts` | `ModuleFS.driver` | `vfs-ui`, editors |
| `IFSMetaDriver` | `putAsset`, `getAsset`, `setTags`, `watch` | `common/interfaces/fs/services/fs-meta-driver.ts` | `ModuleFS.meta` | `mdx` |
| `IFile` | `read()`, `write()`, `asset()` | `common/interfaces/fs/` | `FileHandle`, `MDXFileHandle`, `ChatFileHandle` | `mdx`, `llm-engine` |

## LLM 体系

| 接口/类型 | 核心字段/方法 | 定义文件 | 实现 | 消费 |
|---|---|---|---|---|
| `LLMProvider` | `id`, `implementation`, `baseURL`, `models[]` | `common/interfaces/llm/connection.ts` | `device-llm/constants/providers.ts` | `llm-ui (ProviderSettingsEditor)` |
| `LLMConnection` | `id`, `provider`, `apiKey`, `model`, `tier` | `common/interfaces/llm/connection.ts` | `LLMDeviceDriver` | `llm-ui`, `llm-harness` |
| `ChatMessage` | `role`, `content`, `attachments?` | `common/interfaces/llm/message.ts` | device-llm | 全部 |
| `ILLMService` | `chat()`, `stream()` | `common/interfaces/llm/llm-service.ts` | `harness/adapters/LLMServiceAdapter` | `harness`, `llm-engine` |
| `IAgentRuntime` | `run()`, `abort()`, `on()`, `inject()` | `common/interfaces/agent/agent-service.ts` | `AgentDeviceDriver` | `llm-engine (TaskRunner)` |
| `ISkillService` | `listSkills()`, `loadSkill()`, `getRouteLayers()` | `common/interfaces/skills/skill-service.ts` | `SkillDeviceDriver` | `harness`, `llm-ui` |
| `IToolService` | `register()`, `getTool()`, `getTools()` | `common/interfaces/tools/` | `ToolDeviceDriver` | `harness` |

## UI 体系 (Ports/Adapters)

| Port 接口 | 关键方法 | 定义文件 | 实现 (Adapter) |
|---|---|---|---|
| `IChatInputPresenter` | `setLoading()`, `setConfig()`, `getConfig()`, `focus()` | `llm-ui/domain/ports/IChatInputPresenter.ts` | `ChatInput` |
| `IHistoryPresenter` | `appendNode()`, `updateNode()`, `clear()` | `llm-ui/domain/ports/IHistoryPresenter.ts` | `HistoryView` |
| `IStreamingController` | `appendChunk()`, `finish()` | `llm-ui/domain/ports/IStreamingController.ts` | `StreamController` |
| `ICollapseManager` | `fold()`, `unfold()`, `foldAll()` | `llm-ui/domain/ports/ICollapseManager.ts` | `CollapseController` |
| `INavigationPresenter` | `navigateTo()`, `highlightNode()` | `llm-ui/domain/ports/INavigationPresenter.ts` | `NavigationHelper` |
| `IBranchStore` | `getBranches()`, `switchBranch()` | `llm-ui/domain/ports/IBranchStore.ts` | `BranchStore` |
| `IStatusPresenter` | `showStatus()`, `clearStatus()` | `llm-ui/domain/ports/IStatusPresenter.ts` | `StatusIndicatorView` |

## 类型速查

| 类型 | 文件 |
|---|---|
| `ModelTier` (auto/optimal/standard/fast) | `common/interfaces/llm/connection.ts` |
| `ModelCategory` (chat/vision/embedding/...) | `device-llm/src/types/provider.ts` |
| `ChatOverrides` | `llm-ui/domain/types.ts` |
| `SkillInfo` | `llm-ui/domain/types.ts` |
| `TokenStats` | `llm-ui/domain/types.ts` |
| `SkillType` (builtin/http/shell/prompt/mcp/custom) | `common/interfaces/skills/skill-types.ts` |
| `OrchestratorEvent` | `llm-engine/src/core/types.ts` |
