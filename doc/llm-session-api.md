# @itookit/llm-session — API 参考

> 用户可见的会话语义 + 持久化：Session 生命周期、Round/Branch、SessionRepository（会话目录持久化）、RoundLog、SessionEventBus、UI projections、Durable Conversation。同时是上层装配入口：`initializeConversationSystem()` 统一注册 `llm.chat/agent/plan` 与 `flow.*` Programs 并装配 CommandBus/DAG。公共 API 从 `@itookit/llm-session` 根导出；少数内部工具（`RUNTIME_KEY`、`ulid`/`extractTimestamp`、`log`、`ContextProfileStore`、`VFSEntityStore`、`initializePromptHistory`/`resetPromptHistory`、`SessionFolder` 类型）仅按源码路径可用。

**依赖方向**：`llm-session → llm-flow → llm-tasks → durable-kernel`（本包 re-export `@itookit/llm-flow` 全部 API）。

## 目录

- [装配入口：initializeConversationSystem](#装配入口)
- [会话管理：SessionManager](#会话管理sessionmanager)
- [会话核心：CommandBus / ExtensionRegistry / 插件](#会话核心)
- [持久化：SessionRepository（ISessionRepository）](#持久化sessionrepository)
- [Round：RoundLog / RoundGraphService / RoundOperations](#round)
- [分支：BranchService](#分支branchservice)
- [状态与事件：SessionState / SessionEventBus](#状态与事件)
- [服务：VFSAgentService / PromptHistoryService / AgentResolver](#服务)
- [Kernel 存储桥接：SessionDirectoryStorageResolver](#kernel-存储桥接)
- [Durable Projection：DurableConversationProjection](#durable-projection)
- [工具函数](#工具函数)
- [源码结构：文件与路径](#源码结构文件与路径)

---

## 装配入口

```ts
interface ConversationSystemOptions {
    agentService: IAgentConfigService;
    sessionEngine: ISessionRepository;
    promptHistoryFiles: IFileSystem;              // prompt 历史的文件系统
    kernel: Kernel;
    flowStore: FlowStore;                        // 独立 flows 模块的工作流存储
    resolveSessionContext?(sessionId: string, userMessage: string): Promise<{
        projectInstructions: string; skillInstructions: string; skillIndex: string;
    }>;
    resolveTools?(sessionId, allowedIds): Promise<{ definitions: ToolDefinition[]; externalIds: string[] }>;
    retrieveMemory?: ConversationRunCoordinatorOptions['retrieveMemory'];
    dagPlugins: DagPluginCatalog;
}

interface ConversationSystem {
    sessionManager: SessionManager;
    commandBus: CommandBus;
    dag: DagCommandService;
}

async function initializeConversationSystem(options: ConversationSystemOptions): Promise<ConversationSystem>;
```

装配流程：初始化 services（`agentService.init()` / `sessionEngine.init()` / `initializePromptHistory(promptHistoryFiles)`）→ `registerDurablePrograms(kernel)` 注册 Programs（`llm.chat/agent/plan` + `flow.value/human/aggregate`）→ 创建 SessionManager → 用 `new FlowDefinitionStore(flowStore, dagPlugins)` 装配 CommandBus + DagCommandService → 激活插件（session/vcs/history）。

---

## 会话管理：SessionManager

`SessionManager implements ISession, SessionQuery` —— 会话门面，UI 主要入口。`ISession`（`llm-common`）：`signal(s)` 入站 + `events()` 出站事件流（Unix 进程模型）。

```ts
class SessionManager implements ISession, SessionQuery {
    signal(s: Signal): void;
    events(): AsyncIterable<AgentEvent>;

    // 会话绑定（会话 id ↔ 运行时）
    async bindSession(sessionId: string): Promise<SessionSnapshot>;
    unbindSession(): void;
    getCurrentSessionId(): string | null;
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

**工厂**：`createSessionManager(engine, agentService, { kernel, dagPlugins, flowStore, resolveSessionContext?, resolveTools?, retrieveMemory? })`、`getSessionManager()`（单例读取）、`resetSessionManager()`。

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

## 持久化：SessionRepository

`SessionRepository implements ISessionRepository`（`persistence/session-repository.ts`）—— 会话身份、历史文档与附件的唯一事实源。构造参数为根文件系统（`IFileSystem`）；存储布局与一致性约定见[会话数据仓库：SessionRepository](#会话数据仓库sessionrepository)。

```ts
class SessionRepository implements ISessionRepository {
    constructor(fs: IFileSystem);
    init(): Promise<void>;
    dispose(): Promise<void>;
    subscribe(listener: () => void): () => void;

    // 会话生命周期
    createSession(title: string, folder?: string | null): Promise<string>;   // 返回 sessionId
    ensureSession(id: string, title: string, origin?: SessionOrigin, folder?: string | null): Promise<string>;

    // Manifest / 列表 / 删除
    getManifest(sessionId: string): Promise<ConversationManifest>;
    list(): Promise<ConversationManifest[]>;
    deleteSession(sessionId: string): Promise<void>;

    // 文件夹
    listFolders(): Promise<SessionFolder[]>;
    createFolder(path: string): Promise<SessionFolder>;
    deleteFolder(path: string, recursive?: boolean): Promise<void>;
    renameFolder(from: string, to: string): Promise<void>;

    // Manifest / UI 状态 / 设置
    updateManifest(sessionId: string, patch: Partial<ConversationManifest>): Promise<void>;
    getUIState(sessionId: string): Promise<ConversationUIState | null>;
    updateUIState(sessionId: string, patch: Partial<ConversationUIState>): Promise<void>;
    getSessionSettings(sessionId: string): Promise<ChatSessionSettings>;
    saveSessionSettings(sessionId: string, patch: Partial<ChatSessionSettings>): Promise<void>;

    // 历史文档与附件
    readDocument(sessionId: string, name: string): Promise<string | null>;
    writeDocument(sessionId: string, name: string, content: string): Promise<void>;
    listHistory(sessionId: string): Promise<string[]>;
    writeAttachment(sessionId: string, name: string, content: ArrayBuffer): Promise<void>;
    openAttachments(sessionId: string): Promise<FileSystemView>;
    readSessionAsset(sessionId: string, name: string): Promise<Blob | null>;
}
```

**`ISessionRepository`**（`persistence/types.ts`）：上述契约接口。会话身份即 `<id>` 目录，不存在 UI 节点 ↔ 会话的映射 API；会话标题是 manifest 的 `title` 字段，经 `updateManifest()` 修改。

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

**助手占位投影规则（2026-09-11 第六十一/六十二轮）**：chat round 若没有 assistant 输出，`roundToProjection` 仍会按以下规则投影助手占位，否则转写会以用户消息结尾，下一次发送被 `Cannot send consecutive user messages` 拒绝：
1. 终态（`failed`/`cancelled`）且有用户输入 → 投影 `failed`/`aborted` 占位（含 `error`）；
2. **已记录 execution 但仍为 `running`/`pending`**（拥有它的宿主已消失）→ 投影 `running` 占位，`SessionRegistry.getSnapshot().interruptedAssistantId` 据此提示「上次执行未完成」并可重新执行；
3. `waiting`（等待人工输入）与从未启动过执行的 round 保持仅用户消息。
回归：`packages/llm-session/__tests__/failed-round-projection.test.ts`（7 通过）与 `packages/app-shell/tests/host-restart-inflight.test.ts`（真实本地存储 + 永不回包模型，宿主在运行途中退出后重开：转写以助手占位结尾、`interruptedAssistantId` 存在、新消息不再被拒）。

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
    async createBranch(branchNodeId: string, options?: { name?: string; copyContent?: boolean }): Promise<string>;
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

`class SessionRegistry` —— 会话运行时注册表（状态取 `SessionStatus`：`idle` / `queued` / `running` / `completed` / `failed` / `aborted`）。`BoundContext`：绑定上下文类型。

---

## 服务

| 类 | 职责 | 关键 API |
|---|---|---|
| `VFSAgentService extends FileBackedService implements IAgentManagementService` | Agent 配置的 VFS 持久化 | CRUD（实现 `IAgentManagementService` / `IAgentConfigService` / `IConnectionService`） |
| `PromptHistoryService extends FileBackedService` | prompt 历史（注入的文件系统） | `getPromptHistory()` 单例、`initializePromptHistory(fs)`、`resetPromptHistory()` |
| `AgentResolver` | Agent → 模型/连接解析 | `AgentInfo` / `ModelInfo` 类型 |
| `AttachmentProcessor` | 附件处理（文件 → 内联） | — |
| `ContextProfileStore`（`persistence/context-profile-store.ts`） | 上下文画像（VFS） | — |
| `VFSEntityStore<T>`（`utils/vfs-entity-store.ts`） | 通用 VFS 实体存储 | `EntityStoreConfig` / `Identifiable` |

**服务接口**（`services/agent-service.ts`）：`IAgentConfigService`、`IAgentManagementService`、`IConnectionService`、`MCPServer` 等。

---

## Kernel 存储桥接

```ts
const SESSION_DIRECTORY_STORAGE_KIND = 'session-directory';

class SessionDirectoryStorageResolver implements SessionStorageResolver {
    readonly kind = SESSION_DIRECTORY_STORAGE_KIND;
    constructor(fs: IFileSystem);
    async resolve(reference: StorageBindingRef): Promise<ResolvedStorageBinding>;
}

function sessionDirectoryStorage(sessionId: string): StorageBindingRef;
```

将 Kernel Session 存储绑定到会话目录：`rootPath = /var/lib/sessions/<id>/kernel`（`sessionExecutionRoot()`，`persistence/session-storage-layout.ts`）。`sessionDirectoryStorage(sessionId)` 生成 `StorageBindingRef` 传给 `kernel.createSession({ storage })`（`SessionManager.bindSession()` 即以此绑定）。

---

## 会话数据仓库：SessionRepository

`SessionRepository implements ISessionRepository`（`persistence/session-repository.ts`）——会话身份、历史文档与附件的唯一事实源。

**存储布局**（`/var/lib/sessions` 下，与 Kernel 的 `session-directory` 存储根 `<id>/kernel` 同级）：

| 路径 | 内容 |
|---|---|
| `<id>/session.seq` | `session` 记录（身份/标题/所属文件夹/uiState）+ `settings` |
| `<id>/history.seq` | `index`（RoundManifest v3：branches/branchMeta/currentBranch/currentHead/children）+ `document/*` |
| `<id>/attachments/` | 会话附件（二进制） |
| `folders.seq` | 文件夹表（单条 `folders` 记录） |

**一致性约定**：

- **删除顺序**：`deleteSession()` 先做物理删除（目录），成功后才清除 SeqFile 记录。SeqFile 记录独立于文件存在（删文件不清理记录），若先清记录而物理删除失败（Kernel 固定布局 `vfsFixedLayout`、宿主权限），会话将不可恢复地消失。
- **Kernel 存储先删**：`<id>/kernel` 属于 Kernel，仓库不触碰。调用方须先 `kernel.removeSession(id)`（解除固定布局并删除该子树），再调 `deleteSession()`。应用层统一走 `SessionLifecycleService`（`@itookit/app-core`）：close → 等待 `closed` → `removeSession` → `deleteSession`，任一步失败都保留数据。
- **文件夹读写**：`createFolder/deleteFolder/renameFolder` 的读-改-写在同一 `fs.meta.seq.transaction` 内完成；`renameFolder` 把文件夹表与所有受影响会话的归属更新提交在同一事务里。
- **归属校验**：新建会话或修改 `folder` 时目标文件夹必须已存在，否则抛 `ENOENT`（避免产生任何列表都看不到的"幽灵会话"）。
- **全新 seq 文件先清空**：`ensureSession()` 重建缺失的 seq 文件时会清掉同名遗留记录，防止复用身份时复活已删除会话。

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
| `formatErrorMessage(error)` | 统一错误格式化（`utils/error-formatter.ts`，根导出） |
| `ulid()` / `extractTimestamp(id)` | ULID 生成 / 时间戳提取（`persistence/ulid.ts`，仅按源码路径导入） |
| `log` | 模块日志器（`utils/logger.ts`，scope `llm-conversation`，仅按源码路径导入） |

**常量**：`CONVERSATION_DEFAULTS`（`core/constants.ts`，根导出）、`RUNTIME_KEY`（`persistence/durable-conversation-projection.ts`，仅按源码路径导入）、`SESSION_DIRECTORY_STORAGE_KIND`（根导出）。

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
│   ├── session-registry.ts       SessionRegistry + BoundContext（运行时状态）
│   ├── session-state.ts          SessionState + HistoryMessage（UI 投影）
│   ├── session-event-bus.ts      SessionEventBus
│   ├── session-query.ts          SessionQuery 接口
│   ├── round-operations.ts       RoundOperations + hasRegenerateAssistant
│   ├── branch-service.ts         BranchService
│   ├── agent-resolver.ts         AgentResolver + AgentInfo/ModelInfo
│   ├── attachment-processor.ts   AttachmentProcessor
│   ├── flow-node-binder.ts       bindStandaloneFlowNode（独立 Flow 节点绑定）
│   ├── session-memory-provider.ts  SessionMemoryProvider + MemoryWrite
│   ├── MarkdownAnalyzer.ts       Markdown 结构分析（DocumentInfo 等）
│   ├── conversation-run-coordinator.ts  ConversationRunCoordinator（执行协调）
│   └── session-run-coordinator.ts      SessionRunCoordinator + SessionRunCallbacks
├── persistence/                  会话与 Flow 持久化
│   ├── session-repository.ts     SessionRepository（ISessionRepository 实现）
│   ├── types.ts                  ISessionRepository/ConversationManifest/ConversationUIState/BranchTreeNode
│   ├── session-storage-layout.ts SESSION_STORAGE_ROOT/sessionStorageRoot/sessionExecutionRoot
│   ├── session-directory-storage.ts  SessionDirectoryStorageResolver + sessionDirectoryStorage
│   ├── session-projection.ts     createSessionDataProjection（会话记录的只读文件投影）
│   ├── flow-engine.ts            FlowEngine + FLOW_MODULE_NAME（flows 模块，实现 FlowStore）
│   ├── default-flows.ts          seedDefaultFlows/essayReviewDraft/ESSAY_REVIEW_FLOW_ID
│   ├── round-log.ts              RoundLog + roundToProjection/hasEffectiveAssistant
│   ├── round-graph-service.ts    RoundGraphService + RoundGraphError
│   ├── round-types.ts            RoundManifest/PersistedRound/RoundProjection/BranchMeta
│   ├── round-events.ts           RoundLogEvent/RoundChangeSet
│   ├── projection.ts             toolCallsFromResult/buildToolChildren（Round → UI 投影助手）
│   ├── durable-conversation-projection.ts  DurableConversationProjection + RUNTIME_KEY
│   ├── context-profile-store.ts  ContextProfileStore
│   └── vfs-utils.ts / ulid.ts    VFS 助手 / ULID
├── plugins/                      会话插件工厂
│   ├── session-plugin.ts         createSessionPlugin
│   ├── vcs-plugin.ts             createVcsPlugin
│   └── history-plugin.ts         createHistoryPlugin
├── services/                    业务服务（注入文件系统持久化）
│   ├── agent-service.ts          IAgentConfigService/IAgentManagementService/IConnectionService 接口
│   ├── vfs-agent-service.ts      VFSAgentService（Agent 配置 CRUD）
│   ├── privileged-command.ts     IPrivilegedCommandService/PlanCommandRequest/ExecCommandRequest
│   └── prompt-history-service.ts PromptHistoryService + getPromptHistory/initializePromptHistory
└── utils/                        error-formatter / file-backed-service / logger / vfs-entity-store
```

### VFS 路径设定

| 路径 / 常量 | 说明 |
|---|---|
| `/var/lib/sessions` | 会话存储根（`SESSION_STORAGE_ROOT`，`persistence/session-storage-layout.ts`），`SessionRepository` 在其下按 `<id>/` 组织 |
| `/var/lib/sessions/<id>/kernel` | Kernel Session 存储根（`sessionExecutionRoot()`，由 `SessionDirectoryStorageResolver` 解析，含 `catalog.seq/session.seq/tasks/…`，见 `kernel-api.md`） |
| `FLOW_MODULE_NAME = 'flows'` | 独立 flows 模块名（`persistence/flow-engine.ts`）；应用装配于 `/home/admin/flows`（`app-core/src/runtime/create-application-runtime.ts:106`），每个 Flow 一个 `.flow` 文件 |
| `/home/admin/.config/mindos/prompt-history` | prompt 历史文件系统（经 `initializeConversationSystem({ promptHistoryFiles })` 传入，`create-application-runtime.ts:192`） |
| `RUNTIME_KEY = 'conversation/runtime'` | Durable Conversation 运行时共享键 |

**约定**：Round 只表达对话历史（`historyParentIds`）；Run 引用经 `executions` 附着到 Round；Branch/merge/context fold 只在本包实现；普通 Chat 用 Direct Scheduler，不伪装成单节点 DAG；不访问 Kernel Dispatcher/ProcessTable 内部对象。

记忆检索注入：`initializeConversationSystem({ retrieveMemory, ... })` 将回调传递到 SessionManager。回调签名为 `(plan, agent, { sessionId, policy }) => Promise<RetrievedMemoryEntry[]>`；policy 是当前 Agent memoryPolicy 的独立副本，缺少策略时为 undefined。结果经 ContextAssembler 进入 Task 输入快照。app-core 默认装配 SessionMemoryProvider（`create-application-runtime.ts` 以 `new SessionMemoryProvider(kernel.kernel).retrieve` 注入）。

`SessionMemoryProvider(kernel)` 提供 `upsert(sessionId, policy, { entryId, scope, content })`、`remove(sessionId, policy, scope, entryId)`、`prune(sessionId, policy, before)`（按宿主水位裁剪 writeScopes 内未更新的条目）和可直接注入的 `retrieve` 回调。存储在目标 Kernel Session shared，按 namespace/scope 精确隔离，写入校验 writeScopes、检索校验 readScopes。检索默认 10 项（0 禁用），使用词项包含匹配及更新时间排序，返回内容和 SHA-256 摘要。返回 entryId 是 JSON 编码的 `[scope, entryId]`，修改/删除使用原始 entryId。**保留期（2026-09-11）**：`MemoryPolicy.retention` 支持 `maxEntriesPerScope`（写入后优先保留本次写入、再按更新时间保留至 N 条；before 水位仍可剔除本次写入）与 `before` 水位（写入/裁剪时丢弃更早条目），作用范围仅限该策略的 scope；`prune` 只作用于 `writeScopes`，非法上限/水位在打开存储前拒绝。当前存储按 scope 整组加载，未提供跨 Session 共享或向量检索；模型写入工具由下述 TaskMemoryService 接线，调用方必须提供可信的 Agent 策略。

记忆继承边界：executeDirect 保持 memory 检索；executeDag 在组装上下文时禁用 provider，避免父 Agent 的长期记忆进入临时 Flow 的编译快照。需要给 Flow 的信息应作为显式输入传递。

记忆管理：`SessionMemoryProvider.list(sessionId, policy)` 返回 `MemoryEntry[]`（原始 entryId、scope、namespaceId、content、contentHash、updatedAt），仅枚举 readScopes，按 scope/entryId 排序并去重 scope，不受 retrievalLimit 限制；返回值与存储隔离。此接口仍按 scope 整组读取，不是分页接口。`upsert`/`remove` 可传末尾参数 `MemoryMutationOptions`：`expectedContentHash` 省略时保持无条件写语义，null 要求条目不存在，SHA-256 要求当前内容匹配。每次 CAS 重试重新检查条件，冲突拒绝并提示重新加载；这是内容级检查，不是历史版本检查，相同内容的删除重建无法据此识别。策略仍由可信宿主提供，接口不赋予模型选择策略的权限。

会话管理入口：`SessionManager.memory` 提供 `list(agentId)`、`upsert(agentId, entry, options?)` 和 `remove(agentId, scope, entryId, options?)`。每次调用先固定当前绑定 Session，再从 Agent 配置服务读取该 Agent 的 memoryPolicy；Agent 不存在或无策略时拒绝，不使用聊天默认 Agent 回退。调用方不传授权策略，写操作遵守宿主 canWriteSession 门控，读取仍按 readScopes。该接口面向宿主管理 UI，不是模型工具；运行中的模型写入需要单独绑定冻结的 Agent 策略。

`SessionMemoryControls.forSession(sessionId)` 创建固定 Session 的宿主管理视图，沿用同一 Agent 配置服务和写租约检查。app-shell 的会话 Files 页用此视图打开记忆管理对话框，避免后台切换绑定会话后窗口后续操作写错目标。

任务级记忆执行：`TaskMemoryService(kernel).invoke(toolId, args, context)` 支持 memory_list/memory_write/memory_remove。context 的 sessionId/taskId/abortSignal 必须由可信宿主 Effect 适配器提供，不能来自模型参数。服务从持久 Task input 读取 memoryPolicy 和 allowedToolIds，要求 llm.agent、工具在白名单且 Task 未终态；模型不能覆盖 Session/策略。写入参数为 scope、entryId、content，可选 expectedContentHash；删除不含 content。共享 createKernelRuntime 已将服务接入工具目录与 tool.call Effect；调用方需显式允许对应 toolIds。取消等待服务实际完成，不能回滚已经提交的存储操作；写入/删除按 local 副作用，崩溃时不自动重放。

存储失败边界：CAS 只对 KernelErrorCode.CONFLICT 重试（最多三次），每次重新读取并校验内容条件；其他存储错误直接返回，包括已提交但回执失败的情况，调用方应先重新加载再决定操作。prune 按 scope 分别提交，不提供跨 scope 原子性，后续 scope 失败时此前提交仍然保留。

### 失败与取消的消费收尾

ConversationRunCoordinator 在根等待或最终任务发现失败后仍等待所有已启动事件消费者结束。失败和取消的 Round 保留原因以及已开始的工具调用；未完成工具调用生成错误结果，重载投影保留相同错误原因。Session 删除的关闭调用及状态读取共享超时，超时保留记录，迟到结果不会触发删除；已关闭 Session 可安全重试删除。

### 发送失败、审批恢复与终态展示批次（2026-09-14）

发送返回错误时恢复草稿并显示错误，不再按发送前后轮次差集推测并删除记录：回复丢失不能证明请求未被受理，已有历史与执行事实需保留。发送不依赖额外历史查询；附件上传失败不发起 Send。发送期间切换会话的完整草稿/请求归属仍需另行验收。

编辑器重开时优先恢复仍未终态的已记录特权 Task，否则查找当前 Session 最新的待交互 Task。查找返回后核验编辑器身份、Session 与挂接操作代数，关闭或新挂接使旧结果失效；销毁开始就解除挂接。挂接在首次异步让出前捕获代数，detach 后不会复活。事件重放仅向审批界面转发持久记录仍为 pending 的请求；已有历史审批不会再次弹出。

TTY 首次结束信息保持不变，后续结束通知与输出不覆盖；已知退出码与未知退出码分别显示，新增文案同步中英文。failed/aborted 历史节点均显示经过转义的原因。

隔离快照验证：llm-ui 28 项，app-shell 整包 178 项及新增终态原因 2 项，共 208 项通过；30 项既有条件跳过。Web/Tauri 类型检查及 Tauri 前端构建通过。发送回归原逻辑 3 失败/1 通过、修复后 4 通过；关闭挂接回归修复前失败、修复后通过。真实 Kernel 重建后，待审批 Task 重新挂接并批准，原 Task 成功且没有新建替代任务。该测试使用内存 VFS 的持久记录重建，不等同于进程 SIGKILL 或真实 GUI；P0-02/P0-04/P0-05 仍开放。
