# CLAUDE.md — @itookit/common

共享接口、类型、工具函数和 i18n 的基础包。**零运行时依赖**，所有 `@itookit/*` 包的类型源头。

## Architecture

此包**不包含实现逻辑**，只导出 interfaces / types / utils / components / i18n。

```
src/
├── index.ts              ← 统一导出入口
├── interfaces/
│   ├── fs/               ← VFS 核心接口
│   │   ├── services/     ← IVFSManager, IModuleFS, IFSDriver, IFSMetaDriver
│   │   ├── core/         ← FSNode, FSEvent, FSError, Options
│   │   ├── storage/      ← IStorageBackend (path-based)
│   │   ├── capabilities/ ← IAssetOps, ITagOps, ISeqFileOps, IRefOps, IWatchOps
│   │   ├── device/       ← IDeviceDriver, IDeviceHandle
│   │   ├── mount/        ← IMountRouter, MountPoint
│   │   ├── plugin/       ← IPlugin, IPluginManager
│   │   └── sync/         ← ISyncService
│   ├── llm/              ← LLM 核心接口
│   │   ├── connection.ts ← LLMProvider, LLMConnection, ModelTier
│   │   ├── message.ts    ← ChatMessage, ToolCall, Attachment
│   │   ├── completion.ts ← ChatCompletionParams/Response, TokenUsage
│   │   ├── llm-service.ts← ILLMService
│   │   ├── agent.ts      ← AgentDefinition, LLMSkill, MCPServer, IConnectionService
│   │   └── mission.ts    ← MissionPlan, TodoItem, HITLRequest
│   ├── agent/            ← Agent 运行时接口
│   │   ├── agent-types.ts   ← AgentEventType, AgentEventPayloads, AgentTaskRequest
│   │   ├── agent-service.ts ← IAgentRuntime (run/abort/inject/on)
│   │   ├── context-manager.ts, budget-controller.ts, error-recovery.ts
│   │   ├── back-pressure.ts, sub-agent.ts
│   ├── skills/           ← Skill 接口 (SkillDefinition, ISkillService)
│   ├── tty/              ← TTY 接口 (ITTYSession, ITTYDriver)
│   ├── tools/            ← Tool 接口 (ToolMeta, ToolSideEffect)
│   ├── IFile.ts          ← IFile + AssetObj (v4.1: asset(name) API)
│   ├── IMDXFile.ts       ← extends IFile
│   ├── IChatFile.ts      ← extends IFile
│   └── IEditor.ts        ← sessionEngine?: IModuleFS (v3.3)
├── utils/                ← 工具函数
├── components/           ← 基础 UI 组件
├── i18n/                 ← zh-CN.ts / en.ts / icons.ts / t()
├── events/               ← 导航事件常量
└── types/                ← 杂项类型
```

接口详情: [接口目录](./interface-catalog.md)

## v4.1 VFS 接口分层

| 接口 | 层级 | 说明 |
|---|---|---|
| `IStorageBackend` | 存储 | path-based 统一接口 (stat/list/read/write/…) + 可选 records/search/symlink |
| `IVFSManager` | 系统管理 | 模块生命周期、跨模块搜索 |
| `IModuleFS` | 模块 | chroot 隔离、`driver` + `meta` + `openFile()` |
| `IFSDriver` | 驱动 | POSIX CRUD + 事务(必选) + 搜索 |
| `IFSMetaDriver` | 驱动 | assets/tags |
| `IFile` | 文件句柄 | 主文件 + `asset(name): AssetObj` |
| `AssetObj` | 子文件 | assetdir 内子文件轻量句柄 (read/write/delete/exists) |

调用方始终以接口为类型，具体装配只在 `app-shell/bootstrap.ts` 中。

## LLM 三层架构

```
LLMProvider (云厂商，持有 apiKey + 模型目录)
    → connection.ts
    ↕
LLMConnection (绑定 Provider，配置 tier→model 映射，不存 apiKey)
    → connection.ts
    ↕
AgentDefinition (绑定 Connection + tier 偏好 + system prompt)
    → agent.ts
```

| 接口/类型 | 文件 | 说明 |
|---|---|---|
| `LLMProvider` | `interfaces/llm/connection.ts` | 云厂商定义 (id, implementation, baseURL, models[]) |
| `LLMConnection` | `interfaces/llm/connection.ts` | 连接配置 (providerId, tiers, metadata) — 不含 apiKey |
| `ConnectionMeta` | `interfaces/llm/connection.ts` | 连接安全元数据（UI 列表用，strip apiKey） |
| `ModelTier` | `interfaces/llm/connection.ts` | `'optimal' | 'standard' | 'fast'` |
| `AgentDefinition` | `interfaces/llm/agent.ts` | Agent 定义 (config: {connectionId, modelTier, systemPrompt}) |
| `IConnectionService` | `interfaces/llm/agent.ts` | 连接 CRUD + Provider 查询 |
| `IAgentConfigService` | `interfaces/llm/agent.ts` | Agent/Connection 读取（SessionManager 依赖） |
| `IAgentManagementService` | `interfaces/llm/agent.ts` | 完整管理接口（Settings UI 消费，extends ConfigService + ConnectionService） |

## Agent 任务流

```
IAgentRuntime.run(task: AgentTaskRequest) → AgentTaskResult
    → 定义在 interfaces/agent/agent-service.ts + agent-types.ts
```

| 接口/类型 | 文件 | 说明 |
|---|---|---|
| `AgentTaskRequest` | `interfaces/agent/agent-types.ts` | 任务请求 (prompt, modelOverride, budgetOverride, …) |
| `AgentTaskResult` | `interfaces/agent/agent-types.ts` | 任务结果 (sessionId, status, response, usage) |
| `IAgentRuntime` | `interfaces/agent/agent-service.ts` | 核心运行时 (run/abort/inject/on/onIntercept/respondToHumanInput) |
| `IAgentRuntimeConfig` | `interfaces/agent/agent-service.ts` | 运行时配置 (modelRoles, budgetLimits, loopConfig) |
| `AgentEventType` | `interfaces/agent/agent-types.ts` | 25 种事件联合类型 |
| `AgentEventPayloads` | `interfaces/agent/agent-types.ts` | 事件→payload 映射 |

## Conventions

- **所有 cross-package 类型必须定义在此包**，其他包通过 `import type { X } from '@itookit/common'` 引用
- 接口用 `interface`（非 `type`），以支持 declaration merging
- 错误类统一继承 `FSError`
- i18n 添加字符串：先在 `zh-CN.ts` 加 key，再在 `en.ts` 加对应翻译
- 图标从 `icons.ts` 导入，**禁止**在组件中硬编码 emoji
- `FSNode` 是 discriminated union — 使用前先 type-narrow（检查 `type` 字段）
- **废弃 `IFSEngine`**，新代码使用 `IModuleFS` 或 `IFSDriver`
