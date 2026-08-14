# 架构设计 — 系统全貌

> 基于当前代码（2026-02 重构后）：执行内核 `harness`、LLM 任务单元 `llm-programs`、DAG 编排 `llm-flow`、会话语义 `llm-session`。

## 1. 分层总览

```
┌────────────────────────────────────────────────────┐
│  apps/{web-app(mind-os), cli, tauri-app}   入口   │
├────────────────────────────────────────────────────┤
│  app-shell                      引导 + 路由 + 装配  │
├──────────────┬──────────────┬──────────────────────┤
│  llm-ui      │  vfs-ui      │  mdxeditor           │  UI 层
├──────────────┼──────────────┼──────────────────────┤
│ llm-session  │  llm-flow    │ llm-programs         │  LLM 业务层
├──────────────┼──────────────┼──────────────────────┤
│  harness                     │                      │  执行内核
├──────────────┼──────────────┼──────────────────────┤
│ coreutils    │  device-llm  │ device-tty   tools   │  能力/引擎层
├──────────────┴──────────────┴──────────────────────┤
│  stdio (VFS)                  vfsdriver-*          │  存储层
├────────────────────────────────────────────────────┤
│  common / llm-common          契约层                │
└────────────────────────────────────────────────────┘
```

依赖铁律：**上层可依赖下层，下层永不知上层**。跨层通过接口注入（`app-shell/bootstrap.ts` 装配）。

## 2. Harness — 持久化执行内核

`@itookit/harness` 是唯一的执行引擎：一个 Task 一个持久化状态机。

**核心抽象：**

| 抽象 | 职责 |
|---|---|
| `DurableTaskProgram<S,I,O>` | `init(input)` 初始化状态 → `reduce(state, event)` 逐事件推进。每次返回 `Decision{ state, actions, next }`，state 必须 JSON 可持久化 |
| `EffectAdapter` | 副作用执行器：`execute`/`reconcile`（worker 丢失恢复）/`cancel` |
| `KernelAction` | 程序声明的副作用：`effect`/`spawn`/`request-interaction`/`set-shared`/`delete-shared`/`emit` |
| `WaitSpec` | 等待条件：`signal`/`effect`/`task`/`interaction`/`all`/`any`/`quorum`/`child` |

**执行流程（drain 循环）：**
```
SessionHandle.submit(TaskSpec) → store.createTask（依赖未满足则 blocked）
  → queueDrain → claimReady → TaskProgram.init/reduce → applyDecision
      ├─ 声明 effect → store 记 pending → dispatchEffect → claimEffect → EffectAdapter.execute
      ├─ 声明 spawn → 创建子 Task（patch-graph 动态扩展）
      └─ request-interaction → 等待 respondInteraction
  → effect 完成 → completeEffect → 事件入列 → 触发等待该 task 的下游
```

**关键机制：**
- **持久化**：`SeqFileHarnessStore`（seqfile 顺序日志 + snapshot），Task 状态/事件/effect 全部落盘，重启后 `recover()` 恢复（lease 过期任务重新入队）。
- **Effect 幂等**：`idempotencyKey` + `reconcile`，worker 丢失后避免重复副作用。
- **资源与预算**：`createResource`（类型化 handle + rights: read/write/execute/grant/admin）、`setBudget`/`chargeBudget`（token 预算账户）。
- **能力绑定**：`bindCapabilities(task, bindings, onHandle?)` — 创建资源 → 发 `capabilities` signal → `start()`。
- **交互**：`request-interaction` → `interaction-resolved`（HITL 审批/输入），`interactionApproved()` 统一判定。

**内核类比（session = 容器 / task = 进程 / harness = 内核）：**

| harness 职责 | 对应 OS 概念 |
|---|---|
| drain / claimReady / lease / maxConcurrent | 调度器 |
| 事件日志 + `WaitSpec` + wake | 信号量 / 通知 |
| seqfile store（task/effect/resource 落盘 + `recover()`） | 文件系统 + journal（崩溃恢复） |
| `createResource` + rights（read/write/execute/grant/admin） | 文件描述符 + 权限 |
| `setBudget` / `chargeBudget` | 资源配额 |
| `request-interaction` / `respondInteraction` | 阻塞等待外部输入 |

> 命名说明：`harness` 的 `package.json` 自述是 `"Durable Session/Task scheduling and resource kernel"`。它不止是 `scheduler`（调度），而是同时承担持久化、IPC、权限、配额、崩溃恢复的**执行内核（kernel）**。

**两级同步机制：**

| 级别 | 机制 | 落点 |
|---|---|---|
| task 私有 | 每个 task 独立 state + snapshot | `tasks/<taskId>/record`（仅 harness 写，task 是纯函数） |
| session 内（task 间） | ① 事件日志（`task-exited` 唤醒等待者）② 依赖边 ③ `setShared/getShared` | `events/<sequence>`、`edge/<dep>/<dependent>`、`shared/<key>` |
| session 间 | `sendCrossSession(source,target,topic,payload)` → outbox/inbox 消息队列 | 事件 `session.message.queued/delivered/received` |

## 3. LLM 子系统（llm-programs → llm-flow → llm-session）

```
llm-session ──▶ llm-flow ──▶ llm-programs ──▶ harness
（会话/持久化） （DAG 编排） （LLM 任务单元）  （执行内核）
```

### 3.1 llm-programs — LLM 任务单元

平台无关的 durable programs：`llm.agent`（带工具循环）、`llm.chat`（单轮）、`llm.plan`（规划）。

- **输入**：`DurableAgentInput`（sessionId/roundId/messages/connectionId/model/approval/tools/…），统一由 `buildLlmTaskInput` 装配。
- **依赖收集**：`collectDependency`/`dependenciesReady`/`dependencyWait` — 等待上游 task-exited → 提取输出（`extractNodeOutput`）→ 注入消息。
- **能力**：LLM/tool 通过 `capabilities` signal 获得 handle，走 `llm.chat`/`tool.call` effect。
- **上下文**：`ContextAssembler`（历史/记忆/tokenBudget 裁剪）+ `ProviderMessageAdapter`（provider 消息差异）。

### 3.2 llm-flow — DAG 编排

`DurableFlowExecutor` 把 LLM 任务连成动态图：

| 能力 | 说明 |
|---|---|
| Sequence / Branch(route) | 数据边 + 控制边，`route` 节点按 `SerializableExpression` 激活/禁用边 |
| Loop | 回边（`findCycles` 检测）+ `max_iterations`，环上节点重入 |
| Spawn | `patch-graph` effect 运行时动态加节点/边 |
| Compensate | Saga 回滚（`compensate` 配置 + 反向补偿链） |
| on_failure | `fail/skip/continue` 下游行为 |
| Budget | 节点级 `budget.tokens` → `setBudget` + effect 扣减 |

内置插件：`transform`/`reduce`/`route`/`spawn`/`agent`/`human`；Flow 程序：`FlowValueProgram`（transform/reduce/route/spawn）、`FlowHumanProgram`、`FlowAggregateProgram`（汇聚为 `{nodes}` 输出）。

> **llm-flow 不替代 llm-programs，而是编排它。** agent 节点（`builtin-plugins.ts agentTask()`）不重新实现 LLM 逻辑，而是生成 `llm.agent` 的 spec（`buildLlmTaskInput`）交给 llm-programs 的 `DurableAgentProgram` 跑。llm-flow 自己的程序只有图原语（`flow.value/human/aggregate`）。llm-programs 之所以独立存在：它同时被 **llm-session 的 Direct Chat**（不走 DAG，直接用 `llm.chat`/`llm.agent`）和 **llm-flow 的 agent 节点**共享——若并进 llm-flow，纯对话也要拖入 route/loop/spawn 等图语义。

### 3.3 llm-session — 会话语义 + 持久化

用户可见的对话层：

- **Round**：只表达对话历史（`historyParentIds`），Run 通过 `executions` 附着。
- **Branch / merge / context fold**：会话分支语义。
- **持久化**：`ChatEngine`（IChatEngine 门面，VFS 资产）、`RoundLog`（round 增量日志 + 投影）、`RoundGraphService`。
- **调度**：`SessionManager`/`ConversationRunCoordinator`（Direct Chat 走 llm.chat，Flow 走 `DurableFlowExecutor`）。
- **控制面**：`CommandBus` + `ExtensionRegistry` + 插件（session/vcs/history）；`initializeConversationSystem` 装配入口。

## 4. 能力/引擎层

| 包 | 职责 |
|---|---|
| `coreutils` | Harness 能力适配器：`LlmChatEffectAdapter`（含预算扣减）、`ToolCallEffectAdapter`、`SkillLoadEffectAdapter`、`BashEffectAdapter`、`TtyEffectAdapter`；`LLMServiceAdapter`（ILLMService → LLMDeviceDriver）；`createCoreutilsRuntime` 装配。 |
| `device-llm` | LLM 设备驱动：`LLMDeviceDriver`（IDeviceDriver + `LLM_IOCTL`：CHAT/CHAT_SYNC/ABORT/连接管理/MCP）；providers：OpenAI/Responses/Anthropic/Gemini；`MCPClient`。 |
| `device-tty` | TTY 驱动（node-pty 交互 shell）。 |
| `tools` | 内置工具 `buildTool()` 工厂：FileRead/Write/Edit、Glob、Grep、Bash、Skill、Agent、AskUserQuestion 等。 |

**LLM 调用链**：`LlmChatEffectAdapter` → `ILLMService.chatStream` → `LLMServiceAdapter` → `LLMDeviceDriver.ioctl(CHAT)` → provider（OpenAI/Anthropic/…）→ SSE 流式返回。

## 5. VFS 子系统（@itookit/stdio）

- **协议层**：`IModuleFS`/`IFSDriver`/`IVFSManager`/`IStorageBackend`/`FSNode`/`IDeviceDriver`。
- **引擎层**：`VFSEngine`/`ModuleFS`/`VFSManager`/`createVFS`（唯一初始化入口）。
- **存储后端**：`vfsdriver-indexeddb`（浏览器）、`vfsdriver-localfs`（SQLite+本地 FS）。
- **通用 IO**：`IIOStream` + `pipe`（文件↔LLM↔TTY 流互拷）。
- **事件总线**：通用 `EventBus`（LLM/UI 共用）+ VFS `FSEventBus`。

## 6. UI 与装配

- **`llm-ui`**：Chat UI（流式历史、Session 渲染、DagWorkbench 可视化）。
- **`vfs-ui`**：文件树 UI；**`mdxeditor`**：CodeMirror MDX 编辑器；**`ui-common`**：共享 UI 契约。
- **`app-shell`**：`initApp()` 装配 — createVFS → LLMDeviceDriver → Harness → `createCoreutilsRuntime` → `initializeConversationSystem` → Workbench。

## 7. 入口

- **`mind-os`（apps/web-app）**：浏览器 SPA（IndexedDB 后端）。
- **`@itookit/cli`（apps/cli）**：YAML 工作流 → 编译 DagRunSpec → `DurableFlowExecutor` 运行 → 结果落盘（`RunStore`）。
- **`tauri-app`**：桌面壳；**`sync-server`**：diff 同步服务。

## 8. 核心数据流

```
CLI:   YAML → config.ts 编译 → runtime.ts 装配(harness+coreutils+flow)
       → DurableFlowExecutor.submit → 每节点 session.submit(TaskSpec)
       → bindCapabilities → start → drain 循环 → effect → 聚合 → selectFinalResult → result.txt

App:   bootstrap → initializeConversationSystem → SessionManager
       → sendMessage → ConversationRunCoordinator → (llm.chat | DurableFlowExecutor)
       → 事件经 TaskHandle.events() / SessionEventBus 渲染到 llm-ui
```
