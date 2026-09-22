# 核心集成链

> 详细架构参见 [architecture.md](./architecture.md)

## 1. VFS 全栈链（@itookit/vfs-core）

```
vfs-ui (VFSUIShell)
  → IFileSystem (vfs.openFileSystem(rootPath))
     → FileSystemView.driver (IFSDriver) → VFSEngine → IStorageBackend
```

| 步骤 | 组件 | 关键文件 |
|---|---|---|
| 1. 创建 | `createVFS({ rootBackend, additionalMounts, devices, plugins })` | `vfs-core/src/impl/factory.ts` |
| 2. 引擎 | `VFSEngine` — 路径解析、系统节点映射 | `vfs-core/src/impl/engine/` |
| 3. 管理器 | `VFSManager` — 挂载/设备/插件 | `vfs-core/src/impl/services/` |
| 4. 文件视图 | `FileSystemView`（组合多个挂载点，按路径归一化） | `vfs-core/src/impl/services/` |
| 5. 存储 | `IStorageBackend`（IndexedDB / LocalFS） | `vfsdriver-*/src/` |

重命名使用路径型节点 ID，因此必须同步整条运行链：

```
node:renamed
  → VFSStore 原子迁移节点、后代路径和 active/selected/expanded 状态
  → editor-connector.setTitle() + updateNodeId()
  → LLMWorkspaceEditor
      ├─ StateManager / HistoryView 内嵌 MDX owner
      ├─ SessionRegistry / active task
      └─ RoundLog / manifest 路径缓存
```

## 2. LLM Chat 链（Direct 会话）

打开 Session 时，`SessionService.loadSession` 只绑定一次，完成目标分支选择后复用 manifest；输入状态在 HistoryView 创建前读取。新建 API 的侧栏刷新与编辑器打开并行。历史链读取和首屏 Markdown 去重的证据见 [Session 性能审查](./design/llm-ui-session-performance.md)。

```
ChatInput.send (llm-ui)
  → SendMessageCommand
    → llm-session SessionManager.sendMessage()
      → ConversationRunCoordinator
        → 对话：仅保留联网检索能力；执行：保留 Agent 已授权工具
          → session.submit(llm.chat / llm.agent，优先 v2)
          → bindCapabilities(llm[/tool] handle)
          → kernel drain → DurableAgentProgram.reduce → llm.chat effect
            → kernel-adapters LlmChatEffectAdapter（assertEffectGrant + chargeBudget）
              → ILLMService.chatStream
                → LLMServiceAdapter → LLMDeviceDriver.ioctl(CHAT)
                  → provider（OpenAI/Anthropic/Gemini）→ SSE 流式
```

| 步骤 | 组件 | 关键文件 |
|---|---|---|
| 输入 | `ChatInput.triggerSend()` | `llm-ui/src/components/input/` |
| 命令路由 | `SendMessageCommand` / `SlashCommandRouter` | `llm-ui/src/commands/`, `shell/` |
| 会话 | `SessionManager.sendMessage()` | `llm-session/src/session/session-manager.ts` |
| 编排 | `ConversationRunCoordinator`（Direct / Flow 分流） | `llm-session/src/session/conversation-run-coordinator.ts` |
| 程序 | `DurableChatProgram` / `DurableAgentProgram` | `llm-tasks/src/durable/` |
| 能力绑定 | `bindCapabilities` → capabilities signal | `durable-kernel/src/application/capabilities.ts` |
| Effect | `LlmChatEffectAdapter`（llm.chat） | `kernel-adapters/src/effects/llm-chat-effect.ts` |
| LLM | `ILLMService.chatStream` → provider | `kernel-adapters/llm/llm-service-adapter.ts`、`device-llm/src/` |

输入工具栏提供「对话 / 执行」：`executionMode` 随 Session settings 保存，发送时写入 `SendIntent.execution.mode`，在异步上传/任务准入前复制。Task 固定 `labels.executionMode`、工具列表和预算；执行中的模式按钮禁用，程序恢复不重新读取 UI 设置。对话模式只允许已授权的 WebSearch 客户端工具或 Provider 内置搜索；执行模式使用 llm.agent，最多 50 次模型交换，外部操作继续审批。Flow 选择后禁用该开关，按 Flow 定义执行。两种模式均使用既有 Context/GC。

执行模式工具链：app-core 的 `resolveHarnessToolIds` 从 Session 工具目录选择已启用的 Read/Glob/Grep/Write/Edit/Bash → llm-session 仅在 Agent 未配置 toolIds 时采用该默认集 → `resolveTools` 装配定义 → Task 固定 tools/allowedToolIds。显式空白名单不回退，无工具时显示错误。ToolDeviceDriver 将内置工具编码为 `type: function` + `function.name/description/parameters`，供模型适配器使用；文件操作仍经 Session VFS。

工具结果回传：OpenAI 兼容适配器必须保留 assistant 的 `tool_calls`，并把 `thinking` 映射为 `reasoning_content`，随后才能发送带 `tool_call_id` 的 tool 消息；丢失前者会使 DeepSeek 拒绝第二轮请求。CLI 流式工具往返回归见 [prompt-harness.test.ts](../apps/cli/tests/prompt-harness.test.ts)。

会话右键/顶部「重新运行」统一调用 `LLMWorkspaceEditor.commands.rerunSession`：关联 Flow 进入参数表单；Chat/Harness 从当前分支最后一条用户消息调用 `SessionCommand.RegenerateFromUser`。已有回复时创建替代分支，新的 Task 重新执行工具，保留旧 Task；使用当前工作区文件状态，不撤销旧文件修改。执行模式在点击时固定，重复点击只提交一次，切换会话或关闭编辑器取消尚未提交的操作。消息旁「重新生成」仍可选择指定轮次。回归见 [session-rerun.test.ts](../packages/app-shell/tests/session-rerun.test.ts) 和 [harness-default-tools.test.ts](../packages/app-core/tests/harness-default-tools.test.ts)。

## 3. DAG Flow 链（CLI 工作流）

```
cli run (apps/cli)
  → config.ts: loadWorkflow（YAML → validate）
  → run-definition.ts: compileRunDefinition → runtime.ts compileDag（编译 tasks/edges/route 条件）
    → toDagRunSpec（RunDefinition → DagRunSpec）
  → runtime.ts: createCliRuntime
      ├─ openLocalFSBackend → createVFS
      ├─ createKernelRuntime（createKernelAdaptersRuntime + new Kernel + registerDurablePrograms）
      └─ DurableFlowExecutor（core.dagPlugins = createBuiltinDagPluginRegistry）
  → DurableFlowExecutor.submit(sessionId, DagRunSpec)
      → 就绪节点逐个 session.submit(TaskSpec) → bindFlowTaskCapabilities → start
      → kernel drain → 节点 program（llm.agent / flow.value / flow.human …）
      → 数据边经 extractNodeOutput 注入下游
      → route/loop/spawn/compensate/on_failure 动态调度
  → FlowAggregateProgram 汇聚 {nodes} → selectFinalResult → RunStore 落盘（result.txt/artifacts）
```

| 步骤 | 组件 | 关键文件 |
|---|---|---|
| 配置 | `loadWorkflow`（YAML → validate） | `cli/src/config.ts` |
| 编译 | `compileRunDefinition` → `compileDag` → `toDagRunSpec` | `cli/src/run-definition.ts`、`cli/src/runtime.ts`、`app-core/src/run/run-definition.ts` |
| 装配 | `createCliRuntime`（vfs + `createKernelRuntime` + flow） | `cli/src/runtime.ts` |
| 调度 | `DurableFlowExecutor.submit` | `llm-flow/src/flow/executor.ts` |
| 插件 | `createBuiltinDagPluginRegistry`（transform/reduce/route/spawn/agent/human） | `llm-flow/src/flow/builtin-plugins.ts` |
| 结果 | `selectFinalResult` → `RunStore.writeResult` | `cli/src/run-store.ts` |

## 4. App 装配链（app-shell）

```
apps/web-app (entry)
  → createApplicationRuntime() (app-core)
    → createVFS() → LLMDeviceDriver → createKernelRuntime()
      → createKernelAdaptersRuntime（注册 effect/tool/skill）
      → new Kernel() + registerDurablePrograms（llm-tasks 的 agent/chat/plan + llm-flow 的 flow.*）
    → initializeConversationSystem({ agentService, sessionEngine, promptHistoryFiles, kernel, flowStore, dagPlugins })
      ├─ SessionManager / CommandBus / DagCommandService 装配
      └─ 插件激活（session / vcs / history）
  → initApp(runtime) (app-shell)
    → WorkspaceConfig（standard/settings/agent/chat/skills/flows）→ Workbench / SessionWorkbench
```

| 步骤 | 关键文件 |
|---|---|
| 入口 | `apps/web-app/src/main.ts` |
| 运行时装配 | `app-core/src/runtime/create-application-runtime.ts::createApplicationRuntime()` |
| 内核装配 | `app-core/src/runtime/create-kernel-runtime.ts::createKernelRuntime()` |
| 启动 | `app-shell/src/bootstrap.ts::initApp()` |
| VFS | `vfs-core/src/impl/factory.ts::createVFS()` |
| 内核 | `durable-kernel/src/application/kernel.ts::new Kernel()` |
| 能力 | `kernel-adapters/src/runtime/create-kernel-adapters-runtime.ts::createKernelAdaptersRuntime()` |
| LLM 系统 | `llm-session/src/index.ts::initializeConversationSystem()` |
| 工作区 | `app-shell/src/workspaces/`（`WorkspaceConfig`）+ `bootstrap.ts` 的 factories map |

## 5. TTY / 工具链（能力注入）

```
DurableAgentProgram.tool 调用（tool.call effect）
  → kernel-adapters ToolCallEffectAdapter（assertEffectGrant → resolveCapability）
    → tools 的 buildTool 实例（FileRead/Bash/…）
      → 经 vfs-core IDeviceDriver / VFS 访问实际资源
TTY：TtyEffectAdapter → device-tty（node-pty）
```
