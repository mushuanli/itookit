# LLM 四层公共接口审查（harness / llm-programs / llm-flow / llm-session）

> 审查目标：接口定义是否**功能清晰、用户友好**（易懂、易用、职责单一、命名一致）。

## 1. 接口清单（当前公共 API）

### 1.1 harness — 执行内核（30+ 概念）

**顶层入口**：`Harness`（createSession/openSession/submit/signal/cancel/recover/eventList/…）+ 工具 `bindCapabilities`/`assertEffectGrant`/`interactionApproved`。

**`SessionHandle`（30 个方法，混合 6 个概念域）**：

| 概念域 | 方法 |
|---|---|
| Task 生命周期 | `submit` / `signal` / `respond` / `events` |
| 共享状态 | `getShared` / `setShared` / `deleteShared` / `listShared` / `sharedHistory` |
| 跨会话消息 | `send` / `inbox` |
| Context 分支 | `commitContext` / `getContextCommit` / `getContextBranch` / `contextHistory` |
| 资源/权限 | `createResource` / `grantResource` / `revokeResource` / `authorizeResource` |
| 预算 | `setBudget` / `chargeBudget` |
| 工作区 | `snapshotWorkspace` / `diffWorkspace` / `mergeWorkspace` |
| 生命周期 | `suspend` / `resume` / `close` |

**`TaskHandle`（11 个方法，较干净）**：`status/wait/poll/signal/start/respond/createResource/cancel/events/history/attempts`。

**核心抽象**：`DurableTaskProgram`（init/reduce）、`EffectAdapter`（execute/reconcile/cancel）、`Decision`、`KernelAction`、`WaitSpec`、`TaskSpec`、`EffectExecutionContext`。

### 1.2 llm-programs — LLM 任务单元（职责单一）

- 程序：`DurableChatProgram` / `DurableAgentProgram` / `DurablePlanProgram`。
- 类型：`DurableProgramInput` → `DurableAgentInput`（+maxExchanges/workingDirectory/approval/tools/externalToolIds）。
- 工具：`buildLlmTaskInput`（装配输入）、`extractNodeOutput`（提取输出）、`collectDependency`/`dependenciesReady`/`dependencyWait`（依赖收集）、`ContextAssembler`、`ProviderMessageAdapter`。

### 1.3 llm-flow — DAG 编排（简洁）

- `DurableFlowExecutor.submit(sessionId, spec: DagRunSpec) → FlowExecutionHandle`。
- `FlowExecutionHandle`：`root`（汇聚任务句柄）+ `nodes`（节点句柄 Map）+ `iterations`（每个节点实例数）。
- 插件：`DagPlugin` / `DagPluginRegistry` / `createBuiltinDagPluginRegistry`。
- 程序：`FlowValueProgram` / `FlowHumanProgram` / `FlowAggregateProgram`。
- 工具：`findCycles`、`flowToDag`、`FlowDefinitionStore`、`DagCommandService`。

### 1.4 llm-session — 会话门面（50 方法上帝接口）

`SessionManager`（~50 方法）+ `ChatEngine`/`IChatEngine` + `SessionEventBus` + `RoundLog`/`RoundGraphService` + `BranchService`。

`SessionManager` 涵盖：会话绑定/快照、消息发送/中止、分支（create/switch/rename/getTree）、上下文（preview/modes/snapshot）、消息编辑/删除/再生、草稿、sibling 切换。

## 2. 功能清晰度分析

| 包 | 清晰度 | 说明 |
|---|---|---|
| harness | ⚠️ 概念多但命名准确 | `submit/signal/chargeBudget/commitContext` 都是精确动词；但 30 方法挤在一个 `SessionHandle` 上，读者很难一眼看出「哪些是一组」 |
| llm-programs | ✅ 最清晰 | 单一职责（定义 LLM 任务怎么跑），类型扁平、工具函数命名直白 |
| llm-flow | ✅ 简洁 | `submit(spec)` 一个入口，`FlowExecutionHandle` 三字段干净 |
| llm-session | ❌ 最不清晰 | `SessionManager` 是「会话上帝门面」，50 方法混合消息/分支/上下文/再生/编辑五个子域 |

## 3. 用户友好性分析（易用性）

| 维度 | 现状 | 问题 |
|---|---|---|
| **入口发现** | harness 要从 `Harness` 开始；llm-session 要从 `initializeConversationSystem` 开始 | 装配路径长，新人不知道「最小可用」入口 |
| **命名一致性** | `DurableAgentInput.maxTokens`（驼峰）vs `TokenUsage.total_tokens`（下划线）；`SessionManager.send`（跨会话）vs `sendMessage`（消息） | 跨层协议风格混用，`send` 与 `sendMessage` 易混淆 |
| **错误模型** | harness 抛 `Error`（message/code）；llm-session 有 `ConversationError`；llm-flow 有 `FlowDraftVersionConflictError` | 三个包三种错误风格，无统一错误契约 |
| **返回值** | `submit → TaskHandle`、`sendMessage → void`（经事件流）、`chargeBudget → BudgetAccount[]` | 有的走句柄、有的走事件、有的直接返回，风格不统一 |
| **空值/可选** | `DurableAgentInput` 大量可选字段；`SessionHandle.respond<T>` 泛型 | 可选字段多时无「必填 vs 可选」的强约束，靠运行时校验 |

## 4. 主要问题与建议

### 🔴 问题 1：`SessionHandle` 30 方法是「内核系统调用表」，不是「用户 API」

harness 定位是内核，30 方法可接受（OS 内核系统调用也上百）。但**没有分层**：把资源/预算/工作区/上下文这些「专家级 API」和 `submit/signal/respond` 这些「日常 API」混在同一个 handle 上。

**建议**：按概念域拆成窄接口（ISP），或提供「分层 facade」：
- `SessionHandle.submit/signal/respond/events`（日常）
- `SharedState`（getShared/setShared/…）
- `ResourceManager`（createResource/grant/revoke/authorize）
- `BudgetManager`（setBudget/chargeBudget）
- `ContextStore`（commitContext/getContextBranch/…）
- `Workspace`（snapshot/diff/merge）

### 🔴 问题 2：`SessionManager`（llm-session）50 方法是「会话上帝门面」

混合了五个子域，违反 ISP 与 SRP。是四个包里最需要收敛的。

**建议**：拆成 `ConversationApi`（sendMessage/abort/regenerate/delete/commitEdit）+ `BranchApi`（createBranch/switchBranch/getBranchTree/renameBranch）+ `ContextApi`（previewContext/setContextMode/getContextSnapshot）+ `SessionRegistryApi`（getSnapshot/getSessions/…）。或用「命令式 facade + 查询式只读接口」分离读写。

### 🟠 问题 3：命名不一致

- `SessionManager.send(targetSessionId, topic, payload)`（跨会话消息）与 `sendMessage(text, …)`（用户消息）——`send` 太泛，应改 `sendToSession` 或 `publish`。
- `maxTokens`（驼峰）与 `total_tokens`（下划线）——协议层字段（贴近 provider）用下划线，应用层用驼峰，但跨层传递时混用易错。

### 🟠 问题 4：错误模型不统一

harness 用裸 `Error` + `code`，llm-session 用 `ConversationError`，llm-flow 用特定 `FlowDraftVersionConflictError`。建议至少给 harness 定义一个 `HarnessError`（带 code 枚举），上层统一捕获。

### 🟢 问题 5（正面）：llm-programs 与 llm-flow 接口质量高

- llm-programs 的 `buildLlmTaskInput`/`extractNodeOutput`/`collectDependency` 是优秀的「易用助手」，把繁琐的字段装配/依赖收集/输出提取抽象掉了。
- llm-flow 的 `submit(spec) → FlowExecutionHandle` 是干净的「单一入口 + 结果句柄」模式。

## 5. 结论

| 包 | 功能清晰 | 用户友好 | 主要问题 |
|---|---|---|---|
| harness | ⚠️ | ⚠️ | `SessionHandle` 30 方法无分层 |
| llm-programs | ✅ | ✅ | 命名轻微不一致（maxTokens vs total_tokens） |
| llm-flow | ✅ | ✅ | 入口需先拿 sessionId（分层合理） |
| llm-session | ❌ | ❌ | `SessionManager` 50 方法上帝门面 |

**一句话**：llm-programs 与 llm-flow 的接口是「正面教材」（职责单一 + 易用助手）；harness 的问题是「宽但没分层」；llm-session 的问题是「上帝门面」。优先级：**先拆 llm-session 的 SessionManager，再给 harness 的 SessionHandle 分层**。
