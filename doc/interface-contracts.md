# 跨包接口契约

调用方只依赖接口，不依赖实现。契约层分三处：`@itookit/common`（通用）、`@itookit/llm-common`（LLM 领域）、`@itookit/vfs-core`（VFS 协议层）。

## VFS 体系（@itookit/vfs-core）

| 接口 | 核心方法 | 定义 | 实现 | 消费 |
|---|---|---|---|---|
| `FileStorageBackend` / `OperationOptions` | `files` + 可选 `mutations`，signal/timeoutMs，opaque revision | `vfs-core/src/interfaces/storage/file-storage.ts`、`vfs-core/src/interfaces/core/operation.ts` | `vfsdriver-http` | `FileStorageAdapter` → VFS |
| `IStorageBackend` | `stat/list/read/write/mkdir/delete/rename` | `vfs-core/interfaces/storage/` | `vfsdriver-indexeddb`、`vfsdriver-localfs` | `vfs-core (VFSEngine)` |
| `IVFSManager` | `openFileSystem()/mounts/devices/plugins` | `vfs-core/interfaces/services/vfs-manager.ts` | `vfs-core (VFSManager)` | `app-core`、`app-shell`、`driver-llm` |
| `IFileSystem` | `openFile()/driver/meta/capabilities/capabilitiesAt()/discoveryRoot?()` | `vfs-core/interfaces/services/file-system.ts` | `vfs-core (FileSystemView)` | `vfs-ui`、`llm-ui`、`llm-session`、`app-core` |
| `IFSDriver` | `getNode/getChildren/readContent/writeContent/createFile/createDirectory/rename/move/delete/search` | `vfs-core/interfaces/services/fs-driver.ts` | `FileSystemView.driver` | `vfs-ui`、`mdx-adapter`、`llm-session` |
| `IFSMetaDriver` | `assets/tags/seq/refs/watcher` | `vfs-core/interfaces/services/fs-meta-driver.ts` | `FileSystemView.meta` | `llm-session`、`mdx-adapter` |
| `IFile` | `read()/write()`（extends `IIOStream`） | `vfs-core/interfaces/IFile.ts` | `FileHandle`、`MDXFileHandle` | `mdx-adapter`、`llm-session` |
| `FileDiscoverySource` / `FileDiscoveryOptions` | `list/stat/readIgnoreFile/rootFor`；`includeIgnored/excludeDirectories/signal` | `vfs-core/interfaces/services/file-discovery.ts` | VFS 适配器、tools Node 适配器 | `discoverFiles` → 工具搜索及 llm-ui 文件候选 |
| `IIOStream` | `read()/write()/readStream?/close?` | `vfs-core/interfaces/` | 文件/设备句柄 | 文件↔LLM↔TTY 互拷 |
| `IDeviceDriver` | `open()/ioctl()/close()` | `vfs-core/interfaces/device/` | `LLMDeviceDriver`、TTY driver | `kernel-adapters`、`driver-llm` |

## LLM 契约（@itookit/llm-common + @itookit/common）

| 接口/类型 | 核心字段/方法 | 定义 | 实现 | 消费 |
|---|---|---|---|---|
| `ILLMService` | `chat()`、`chatStream()`、`abort()`、`getConnection()` | `llm-common/llm/llm-service.ts` | `kernel-adapters LLMServiceAdapter` | `llm-tasks`（经 effect）、`llm-session` |
| `ChatMessage` | `role/content/attachments?` | `llm-common/llm/` | driver-llm | 全部 LLM 层 |
| `ChatCompletionParams/ChatCompletionResponse/ChatCompletionChunk` | `messages/model/tools/stream/webSearch`… | `llm-common/llm/completion.ts` | driver-llm providers | `llm-tasks`、`kernel-adapters` |
| `Citation` | `text/source/title/url`（联网搜索引用） | `llm-common/llm/completion.ts` | driver-llm providers | `kernel-adapters`、`llm-ui` |
| `TokenUsage` | `prompt_tokens/completion_tokens/total_tokens` | `llm-common/llm/completion.ts` | driver-llm | `llm-tasks`、预算扣减 |
| `LLMConnection/ConnectionMeta` | `id/name/providerId/tiers/model/protocol` | `llm-common/llm/connection.ts` | `driver-llm` | `llm-session AgentResolver` |
| `WebSearchMode` | `'builtin'\|'client-tool'\|'disabled'` | `llm-common/llm/connection.ts` | `resolveWebSearchStrategy`（纯函数） | `llm-session` |
| `SettingsAutoSave` / `requestSettingsSave` | 设置表单延迟保存、串行写入、失败重试与安全释放；不重建编辑 DOM | `ui-common/src/components/SettingsAutoSave.ts` | `BaseSettingsEditor`、`configuration-form.ts` | 七类 LLM 设置编辑器 |
| `IConnectionService.listProviderModels` | 接受完整未保存 Provider，返回归一化模型目录；无持久化副作用 | `llm-common/llm/agent.ts` | `LLMDeviceDriver` → `providers/model-catalog.ts`，`VFSAgentService` 转发 | `ProviderSettingsEditor` |
| `LLMProvider.supportedProtocols/defaultProtocol/modelsPath`、`LLMModel.preferredProtocol` | Provider 协议集合与默认、模型目录覆盖、模型首选；连接显式协议优先 | `llm-common/llm/connection.ts`、`provider-protocols.ts` | `driver-llm` registry / Driver / `.llm` 转换 | Provider / Connection 设置页 |
| `LLMProvider.capabilities.serverSideWebSearch` | 服务端内置联网搜索能力（唯一事实源） | `llm-common/llm/connection.ts` | `kernel-adapters/src/llm-management/constants/providers.ts` | `resolveWebSearchStrategy` |
| `ToolCall` / `ToolDefinition` | `id/name/arguments` | `llm-common/llm/` | driver-llm / `tools` | `llm-tasks` |
| `ToolInvokeResult` | `success/output/durationMs`；可选 `data/errorCode/recoverable/truncated` | `llm-common/tools/tool-types.ts` | `tools`、`kernel-adapters` | `llm-tasks`：显式 recoverable 失败反馈模型，其余失败终止任务 |
| `DagNodeDefinition/DagEdgeDefinition/DagRunSpec/DagNodeOutcome` | `id/plugin/config/outputs/effects` | `llm-common/agent/dag-plugin.ts` | `llm-flow` | `llm-session`、`cli` |
| `FlowDraft/FlowRevision/FlowNodeDefinition` | `nodes/edges/layout` | `llm-common/agent/flow-definition.ts` | `llm-flow FlowDefinitionStore` | `llm-ui`、`llm-session` |
| `SerializableExpression` | `kind: eq/neq/in/and/or/not/…` | `llm-common/agent/` | `llm-flow operations` | `cli` 编译路由条件 |

## Kernel 执行内核（@itookit/durable-kernel）

| 接口/类型 | 核心方法/字段 | 说明 |
|---|---|---|
| `DurableTaskProgram<S,I,O>` | `init(input) → Decision`、`reduce(state, event) → Decision` | 持久化状态机（Program 定义） |
| `EffectAdapter<R,O>` | `execute(request, ctx)`、`reconcile?`、`cancel?` | effect 执行适配器（能力面） |
| `Decision<S,O>` | `state + actions + next`（`complete/fail/wait/continue`） | 程序推进的返回结构 |
| `KernelAction` | `effect/spawn/request-interaction/set-shared/delete-shared/emit` | 程序声明的副作用 |
| `WaitSpec` | `signal/effect/task/interaction/all/any/quorum/child` | 等待条件 |
| `TaskHandle<O>` | `wait()/poll()/signal()/start()/respond()/createResource()/cancel()/events()` | 任务句柄 |
| `SessionHandle` | `submit()/signal()/respond()/createResource()/setBudget()/chargeBudget()/commitContext()/events()` | 会话句柄 |
| `TaskSpec<I>` | `program/input/dependsOn/retry/deferStart` | 提交任务的规格 |
| `TaskInputEvent` | `signal/task-exited/effect-completed/effect-failed/interaction-resolved` | 程序收到的输入事件 |
| `EffectExecutionContext` | `grants/abortSignal/emit()/chargeBudget()/sessionState` | effect 执行上下文 |
| `CapabilityBinding` / `bindCapabilities` | `kind/uri/rights/signalKey` | 能力绑定（createResource+signal+start） |
| `assertEffectGrant` / `interactionApproved` | — | effect 授权断言 / 审批判定 |
| `bindCapabilities(task, bindings)` | — | 上层能力绑定统一入口（独立函数，非 `TaskHandle` 方法） |

## LLM 任务单元（@itookit/llm-tasks）

| 接口/类型 | 说明 |
|---|---|
| `DurableProgramInput` | `sessionId/roundId/messages/connectionId/model/temperature/…` |
| `DurableAgentInput` | + `maxExchanges/workingDirectory/approval/tools/externalToolIds` |
| `DurableAgentOutput` / `DurableChatOutput` | `{ message, usage, finishReason, exchanges }` |
| `DurableDependencyBinding` | `taskId/input/output?`（跨节点数据边） |
| `buildLlmTaskInput` | 统一装配 llm.agent/chat 的 input |
| `extractNodeOutput` | `outputs[name].content → message.content → raw` 统一提取 |
| `collectDependency/dependenciesReady/dependencyWait` | 依赖收集状态机 |
| `ContextTaskProgram` | v2 执行 bridge：Context 写集、Task 状态与下一 Effect 联合提交 |
| `ContextAssembler` / `ProviderMessageAdapter` | 兼容转发至 `@itookit/llm-context` |

## 上下文（@itookit/llm-context）

独立接口为 `IContextAssembler`、`IContextProfiles`、`IContextEngine`、`IContextService`、`IContextReader`、`IContextContentStore`、`IContextGcStore`。`PreparedContext` 返回 cursor、explanation 和 CAS writes；消费方通过 Kernel 通用 action 提交，Context 不依赖 Kernel。GC 端口提供与发布和根提交串行化的原子视图，默认仅回收静止终态 Task 的过期孤儿。完整字段与调用链见 [Context API](context-api.md)。

## DAG 编排（@itookit/llm-flow）

| 接口/类型 | 说明 |
|---|---|
| `DagPlugin` / `DagPluginRegistry` / `DagPluginCatalog` | 插件契约与注册表 |
| `DurableFlowExecutor` | 动态图调度（route/loop/spawn/compensate/on_failure/budget） |
| `FlowValueProgram` / `FlowHumanProgram` / `FlowAggregateProgram` | flow 内置 durable programs（`flow.value/human/aggregate`） |
| `FlowDefinitionStore` / `FlowStore` | Flow 定义持久化（依赖最小 asset 存储面） |
| `DagCommandService` | DAG 控制面命令（run/snapshot/…） |
| `findCycles` | 环检测（回边 + 环上节点） |

## 会话层（@itookit/llm-session）

| 接口/类型 | 说明 |
|---|---|
| `ISessionRepository` | 会话持久化门面（VFS 资产/消息/会话清单），由 SessionRepository 实现 |
| `ConversationManifest` / `ConversationUIState` / `BranchTreeNode` | 会话清单/UI 状态/分支树 |
| `RoundManifest` / `RoundProjection` / `BranchMeta` | Round 持久化投影 |
| `SessionManager` / `SessionRegistry` / `SessionState` | 会话生命周期与状态 |
| `IAgentConfigService` | Agent/Connection 配置服务（供 AgentResolver 解析） |
| `CommandBus` / `ExtensionRegistry` / `ILLMPlugin` | 控制面命令与插件系统 |
| `ConversationSystem` / `initializeConversationSystem` | 装配入口（session + flow + programs + kernel） |

## 能力实现（@itookit/kernel-adapters）

| EffectAdapter | kind | 说明 |
|---|---|---|
| `LlmChatEffectAdapter` | `llm.chat` | LLM 对话（流式/非流式 + token 预算扣减） |
| `ToolCallEffectAdapter` | `tool.call` | 工具调用 |
| `SkillLoadEffectAdapter` | `skill.load` | Skill 加载 |
| `SkillUnloadEffectAdapter` | `skill.unload` | Skill 卸载 |
| `BashEffectAdapter` | `process.exec` | Shell 命令 |
| `TtyEffectAdapter` | `tty.command` | TTY 会话 |

## UI 体系（Ports/Adapters）

| Port 接口 | 关键方法 | 实现 |
|---|---|---|
| `IChatInputPresenter` | `setLoading()/setConfig()/getConfig()/restoreInput()/focus()` | `ChatInput` |
| `IHistoryPresenter` | `renderFull()/processEvent()/scrollToBottom()/getSessionElement()` | `HistoryView` |
| `IEditor`（抽象类） | `init()/destroy()/getText()/setText()/setTitle()/updateNodeId?()/flushPendingSave?()/cancelPendingRender?()` | `MDxEditor`、`FlowsEditor`、`LLMWorkspaceEditor` |
| `IStreamingController` | `enterStreamingMode()/exitStreamingMode()` | `HistoryView`（经 `StreamController`） |
| `ICollapseManager` | `toggleSessionCollapse()/setAllCollapsed()/toggleAllFold()` | `HistoryView`（经 `CollapseController`） |
| `INavigationPresenter` | `toggle()/update()` | `FloatingNavPanel` |
| `IStatusPresenter` | `update()/updateFromSnapshot()/updateBackground()` | `StatusIndicatorView` |

### 会话目录配置

`EditorHostContext.chatFromFile(reference, association?)` 由宿主注入。MDX 仅提供当前文件路径、当前内容或选区快照；项目文件宿主补充 projectFolder，Session 文件宿主补充 sessionId。app-shell 负责项目归属、新建会话、持久化 main 分支输入草稿和导航，不自动发送。

`EditorHostContext.directoryCommands.configureWorkspace(mode)` 由 SessionWorkbench 注入，llm-ui 的 WorkspaceDirectoryMenu 消费。`workspaceReadOnly` 表示主目录设置仅供查看，不改变文件权限：项目会话的 `workspace` 模式展示项目目录，`mount` 模式管理额外挂载；未归属项目的会话仍可设置主目录。界面不直接接触宿主文件路径 API。运行时向 `DirectoryMountService.fixedWorkspace(sessionId)` 注入所属项目的目录，服务在写入授权前校验主挂载来源、权限和 cwd，拒绝替换、移除或借附加挂载改变主目录；继续复用 Session 授权 revision 和挂载变更守卫。

文件搜索可通过 `ToolVFSContext.walkFiles(dir, options)` 增量消费路径；`createVFSToolContext` 同时实现惰性接口和兼容的 `listFiles`，两者共享忽略规则。Grep/Glob 必须优先使用惰性接口，达到结果上限立即关闭迭代器，避免桌面 IPC 完整遍历导致工具超时。

## Tool / Skill / MCP 能力配置

`ILLMManagementService` 的 `testMCPServer`、`readMCPResource`、`getMCPPrompt` 由 LLMDeviceDriver 实现，VFSAgentService 转发给设置 UI。`SessionCapabilityScope.resolveMCPToolIds` 经 app-core 注入 AgentResolver 与 Harness/Flow 提交层；最终授权固定在 Task 输入。`ToolExecutionContext.onProgress` 与 `INativeShell.exec` 的 `onOutput` 连接进度生产者和 History 投影。详细语义与验证见 [能力配置与执行](./design/tool-skill-mcp-capabilities.md)。


### 文件编辑展示与读取

`EditorOptions.contentFormat` 区分 `markdown` 与 `text`。AppShell 根据统一文件注册表声明文档别名；默认编辑器将其他文件视为源码，保留编辑与保存能力，禁止 Markdown 预览。大 Markdown 默认源码模式，但仍允许用户显式预览。源码策略不改变 `readOnly` 或文件视图授权。

桌面 `fs_read_file` 和 `directory_read_file` 使用 Tauri 原始 `ArrayBuffer` 响应；后者缺失文件返回 `null`，越界、符号链接或已关闭 grant 仍拒绝访问。旧的完整文件 JSON 数字数组不再是这两个客户端入口的协议。

`EditorOptions.signal` 用于编辑器初始化期间的视图取消；完成初始化后解除绑定。宿主隐藏已创建的编辑器时调用 `cancelPendingRender`，独立于 `flushPendingSave`。取消预览不取消保存或持久任务。

HTTP 外挂的条件写入、取消与项目授权见 [HTTP VFS 设计](design/vfs-http-driver.md)；调用方必须使用读取字节时返回的 revision，不使用保存前 stat 替代读取版本。

`EditorHostContext.openFile(path, anchor?)` 打开编辑器文件命名空间中的文档。MDX 使用当前文件路径解析普通 Markdown 相对链接，宿主映射到所属项目/会话路由并打开标签；收藏入口仍以实际文件路径为基准，移动与重命名通过 updateNodeId 更新解析基准。外部 URL、附件与 mention 保留各自行为。

## 独立编辑器宿主接口

`packages/mdx/src/editor/contracts.ts` 定义并从 `@itookit/mdxeditor` 导出 `AssetProvider`、`StoreFactory`、`EditorHost`、`EditorOptions` 与 `IEditor`。核心不持有 `IFileSystem`，附件与插件存储按需注入，保存通过 `onSave` 注入。`@itookit/mdx-adapter` 将 `ui-common` 的 target/files/hostContext 转成上述公共端口，在构造编辑器前校验 namespace 与 Session；消息和会话标识保留在宿主，核心只使用可选 `documentPath`。

### 独立 VFS UI 接入

`vfs-ui` 仅依赖 `vfs-core`。`BrowserSource` / `BrowserAction` 接收自定义资源与动作；`VFSPresentationOptions` 按实例注入翻译、SVG 和启动跟踪；`TagEditorFactory` / `ContextMenuConfig` / `UIPersistencePort` 接收宿主组件、菜单和存储。消费方从 vfs-ui 导入这些类型，或提供结构兼容实现，无需依赖 common/ui-common。MindOS 展示适配位于 `app-shell/src/browser/vfs-presentation.ts`。

通信契约的权威实现已迁到 `driver-llm/src/types/`，llm-common 的 completion、connection、日志和协议模块保留兼容转发。中立消息契约归 `llm-context/src/domain/message.ts`；驱动的发布声明内联这些类型。模型设备与配置实现已迁到 `kernel-adapters/src/llm-management/`，通过 `@itookit/kernel-adapters/llm` 公开。
