# common 接口目录

## VFS 体系 (interfaces/fs/)

| 文件 | 核心导出 | 用途 |
|---|---|---|
| `services/vfs-manager.ts` | `IVFSManager`, `IMountService`, `IMaintenanceService` | 系统级 VFS 管理 |
| `services/module-fs.ts` | `IModuleFS`, `IFSTransaction` | 模块文件操作（chroot） |
| `services/config-service.ts` | `IConfigService` | 配置读写 |
| `services/factory.ts` | `VFSFactoryOptions`, `VFSInstance` | VFS 工厂类型 |
| `core/types.ts` | `FSNode`, `FSFileNode`, `FSDirectoryNode`... | 节点类型 |
| `core/errors.ts` | `FSError` 及 13 个子类 | 错误体系 |
| `core/events.ts` | `FSEvent`, `FSEventEmitter` | 事件类型 |
| `storage/backend.ts` | `IStorageBackend` | 存储后端契约 |
| `device/device.ts` | `IDeviceDriver`, `IDeviceManager` | 设备抽象 |
| `mount/mount.ts` | `IMountRouter`, `MountPoint` | 挂载路由 |
| `plugin/plugin.ts` | `IPlugin`, `IPluginManager` | 插件系统 |
| `sync/sync.ts` | `ISyncService` | 同步服务 |
| `capabilities/*` | `IAssetOperations`, `ITagOperations`... | 能力子接口 |

## LLM 体系 (interfaces/llm/)

| 文件 | 核心导出 |
|---|---|
| `connection.ts` | `LLMConnection`, `LLMProvider`, `ModelTier`, `ConnectionMeta` |
| `message.ts` | `ChatMessage`, `ToolCall`, `ToolDefinition`, `Attachment` |
| `completion.ts` | `ChatCompletionParams`, `ChatCompletionResponse`, `TokenUsage` |
| `llm-service.ts` | `ILLMService` (chat, chatStream, abort) |
| `agent.ts` | `AgentDefinition`, `LLMSkill`, `MCPServer` |
| `mission.ts` | `MissionPlan`, `TodoItem`, `HITLRequest`, `VerifierVerdict` |

## Agent 体系 (interfaces/agent/)

| 文件 | 核心导出 |
|---|---|
| `agent-types.ts` | `AgentEventType`, `AgentEventPayloads`, `AgentTaskRequest`, `AgentBudgetLimits` |
| `agent-service.ts` | `IAgentRuntime` (run/abort/inject/on/onIntercept/respondToHumanInput/ttyWrite) |
| `context-manager.ts` | `IContextManager` |
| `budget-controller.ts` | `IBudgetController`, `BudgetExhaustedError` |
| `error-recovery.ts` | `IErrorRecoveryService` |
| `back-pressure.ts` | `BackPressureRule` |
| `sub-agent.ts` | `ISubAgentRouter`, `SubAgentTask` |

## 其他接口

| 文件 | 核心导出 |
|---|---|
| `ISessionEngine.ts` | `ISessionEngine`, `EngineNode`, `EngineSearchQuery`, `EngineEvent` |
| `ISessionUI.ts` | `ISessionUI<TSession, TService>`, `ContextMenuConfig` |
| `IEditor.ts` | `IEditor` 抽象类 |
| `IEditorFactory.ts` | `EditorFactory` 类型 |
| `tools/tool-types.ts` | `ToolMeta`, `ToolSideEffect`, `ToolInvokeRequest/Result` |
| `skills/skill-types.ts` | `SkillDefinition`, `SkillType`, `SkillToolBinding` |
| `tty/tty-types.ts` | `ITTYSession`, `ITTYDriver`, `ITTYSessionManager` |
