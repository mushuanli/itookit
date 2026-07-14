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
| 1. 创建 | `createVFS({ rootBackend, modules })` | `vfslib/src/factory.ts` |
| 2. 引擎 | `VFSEngine` — resolveStore, mapToSystemNode | `vfslib/src/engine/` |
| 3. 管理器 | `VFSManager` — module lifecycle, module:mounted/unmounted | `vfslib/src/services/` |
| 4. 模块 | `ModuleFS` (chroot `/` → `/module/<name>/`) | `vfslib/src/file-io/` |
| 5. 存储 | `IStorageBackend` (IndexedDB / LocalFS) | `vfsdriver-*/src/` |

## LLM Chat 链

```
用户输入 (ChatInput.send)
  → SendMessageCommand
    → llm-engine SessionManager.chat()
      → TaskRunner.execute()
        → [kernel 路径] ILLMService.chatStream() 直连（S6c: 替代 AgentExecutor）
        → [harness 路径] AgentLoopExecutor (多轮+工具)
          → LLMServiceAdapter → Provider (device-llm)
```

| 步骤 | 组件 | 关键文件 |
|---|---|---|
| 输入 | `ChatInput.triggerSend()` | `llm-ui/src/components/input/ChatInputView.ts` |
| 路由 | `SlashCommandRouter` / `SendMessageCommand` | `llm-ui/src/shell/`, `commands/` |
| 会话 | `SessionManager.chat()` | `llm-engine/src/session/` |
| 任务 | `TaskRunner.execute()` — kernal vs harness path | `llm-engine/src/session/task-runner.ts` |
| 执行 | `AgentLoopExecutor.run()` | `llm-harness/src/executor/agent-loop-executor.ts` |
| LLM | `LLMDriver.chat()` → Provider (OpenAI/Anthropic/Gemini) | `device-llm/src/core/driver.ts` |

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
| VFS | `vfslib/src/factory.ts::createVFS()` |
| Harness | `llm-harness/src/factory.ts::createHarness()` |
| LLM引擎 | `llm-engine/src/index.ts::initializeLLMEngine()` |
| 工作区 | `app-shell/src/strategies/` (5 种策略) |
| 模块配置 | `apps/web-app/src/config/modules.ts` (WORKSPACES) |

## Harness 5 步组装 (createHarness)

```
1. LLMServiceAdapter(llmDriver)     // IDeviceDriver → ILLMService
2. ToolDeviceDriver(BUILTIN_TOOLS)  // 加载内置工具
3. SkillDeviceDriver()              // Skill 注册与管理
4. AgentDeviceDriver()              // agent runtime
5. init() + syncSkillsToHarness()   // 同步 VFS skill → harness
```
