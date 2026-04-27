# CLAUDE.md — @itookit/common

共享接口、类型、工具函数和 i18n 的基础包。**零运行时依赖**，所有其他 `@itookit/*` 包的类型源头。

## Commands

```bash
pnpm --filter @itookit/common build       # tsup → CJS+ESM+.d.ts
pnpm --filter @itookit/common dev         # tsup --watch
```

## Architecture

此包**不包含任何实现逻辑**，只导出 interfaces / types / utils / components / i18n。

```
src/
├── index.ts              ← 统一导出入口
├── interfaces/
│   ├── fs/               ← VFS 接口 (IModuleFS, IVFSManager, IStorageBackend...)
│   ├── llm/              ← LLM 接口 (LLMConnection, ChatMessage, Mission...)
│   ├── agent/            ← Agent 接口 (IAgentRuntime, AgentLoopConfig...)
│   ├── tools/            ← 工具接口 (ToolMeta, ToolSideEffect...)
│   ├── skills/           ← Skill 接口 (SkillDefinition, SkillType...)
│   ├── tty/              ← TTY 接口 (ITTYSession, ITTYDriver...)
│   ├── IEditor.ts        ← 编辑器抽象基类
│   ├── IEditorFactory.ts ← 编辑器工厂类型
│   ├── ISessionEngine.ts ← 会话引擎契约
│   ├── ISessionUI.ts     ← 会话 UI 契约
│   ├── ILogger.ts        ← 日志接口
│   └── INavigation.ts    ← 导航事件
├── utils/
│   ├── utils.ts          ← 通用工具 (generateUUID, debounce, safeJsonParse...)
│   ├── MarkdownUtils.ts  ← Markdown 解析/提取
│   ├── MarkdownAnalyzer.ts ← AI 后台分析
│   ├── MemoryLogger.ts   ← 内存日志实现
│   └── filename.ts       ← 文件名处理
├── components/
│   ├── BaseSettingsEditor.ts ← 设置编辑器基类
│   └── UIComponents.ts      ← 通用 UI 组件
├── i18n/
│   ├── zh-CN.ts          ← 中文字符串（主语言，key 的 source of truth）
│   ├── en.ts             ← 英文翻译（必须与 zh-CN key 集一致）
│   ├── icons.ts          ← 图标常量 (SKILL_TYPE_META, ENTITY_ICONS...)
│   └── index.ts          ← t() / setLocale() / getLocale()
├── events/
│   └── navigation-events.ts ← NAVIGATION_EVENTS 常量
└── types/
    └── types.ts          ← RestoreStatus 等杂项类型
```

## Key Interfaces

### VFS 体系 (interfaces/fs/)

| 文件 | 核心导出 | 用途 |
|---|---|---|
| `services/vfs-manager.ts` | `IVFSManager`, `IMountService`, `IMaintenanceService` | 系统级 VFS 管理 |
| `services/module-fs.ts` | `IModuleFS`, `IFSTransaction` | 模块文件操作（经过 chroot） |
| `services/config-service.ts` | `IConfigService` | 配置读写 |
| `services/factory.ts` | `VFSFactoryOptions`, `VFSInstance` | VFS 工厂类型 |
| `core/types.ts` | `FSNode`, `FSFileNode`, `FSDirectoryNode`... | 节点类型（discriminated union） |
| `core/errors.ts` | `FSError` 及 13 个子类 | 错误体系 |
| `core/events.ts` | `FSEvent`, `FSEventEmitter` | 事件类型 |
| `storage/backend.ts` | `IStorageBackend` | 存储后端契约 |
| `device/device.ts` | `IDeviceDriver`, `IDeviceManager` | 设备抽象 |
| `mount/mount.ts` | `IMountRouter`, `MountPoint` | 挂载路由 |
| `plugin/plugin.ts` | `IPlugin`, `IPluginManager` | 插件系统 |
| `sync/sync.ts` | `ISyncService` | 同步服务 |
| `capabilities/*` | `IAssetOperations`, `ITagOperations`... | 能力子接口 |

### LLM 体系 (interfaces/llm/)

| 文件 | 核心导出 |
|---|---|
| `connection.ts` | `LLMConnection`, `LLMProvider`, `ModelTier`, `ConnectionMeta` |
| `message.ts` | `ChatMessage`, `ToolCall`, `ToolDefinition`, `Attachment` |
| `completion.ts` | `ChatCompletionParams`, `ChatCompletionResponse`, `TokenUsage`, `FinishReason` |
| `llm-service.ts` | `ILLMService` (chat, chatStream, abort) |
| `agent.ts` | `AgentDefinition`, `LLMSkill`, `MCPServer` |
| `mission.ts` | `MissionPlan`, `TodoItem`, `HITLRequest`, `VerifierVerdict` |

### Agent 体系 (interfaces/agent/)

| 文件 | 核心导出 |
|---|---|
| `agent-types.ts` | `AgentEventType` (25 种), `AgentEventPayloads`, `AgentTaskRequest`, `AgentBudgetLimits` |
| `agent-service.ts` | `IAgentRuntime` (run/abort/inject/on/onIntercept), `IAgentRuntimeConfig` |
| `context-manager.ts` | `IContextManager` (4 层压缩) |
| `budget-controller.ts` | `IBudgetController`, `BudgetExhaustedError` |
| `error-recovery.ts` | `IErrorRecoveryService` |
| `back-pressure.ts` | `BackPressureRule` |
| `sub-agent.ts` | `ISubAgentRouter`, `SubAgentTask` |

### 其他接口

| 文件 | 核心导出 |
|---|---|
| `ISessionEngine.ts` | `ISessionEngine`, `EngineNode`, `EngineSearchQuery`, `EngineEvent` |
| `ISessionUI.ts` | `ISessionUI<TSession, TService>`, `ContextMenuConfig` |
| `IEditor.ts` | `IEditor` 抽象类 |
| `IEditorFactory.ts` | `EditorFactory` 类型 |
| `tools/tool-types.ts` | `ToolMeta`, `ToolSideEffect`, `ToolInvokeRequest/Result` |
| `skills/skill-types.ts` | `SkillDefinition`, `SkillType`, `SkillToolBinding` |
| `tty/tty-types.ts` | `ITTYSession`, `ITTYDriver`, `ITTYSessionManager` |

## Conventions

- **所有 cross-package 类型必须定义在此包**，其他包通过 `import type { X } from '@itookit/common'` 引用
- 接口用 `interface`（非 `type`），以支持 declaration merging
- 错误类统一继承 `FSError`
- i18n 添加字符串：先在 `zh-CN.ts` 加 key，再在 `en.ts` 加对应翻译（TypeScript 会检查完整性）
- 图标/emoji 从 `icons.ts` 导入，**禁止**在组件中硬编码 emoji
- `FSNode` 是 discriminated union — 使用前先 type-narrow（检查 `type` 字段）
