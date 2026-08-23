# @itookit/llm-session — API 参考

> 用户可见的会话语义 + 持久化：Session 生命周期、Round/Branch、ChatEngine（VFS 持久化）、RoundLog、SessionEventBus、UI projections、Durable Conversation。同时是上层装配入口：`initializeConversationSystem()` 统一注册 `llm.chat/agent/plan` 与 `flow.*` Programs 并装配 CommandBus/DAG。所有 API 从 `@itookit/llm-session` 根导出。

**依赖方向**：`llm-session → llm-flow → llm-tasks → durable-kernel`（本包 re-export `@itookit/llm-flow` 全部 API）。

## 目录

- [装配入口：initializeConversationSystem](#装配入口)
- [会话管理：SessionManager](#会话管理sessionmanager)
- [会话核心：CommandBus / ExtensionRegistry / 插件](#会话核心)
- [持久化：ChatEngine（IChatEngine）](#持久化chatengine)
- [Round：RoundLog / RoundGraphService / RoundOperations](#round)
- [分支：BranchService](#分支branchservice)
- [状态与事件：SessionState / SessionEventBus](#状态与事件)
- [服务：VFSAgentService / PromptHistoryService / AgentResolver](#服务)
- [Kernel 存储桥接：ChatKernelStorageResolver](#kernel-存储桥接)
- [Durable Projection：DurableConversationProjection](#durable-projection)
- [工具函数](#工具函数)
- [源码结构：文件与路径](#源码结构文件与路径)

---

## 装配入口

```ts
interface ConversationSystemOptions {
    agentService: IAgentConfigService;
    sessionEngine: IChatEngine;
    kernel: Kernel;
    resolveTools?(sessionId, allowedIds): Promise<{ definitions: ToolDefinition[]; externalIds: string[] }>;
    dagPlugins: DagPluginCatalog;
}

interface ConversationSystem {
    sessionManager: SessionManager;
    commandBus: CommandBus;
    dag: DagCommandService;
}

async function initializeConversationSystem(options: ConversationSystemOptions): Promise<ConversationSystem>;
```

装配流程：初始化 services（agentService/sessionEngine/prompt-history）→ 注册 Programs（`llm.chat/agent/plan` + `flow.value/human/aggregate`）→ 创建 SessionManager → 装配 CommandBus + DagCommandService → 激活插件（session/vcs/history）。

---

## 会话管理：SessionManager

`SessionManager implements ISession, SessionQuery` —— 会话门面，UI 主要入口。`ISession`（`llm-common`）：`signal(s)` 入站 + `events()` 出站事件流（Unix 进程模型）。

```ts
class SessionManager implements ISession, SessionQuery {
    signal(s: Signal): void;
    events(): AsyncIterable<AgentEvent>;

    // 会话绑定（UI 节点 ↔ 会话）
    async bindSession(nodeId: string, sessionId: string): Promise<SessionSnapshot>;
    unbindSession(): void;
    getCurrentSessionId(): string | null;
    getCurrentNodeId(): string | null;
    getSnapshot(): SessionSnapshot;
    getSessions(): SessionGroup[];
    getStatus(): SessionStatus | 'unbound';
    isGenerating(): boolean;

    // 消息
    async sendMessage(
        text: string, files: ChatAttachment[], agentId: string,
        overrides?: ExecutionOverrides, origin?: SessionOrigin,
        historyPolicy?: HistoryPolicy, sendIntent?: SendIntent,
    ): Promise<string>;
    abort(): void;

    // 编辑/权限判定
    canRegenerate(messageId): { allowed: boolean; reason?: string };
    canDeleteMessage(messageId): { allowed: boolean; reason?: string };
    canEdit(messageId): { allowed: boolean; reason?: string };

    // 上下文模式（round 级 include/exclude）
    async setContextMode(roundIds: string[], mode: 'include'|'exclude', scope?: 'node'|'subtree'): Promise<void>;
    async getContextModes(roundIds: string[]): Promise<…>;

    // 事件
    onEvent(handler: (e: SessionEventEnvelope) => void): () => void;
    onGlobalEvent(handler: (e: RegistryEvent) => void): () => void;
}
```

**工厂**：`createSessionManager(engine, agentService, { kernel, dagPlugins, resolveTools })`、`getSessionManager()`（单例读取）、`resetSessionManager()`。

---

## 会话核心

### CommandBus

`CommandBus implements ICommandBus` —— 会话命令总线（slash 命令注册/分发；`DagCommandService.register(bus)` 与插件命令均注册于此）。

### ExtensionRegistry

`ExtensionRegistry implements IExtensionRegistry` —— 插件扩展注册表（`register()` + `activate({ commands })`）。

### 插件工厂

| 工厂 | 用途 |
|---|---|
| `createSessionPlugin(sessionManager)` | 会话生命周期命令 |
| `createVcsPlugin(sessionManager)` | 分支/版本控制命令 |
| `createHistoryPlugin(sessionManager)` | 历史/上下文命令 |

---

## 持久化：ChatEngine

`ChatEngine extends BaseModuleService implements IChatEngine` —— 会话在 VFS 的持久化实现。模块名 `FS_MODULE_CHAT = 'chats'`（挂载于 `/module/chats`）。

```ts
class ChatEngine extends BaseModuleService implements IChatEngine {
    constructor(vfs: IVFSManager);
    init(): Promise<void>;

    // 会话生命周期
    createSession(title: string): Promise<string>;              // 返回 sessionId
    initializeExistingFile(nodeId: string, title: string): Promise<string>;

    // 会话 ↔ 节点映射
    getSessionIdFromNodeId(nodeId: string): Promise<string | null>;
    getSessionNodeId(sessionId: string): Promise<string | null>;

    // Manifest / UI 状态
    getManifest(nodeId: string): Promise<ConversationManifest>;
    updateManifest(nodeId: string, updates: Partial<ConversationManifest>): Promise<void>;
    validateManifest(nodeId: string, sessionId: string): Promise<boolean>;
    getUIState(nodeId: string): Promise<ConversationUIState | null>;
    updateUIState(nodeId: string, state: ConversationUIState): Promise<void>;

    // 设置与资产
    getSessionSettings(sessionId: string): Promise<ChatSessionSettings>;
    saveSessionSettings(sessionId: string, settings: ChatSessionSettings): Promise<void>;
    readSessionAsset(sessionId: string, assetPath: string): Promise<Blob | null>;

    // 文件/目录（VFS 通用）
    createFile(...); createDirectory(name, parentId): Promise<FSNode>;
    rename(id, newName): Promise<void>; delete(ids): Promise<void>;
    getNode(id): Promise<FSNode | null>; readContent(id): Promise<string | ArrayBuffer>;
}
```

**`IChatEngine`**（`persistence/types.ts`）：上述契约接口 + `readonly vfs: IVFSManager` + `dispose()`。

---

## Round

### RoundLog

`RoundLog implements ILog` —— round 级消息日志（VFS 持久化）。

```ts
class RoundLog implements ILog {
    get(key: string): ChatMessage[] | null;
    set(key: string, messages: ChatMessage[]): void;
    invalidate(ref: Ref): void; invalidateAll(): void;

    // Ref（分支引用）管理
    create(name: string, at: RoundId): Promise<Ref>;
    move(ref: Ref, to: RoundId): Promise<void>;
    delete(ref: Ref): Promise<void>;
    list(): Promise<Ref[]>;
    refs(): RefStore;

    // Round 追加/折叠
    async append(ref: Ref, round: Round): Promise<RoundId>;
    async appendExpected(ref: Ref, round: Round, expectedHead: RoundId | null): Promise<RoundId>;
    async fold(ref: Ref, strategy?: AssemblyStrategy): Promise<ChatMessage[]>;
    setEventListener(fn: (event: RoundLogEvent) => void): void;
}
```

**辅助**：`roundToProjection(round, roundId): RoundProjection`、`hasEffectiveAssistant(round): boolean`。

### RoundGraphService

Round DAG 图服务（加载/保存 manifest + 依赖图）：

```ts
class RoundGraphService {
    setEventListener(fn: (event: RoundLogEvent) => void): void;
    async loadManifest(): Promise<RoundManifest>;
    async saveManifest(manifest: RoundManifest): Promise<void>;
    async append(ref: Ref, round: Round, expectedHead?: RoundId | null): Promise<RoundId>;
    // …
}
```

**`RoundGraphError`**：图操作错误（`code` 标识具体规则）。

### RoundOperations

`class RoundOperations` —— round 业务操作（sendMessage 执行、regenerate 判定）。`hasRegenerateAssistant(...)` 辅助。

---

## 分支：BranchService

```ts
class BranchService {
    constructor(registry: SessionRegistry);
    async switchToSibling(messageId: string, siblingIndex: number): Promise<void>;
    async getSiblings(messageId: string): Promise<SessionGroup[]>;
    async createBranch(messageId?: string, branchName?: string): Promise<…>;
    async switchBranch(branchName: string): Promise<void>;
    async getBranchTree(): Promise<BranchTreeNode>;
    async renameBranch(oldName: string, newName: string): Promise<void>;
    async deleteBranch(branchName: string): Promise<void>;
}
```

---

## 状态与事件

### SessionState

`class SessionState` —— Round 的 UI 投影（非运行事实源）。`HistoryMessage`：历史消息投影类型。

### SessionEventBus

`class SessionEventBus` —— 会话事件分发（`SessionEventEnvelope` 流）。

### SessionRegistry

`class SessionRegistry` —— 会话运行时注册表（状态机：open/suspended/…）。`BoundContext`：绑定上下文类型。

---

## 服务

| 类 | 职责 | 关键 API |
|---|---|---|
| `VFSAgentService extends BaseModuleService implements IAgentManagementService` | Agent 配置的 VFS 持久化 | CRUD（实现 `IAgentManagementService` / `IAgentConfigService` / `IConnectionService`） |
| `PromptHistoryService extends BaseModuleService` | prompt 历史（VFS） | `getPromptHistory()` 单例、`initializePromptHistory(vfs)`、`resetPromptHistory()` |
| `AgentResolver` | Agent → 模型/连接解析 | `AgentInfo` / `ModelInfo` 类型 |
| `AttachmentProcessor` | 附件处理（文件 → 内联） | — |
| `ContextProfileStore` | 上下文画像（VFS） | — |
| `VFSEntityStore<T>` | 通用 VFS 实体存储 | `EntityStoreConfig` / `Identifiable` |

**服务接口**（`services/agent-service.ts`）：`IAgentConfigService`、`IAgentManagementService`、`IConnectionService`、`MCPServer` 等。

---

## Kernel 存储桥接

```ts
const CHAT_HARNESS_STORAGE_KIND = 'chat-asset';

class ChatKernelStorageResolver implements SessionStorageResolver {
    readonly kind = CHAT_HARNESS_STORAGE_KIND;
    constructor(chat: IChatEngine);
    async resolve(reference: StorageBindingRef): Promise<ResolvedStorageBinding>;
}

function chatKernelStorage(sessionId: string): StorageBindingRef;
```

将 Kernel Session 存储绑定到聊天会话的资产目录：`rootPath = <chat asset dir>/.kernel`（fs 为 `FS_MODULE_CHAT` 引擎）。`chatKernelStorage(sessionId)` 生成 `StorageBindingRef` 传给 `kernel.createSession({ storage })`。

---

## Durable Projection

```ts
const RUNTIME_KEY = 'conversation/runtime';

class DurableConversationProjection {
    // 把 Kernel 事件流投影为 Conversation UI 状态（Round 列表/状态）
}
```

---

## 工具函数

| 函数 | 用途 |
|---|---|
| `chatFileParser(content)` | 聊天文件解析（markdown → 会话结构） |
| `formatErrorMessage(error)` | 统一错误格式化 |
| `ulid()` / `extractTimestamp(id)` | ULID 生成 / 时间戳提取 |
| `log` | 模块日志器（`llm-conversation` scope） |

**常量**：`CONVERSATION_DEFAULTS`（`core/constants.ts`）、`RUNTIME_KEY`、`CHAT_HARNESS_STORAGE_KIND`。

**错误**：`ConversationError` + `ConversationErrorCode`（`core/errors.ts`）。

---

## 源码结构：文件与路径

`@itookit/llm-session` 的公共 API 从 `packages/llm-session/src/index.ts` 根导出（并 re-export `@itookit/llm-flow`）。包内按 **core / session / persistence / plugins / services / utils** 组织：

```
packages/llm-session/src/
├── index.ts                      根导出 + initializeConversationSystem() 装配入口
├── core/                         会话核心契约
│   ├── types.ts                  NodeStatus/ExecutorType/ExecutionNode/SessionTokenUsage/HistoryPolicy 等
│   ├── command-bus.ts            CommandBus（ICommandBus 实现）
│   ├── extension-registry.ts     ExtensionRegistry（IExtensionRegistry 实现）
│   ├── constants.ts              CONVERSATION_DEFAULTS
│   └── errors.ts                 ConversationError + ConversationErrorCode
├── session/                      会话运行时（内存态 + 编排）
│   ├── session-manager.ts        SessionManager + createSessionManager/getSessionManager/resetSessionManager
│   ├── session-registry.ts       SessionRegistry + BoundContext（状态机）
│   ├── session-state.ts          SessionState + HistoryMessage（UI 投影）
│   ├── session-event-bus.ts      SessionEventBus
│   ├── session-query.ts          SessionQuery 接口
│   ├── round-operations.ts       RoundOperations + hasRegenerateAssistant
│   ├── branch-service.ts         BranchService
│   ├── agent-resolver.ts         AgentResolver + AgentInfo/ModelInfo
│   ├── attachment-processor.ts   AttachmentProcessor
│   ├── conversation-run-coordinator.ts  ConversationRunCoordinator（执行协调）
│   └── session-run-coordinator.ts      SessionRunCoordinator + SessionRunCallbacks
├── persistence/                  会话 VFS 持久化
│   ├── chat-engine.ts            ChatEngine（FS_MODULE_CHAT='chats'，/module/chats）
│   ├── types.ts                  IChatEngine/ConversationManifest/ConversationUIState/BranchTreeNode
│   ├── round-log.ts              RoundLog + roundToProjection/hasEffectiveAssistant
│   ├── round-graph-service.ts    RoundGraphService + RoundGraphError
│   ├── round-types.ts            RoundManifest/PersistedRound/RoundProjection/BranchMeta
│   ├── round-events.ts           RoundLogEvent/RoundChangeSet
│   ├── chat-kernel-storage.ts   ChatKernelStorageResolver + chatKernelStorage（chat-asset kind）
│   ├── durable-conversation-projection.ts  DurableConversationProjection + RUNTIME_KEY
│   ├── context-profile-store.ts  ContextProfileStore
│   ├── vfs-utils.ts / ulid.ts    VFS 助手 / ULID
│   └── (资产目录: 每会话 <assetDir>/.kernel ← Kernel 存储根)
├── plugins/                      会话插件工厂
│   ├── session-plugin.ts         createSessionPlugin
│   ├── vcs-plugin.ts             createVcsPlugin
│   └── history-plugin.ts         createHistoryPlugin
├── services/                    业务服务（VFS 持久化）
│   ├── agent-service.ts          IAgentConfigService/IAgentManagementService/IConnectionService 接口
│   ├── vfs-agent-service.ts      VFSAgentService（Agent 配置 CRUD）
│   ├── prompt-history-service.ts PromptHistoryService + getPromptHistory/initializePromptHistory
│   └── (VFS 路径: /module/chats 下按会话资产目录组织；prompt 历史经 BaseModuleService 存储)
└── utils/                        error-formatter / parsers / logger / vfs-entity-store
```

### VFS 路径设定

| 路径 / 常量 | 说明 |
|---|---|
| `FS_MODULE_CHAT = 'chats'` | 会话模块名 → `/module/chats`（`ChatEngine` 挂载点） |
| `<chat asset dir>/.kernel` | Kernel Session 存储根（`ChatKernelStorageResolver` 解析，含 `catalog.seq/session.seq/tasks/…`，见 `kernel-api.md`） |
| `llm-flows/` | Flow 草稿/修订 asset 目录名（`FlowDefinitionStore` 构造参数，`initializeConversationSystem` 传入） |
| `RUNTIME_KEY = 'conversation/runtime'` | Durable Conversation 运行时共享键 |

**约定**：Round 只表达对话历史（`historyParentIds`）；Run 引用经 `executions` 附着到 Round；Branch/merge/context fold 只在本包实现；普通 Chat 用 Direct Scheduler，不伪装成单节点 DAG；不访问 Kernel Dispatcher/ProcessTable 内部对象。
