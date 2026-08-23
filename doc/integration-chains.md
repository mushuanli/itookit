# 核心集成链

> 详细架构参见 [architecture.md](./architecture.md)

## 1. VFS 全栈链（@itookit/vfs-core）

```
vfs-ui (VFSUIShell)
  → IModuleFS (VFSManager.getEngine())
     → ModuleFS.driver (IFSDriver) → VFSEngine → IStorageBackend
```

| 步骤 | 组件 | 关键文件 |
|---|---|---|
| 1. 创建 | `createVFS({ rootBackend, modules })` | `vfs-core/src/impl/factory.ts` |
| 2. 引擎 | `VFSEngine` — 路径解析、系统节点映射 | `vfs-core/src/impl/engine/` |
| 3. 管理器 | `VFSManager` — module lifecycle | `vfs-core/src/impl/services/` |
| 4. 模块 | `ModuleFS`（chroot 到 module 目录） | `vfs-core/src/impl/services/` |
| 5. 存储 | `IStorageBackend`（IndexedDB / LocalFS） | `vfsdriver-*/src/` |

## 2. LLM Chat 链（Direct 会话）

```
ChatInput.send (llm-ui)
  → SendMessageCommand
    → llm-session SessionManager.sendMessage()
      → ConversationRunCoordinator
        → (无工具) session.submit(llm.chat)  |  (有工具) llm.agent
          → bindCapabilities(llm[/tool] handle)
          → kernel drain → DurableAgentProgram.reduce → llm.chat effect
            → coreutils LlmChatEffectAdapter（assertEffectGrant + chargeBudget）
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
| 能力绑定 | `bindCapabilities` → capabilities signal | `kernel/src/application/capabilities.ts` |
| Effect | `LlmChatEffectAdapter`（llm.chat） | `coreutils/src/effects/llm-chat-effect.ts` |
| LLM | `ILLMService.chatStream` → provider | `coreutils/llm/llm-service-adapter.ts`、`device-llm/src/` |

## 3. DAG Flow 链（CLI 工作流）

```
cli run (apps/cli)
  → config.ts: loadWorkflow（YAML → validate → 编译 tasks/edges/route 条件）
  → runtime.ts: createCliRuntime
      ├─ openLocalFSBackend → createVFS
      ├─ createCoreutilsRuntime（kernel + effect adapters + tools + skills）
      ├─ DurableFlowExecutor（createBuiltinDagPluginRegistry）
      └─ registerPrograms（llm-tasks 的 agent/chat/plan + llm-flow 的 flow.*）
  → DurableFlowExecutor.submit(sessionId, DagRunSpec)
      → 就绪节点逐个 session.submit(TaskSpec) → bindCapabilities → start
      → kernel drain → 节点 program（llm.agent / flow.value / flow.human …）
      → 数据边经 extractNodeOutput 注入下游
      → route/loop/spawn/compensate/on_failure 动态调度
  → FlowAggregateProgram 汇聚 {nodes} → selectFinalResult → RunStore 落盘（result.txt/artifacts）
```

| 步骤 | 组件 | 关键文件 |
|---|---|---|
| 配置 | `loadWorkflow`（编译 DagRunSpec） | `cli/src/config.ts` |
| 装配 | `createCliRuntime`（kernel+coreutils+flow） | `cli/src/runtime.ts` |
| 调度 | `DurableFlowExecutor.submit` | `llm-flow/src/flow/executor.ts` |
| 插件 | `createBuiltinDagPluginRegistry`（transform/reduce/route/spawn/agent/human） | `llm-flow/src/flow/builtin-plugins.ts` |
| 结果 | `selectFinalResult` → `RunStore.writeResult` | `cli/src/run-store.ts` |

## 4. App 装配链（app-shell）

```
apps/web-app (entry)
  → initApp() (app-shell)
    → createVFS() → LLMDeviceDriver → new Kernel()
      → createCoreutilsRuntime(kernel, driver…)（注册 effect/tool/skill）
      → initializeConversationSystem({ agentService, sessionEngine, kernel, dagPlugins })
        ├─ registerPrograms（llm-tasks + llm-flow 的全部 durable programs）
        ├─ SessionManager / CommandBus / DagCommandService 装配
        └─ 插件激活（session / vcs / history）
    → WorkspaceStrategy（standard/settings/agent/chat/skills）→ Workbench
```

| 步骤 | 关键文件 |
|---|---|
| 入口 | `apps/web-app/src/` |
| 启动 | `app-shell/src/bootstrap.ts::initApp()` |
| VFS | `vfs-core/src/impl/factory.ts::createVFS()` |
| 内核 | `kernel/src/application/kernel.ts::new Kernel()` |
| 能力 | `coreutils/src/runtime/create-coreutils-runtime.ts::createCoreutilsRuntime()` |
| LLM 系统 | `llm-session/src/index.ts::initializeConversationSystem()` |
| 工作区策略 | `app-shell/src/strategies/` |

## 5. TTY / 工具链（能力注入）

```
DurableAgentProgram.tool 调用（tool.call effect）
  → coreutils ToolCallEffectAdapter（assertEffectGrant → resolveCapability）
    → tools 的 buildTool 实例（FileRead/Bash/…）
      → 经 vfs-core IDeviceDriver / VFS 访问实际资源
TTY：TtyEffectAdapter → device-tty（node-pty）
```
