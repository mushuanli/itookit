# 核心集成链

> 详细架构参见 [architecture.md](./architecture.md)

## VFS 全栈链 (v4.1 path-based)

```
vfs-ui (VFSUIShell)
  → IModuleFS (VFSManager.getEngine())
     → ModuleFS.driver (IFSDriver) → ModuleFS → VFSEngine → IStorageBackend
```

| 步骤 | 组件 | 关键文件 |
|---|---|---|
| 1. 创建 | `createVFS({ rootBackend, modules })` | `stdio/src/factory.ts` |
| 2. 引擎 | `VFSEngine` — resolveStore, mapToSystemNode | `stdio/src/engine/` |
| 3. 管理器 | `VFSManager` — module lifecycle, module:mounted/unmounted | `stdio/src/services/` |
| 4. 模块 | `ModuleFS` (chroot `/` → `/module/<name>/`) | `stdio/src/file-io/` |
| 5. 存储 | `IStorageBackend` (IndexedDB / LocalFS) | `vfsdriver-*/src/` |

## LLM Chat 链

```
用户输入 (ChatInput.send)
  → SendMessageCommand
    → llm-engine SessionManager.sendMessage()
      → TaskRunner.submit() → processQueue()
        → 编译为单节点 AgentTask Flow → TaskGraphReconciler.run()
          → AgentTaskExecutor → executeV3Agent()
            → ExecutorRegistry.get(mode).run(ctx)
              → drive(gen, actor, ctx)    // 协程宿主
                → ctx.llm.chatStream()    // ILLMService（唯一 LLM 入口）
```

| 步骤 | 组件 | 关键文件 |
|---|---|---|
| 输入 | `ChatInput.triggerSend()` | `llm-ui/src/components/input/ChatInputView.ts` |
| 路由 | `SlashCommandRouter` / `SendMessageCommand` | `llm-ui/src/shell/`, `commands/` |
| 会话 | `SessionManager.sendMessage()` | `llm-engine/src/session/session-manager.ts` |
| 任务 | `TaskRunner.submit()` → `processQueue()` → `executeV3ChatTask()` | `llm-engine/src/session/task-runner.ts` |
| 调度 | `TaskGraphReconciler.run()` → `AgentTaskExecutor` | `llm-engine/src/task-graph/reconciler.ts` |
| 执行 | `ExecutorRegistry.get(mode).run(ctx)` | `llm-engine/src/core/executor-registry.ts` |
| LLM | `ILLMService.chatStream()` → Provider (OpenAI/Anthropic/Gemini) | `device-llm/src/` |

## App 装配链

```
apps/web-app (entry)
  → initApp() (app-shell)
    → createVFS() → createHarness() → initializeLLMEngine() → WorkspaceStrategy
```

| 步骤 | 关键文件 |
|---|---|
| 入口 | `apps/web-app/src/main.ts` |
| 启动 | `app-shell/src/bootstrap.ts::initApp()` |
| VFS | `stdio/src/factory.ts::createVFS()` |
| Harness | `llm-harness/src/factory.ts::createHarness()` |
| LLM引擎 | `llm-engine/src/index.ts::initializeLLMEngine()` |
| 工作区 | `app-shell/src/strategies/` (5 种策略) |
| 模块配置 | `apps/web-app/src/config/modules.ts` (WORKSPACES) |

## LLM 引擎装配 (initializeLLMEngine)

```
1. VFSAgentService.init() + ChatEngine.init()
2. ExecutorRegistry 注册 chat + loop(lite) executor（默认 mode='chat'）
3. SessionManager 创建（注入 engine + agentService + runtimeFactory）
4. ILLMService 注入 SessionManager
5. TaskGraph 装配：
   - createBuiltinTaskExecutorRegistry()（6 个非-agent executor）
   - HarnessContributionRegistry + BUILTIN_TASK_KIND_DESCRIPTORS
   - VFS stores ×5（run / event / artifact / contextSnapshot / state）
   - TaskGraphReconciler + TaskGraphCommandService → CommandBus
6. Plugin system:
   - ExtensionRegistry 注册 session / vcs / history 插件 → 激活
7. 返回 { sessionManager, commandBus, taskGraph }
```
