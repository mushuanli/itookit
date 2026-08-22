# 跨包接口契约

调用方只依赖接口，不依赖实现。契约层分三处：`@itookit/common`（通用）、`@itookit/llm-common`（LLM 领域）、`@itookit/stdio`（VFS 协议层）。

## VFS 体系（@itookit/stdio）

| 接口 | 核心方法 | 定义 | 实现 | 消费 |
|---|---|---|---|---|
| `IStorageBackend` | `stat/list/read/write/mkdir/delete/rename` | `stdio/interfaces/storage/` | `vfsdriver-indexeddb`、`vfsdriver-localfs` | `stdio (VFSEngine)` |
| `IVFSManager` | `getEngine()/mountModule()/on()` | `stdio/interfaces/services/` | `stdio (VFSManager)` | `app-shell`、`llm-ui`、`llm-session` |
| `IModuleFS` | `openFile()/driver/meta/capabilities` | `stdio/interfaces/services/` | `stdio (ModuleFS)` | `vfs-ui`、`mdxeditor`、`llm-ui` |
| `IFSDriver` | `read/write/create/delete/getChildren/stat/search` | `stdio/interfaces/services/` | `ModuleFS.driver` | 编辑器、`llm-session` |
| `IFSMetaDriver` | `putAsset/getAsset/setTags/watch` | `stdio/interfaces/services/` | `ModuleFS.meta` | `llm-session`、`mdxeditor` |
| `IFile` | `read()/write()`（extends `IIOStream`） | `stdio/interfaces/IFile.ts` | `FileHandle`、`MDXFileHandle` | `mdxeditor`、`llm-session` |
| `IIOStream` | `read()/write()/readStream?/close?` | `stdio/interfaces/` | 文件/设备句柄 | 文件↔LLM↔TTY 互拷 |
| `IDeviceDriver` | `open()/ioctl()/close()` | `stdio/interfaces/device/` | `LLMDeviceDriver`、TTY driver | `coreutils`、`device-llm` |

## LLM 契约（@itookit/llm-common + @itookit/common）

| 接口/类型 | 核心字段/方法 | 定义 | 实现 | 消费 |
|---|---|---|---|---|
| `ILLMService` | `chat()`、`chatStream()`、`abort()`、`getConnection()` | `llm-common/llm/llm-service.ts` | `coreutils LLMServiceAdapter` | `llm-programs`（经 effect）、`llm-session` |
| `ChatMessage` | `role/content/attachments?` | `llm-common/llm/` | device-llm | 全部 LLM 层 |
| `ChatCompletionParams/Response/Chunk` | `messages/model/tools/stream/webSearch`… | `llm-common/llm/completion.ts` | device-llm providers | `llm-programs`、`coreutils` |
| `Citation` | `text/source/title/url`（联网搜索引用） | `llm-common/llm/completion.ts` | device-llm providers | `coreutils`、`llm-ui` |
| `TokenUsage` | `prompt_tokens/completion_tokens/total_tokens` | `llm-common/llm/completion.ts` | device-llm | `llm-programs`、预算扣减 |
| `LLMConnection/ConnectionMeta` | `id/provider/tier/model/protocol` | `llm-common/llm/connection.ts` | `device-llm` | `llm-session AgentResolver` |
| `WebSearchMode` | `'builtin'\|'client-tool'\|'disabled'` | `llm-common/llm/connection.ts` | `resolveWebSearchStrategy`（纯函数） | `llm-session` |
| `LLMProvider.capabilities.serverSideWebSearch` | 服务端内置联网搜索能力（唯一事实源） | `llm-common/llm/connection.ts` | `constants/providers.ts` | `resolveWebSearchStrategy` |
| `ToolCall` / `ToolDefinition` | `id/name/arguments` | `llm-common/llm/` | device-llm / `tools` | `llm-programs` |
| `DagNode/DagEdge/DagRunSpec/DagNodeOutcome` | `id/plugin/config/outputs/effects` | `llm-common/agent/dag-plugin.ts` | `llm-flow` | `llm-session`、`cli` |
| `FlowDraft/FlowRevision/FlowNodeDefinition` | `nodes/edges/layout` | `llm-common/agent/flow-definition.ts` | `llm-flow FlowDefinitionStore` | `llm-ui`、`llm-session` |
| `SerializableExpression` | `kind: eq/neq/in/and/or/not/…` | `llm-common/agent/` | `llm-flow operations` | `cli` 编译路由条件 |

## Harness 执行内核（@itookit/harness）

| 接口/类型 | 核心方法/字段 | 说明 |
|---|---|---|
| `DurableTaskProgram<S,I,O>` | `init(input) → Decision`、`reduce(state, event) → Decision` | 持久化状态机（Program 定义） |
| `EffectAdapter<R,O>` | `execute(request, ctx)`、`reconcile?`、`cancel?` | effect 执行适配器（能力面） |
| `Decision<S,O>` | `state + actions + next`（`complete/fail/wait/continue`） | 程序推进的返回结构 |
| `KernelAction` | `effect/spawn/request-interaction/set-shared/delete-shared/emit` | 程序声明的副作用 |
| `WaitSpec` | `signal/effect/task/interaction/all/any/quorum/child` | 等待条件 |
| `TaskHandle<I,O>` | `wait()/poll()/signal()/start()/respond()/createResource()/cancel()/events()` | 任务句柄 |
| `SessionHandle` | `submit()/signal()/respondInteraction()/createResource()/setBudget()/chargeBudget()/commitContext()/events()` | 会话句柄 |
| `TaskSpec<I>` | `program/input/dependsOn/retry/deferStart` | 提交任务的规格 |
| `TaskInputEvent` | `signal/task-exited/effect-completed/effect-failed/interaction-resolved` | 程序收到的输入事件 |
| `EffectExecutionContext` | `grants/abortSignal/emit()/chargeBudget()/sessionState` | effect 执行上下文 |
| `CapabilityBinding` / `bindCapabilities` | `kind/uri/rights/signalKey` | 能力绑定（createResource+signal+start） |
| `assertEffectGrant` / `interactionApproved` | — | effect 授权断言 / 审批判定 |
| `TaskHandle.bindCapabilities` | — | 上层能力绑定统一入口 |

## LLM 任务单元（@itookit/llm-programs）

| 接口/类型 | 说明 |
|---|---|
| `DurableProgramInput` | `sessionId/roundId/messages/connectionId/model/temperature/…` |
| `DurableAgentInput` | + `maxExchanges/workingDirectory/approval/tools/externalToolIds` |
| `DurableAgentOutput` / `DurableChatOutput` | `{ message, usage, finishReason, exchanges }` |
| `DurableDependencyBinding` | `taskId/input/output?`（跨节点数据边） |
| `buildLlmTaskInput` | 统一装配 llm.agent/chat 的 input |
| `extractNodeOutput` | `outputs[name].content → message.content → raw` 统一提取 |
| `collectDependency/dependenciesReady/dependencyWait` | 依赖收集状态机 |
| `ContextAssembler` | 上下文/记忆装配（tokenBudget 裁剪） |
| `ProviderMessageAdapter` | provider 消息策略适配（OpenAI/Anthropic 消息差异） |

## DAG 编排（@itookit/llm-flow）

| 接口/类型 | 说明 |
|---|---|
| `DagPlugin` / `DagPluginRegistry` / `DagPluginCatalog` | 插件契约与注册表 |
| `DurableFlowExecutor` | 动态图调度（route/loop/spawn/compensate/on_failure/budget） |
| `FlowValueProgram` / `FlowHumanProgram` / `FlowAggregateProgram` | flow 内置 durable programs（`flow.value/human/aggregate`） |
| `FlowDefinitionStore` / `FlowAssetStore` | Flow 定义持久化（依赖最小 asset 存储面） |
| `DagCommandService` | DAG 控制面命令（run/snapshot/…） |
| `findCycles` | 环检测（回边 + 环上节点） |

## 会话层（@itookit/llm-session）

| 接口/类型 | 说明 |
|---|---|
| `IChatEngine` | 会话持久化门面（VFS 资产/消息/会话清单），由 ChatEngine 实现 |
| `ConversationManifest` / `ConversationUIState` / `BranchTreeNode` | 会话清单/UI 状态/分支树 |
| `RoundManifest` / `RoundProjection` / `BranchMeta` | Round 持久化投影 |
| `SessionManager` / `SessionRegistry` / `SessionState` | 会话生命周期与状态 |
| `IAgentConfigService` | Agent/Connection 配置服务（供 AgentResolver 解析） |
| `CommandBus` / `ExtensionRegistry` / `ILLMPlugin` | 控制面命令与插件系统 |
| `ConversationSystem` / `initializeConversationSystem` | 装配入口（session + flow + programs + harness） |

## 能力实现（@itookit/coreutils）

| EffectAdapter | kind | 说明 |
|---|---|---|
| `LlmChatEffectAdapter` | `llm.chat` | LLM 对话（流式/非流式 + token 预算扣减） |
| `ToolCallEffectAdapter` | `tool.call` | 工具调用 |
| `SkillLoadEffectAdapter` | `skill.load` | Skill 加载 |
| `BashEffectAdapter` | `bash` | Shell 命令 |
| `TtyEffectAdapter` | `tty` | TTY 会话 |

## UI 体系（Ports/Adapters）

| Port 接口 | 关键方法 | 实现 |
|---|---|---|
| `IChatInputPresenter` | `setLoading()/setConfig()/getConfig()/focus()` | `ChatInput` |
| `IHistoryPresenter` | `appendNode()/updateNode()/clear()` | `HistoryView` |
| `IStreamingController` | `appendChunk()/finish()` | `StreamController` |
| `ICollapseManager` | `fold()/unfold()/foldAll()` | `CollapseController` |
| `INavigationPresenter` | `navigateTo()/highlightNode()` | `NavigationHelper` |
| `IStatusPresenter` | `showStatus()/clearStatus()` | `StatusIndicatorView` |
