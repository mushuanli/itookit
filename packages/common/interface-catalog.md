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
| `capabilities/*` | `IAssetOperations`, `ITagOperations`... | 能力子接口 |

## LLM 体系 (interfaces/llm/)

**三层架构**: `LLMProvider` → `LLMConnection` → `AgentDefinition`

| 文件 | 核心导出 |
|---|---|
| `connection.ts` | `LLMConnection`, `LLMProvider`, `ModelTier`, `ConnectionMeta`, `LLMModel` |
| `message.ts` | `ChatMessage`, `ToolCall`, `ToolDefinition`, `Attachment`, `Role`, `MessageContentPart` |
| `completion.ts` | `ChatCompletionParams`, `ChatCompletionResponse`, `TokenUsage`, `FinishReason` |
| `llm-service.ts` | `ILLMService` (chat, chatStream, abort) |
| `agent.ts` | `AgentDefinition`, `LLMSkill`, `MCPServer`, `IConnectionService`, `IAgentConfigService`, `IAgentManagementService` |
| `mission.ts` | `MissionPlan`, `TodoItem`, `HITLRequest`, `VerifierVerdict` |

## Agent 体系 (interfaces/agent/)

**核心入口**: `IAgentRuntime.run(task: AgentTaskRequest) → AgentTaskResult`

| 文件 | 核心导出 |
|---|---|
| `agent-types.ts` | `AgentTaskRequest`, `AgentTaskResult`, `AgentEventType` (25 种), `AgentEventPayloads`, `AgentBudgetLimits`, `AgentSessionInfo` |
| `agent-service.ts` | `IAgentRuntime` (run/abort/inject/on/onIntercept/respondToHumanInput/ttyWrite), `IAgentRuntimeConfig` |
| `context-manager.ts` | `IContextManager` |
| `budget-controller.ts` | `IBudgetController`, `BudgetExhaustedError` |
| `error-recovery.ts` | `IErrorRecoveryService` |
| `back-pressure.ts` | `BackPressureRule` |
| `sub-agent.ts` | `ISubAgentRouter`, `SubAgentTask` |

## Skill 体系 (interfaces/skills/)

| 文件 | 核心导出 |
|---|---|
| `skill-types.ts` | `SkillDefinition`, `SkillType`, `SkillToolBinding`, `SkillRouteLayer`, `CompactSection` |
| `skill-service.ts` | `ISkillService` (listSkills/loadSkill/getRouteLayers/semanticMatchSkills/setCwd) |
| `fs-skill-types.ts` | `SkillFrontmatter`, `FSSkillDirectory`, `ScopeEntry` |

## TTY 体系 (interfaces/tty/)

| 文件 | 核心导出 |
|---|---|
| `tty-types.ts` | `ITTYSession` (write/kill/on), `ITTYDriver` (spawn sessions), `ITTYSessionManager` |

## Tool 体系 (interfaces/tools/)

| 文件 | 核心导出 |
|---|---|
| `tool-types.ts` | `ToolMeta` (id/sideEffect/timeoutMs), `ToolSideEffect` ('none'|'local'|'external'), `ToolInvokeRequest/Result` |

## 其他接口

| 文件 | 核心导出 |
|---|---|
| `ISessionEngine.ts` | `ISessionEngine`, `EngineNode`, `EngineSearchQuery`, `EngineEvent` |
| `ISessionUI.ts` | `ISessionUI<TSession, TService>`, `ContextMenuConfig` |
| `IEditor.ts` | `IEditor` 抽象类 |
| `IEditorFactory.ts` | `EditorFactory` 类型 |
