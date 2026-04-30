# 核心集成链

## 链 1：文件操作（VFS 全栈）

```
vfs-ui/VFSUIShell (UI)
  → ISessionEngine (接口, common)
    → VFSModuleEngine (adapter, vfslib)
      → IModuleFS (接口, common)
        → ModuleFS (vfslib, chroot)
          → VFSEngine (vfslib)
            → IStorageBackend (接口, common)
              → IndexedDBBackend / LocalFSBackend (driver)
```

**协作要点：**
- `VFSUIShell` **只**依赖 `ISessionEngine` 接口，不 import `VFSModuleEngine`
- `VFSModuleEngine` 是 `IVFSManager → ISessionEngine` 的适配器，仅此文件做适配
- `BaseModuleService`（vfslib）是所有需要直接 VFS 访问的服务的基类
- 添加新存储后端 = 实现 `IStorageBackend`，在 `createVFS()` 中注入

## 链 2：LLM 消息发送（Chat 全栈）

```
用户输入 → llm-ui/LLMWorkspaceEditor
  → ChatInputView
    → 输入插件链:
      HarnessPlugin    → /sk-<id> Skill 加载
      SlashCommandPlugin → /exec /read /grep 直达工具
      MentionPlugin    → @mention 文件引用
    → SessionManager.sendMessage() (llm-engine)
      → TaskRunner (双路径):
        ├─ Kernel 路径 → llm-kernel/AgentExecutor
        └─ Harness 路径 → llm-harness/AgentLoopExecutor
            → LLMServiceAdapter → device-llm/LLMDeviceDriver → Provider
            → 工具调用 → ToolDeviceDriver → VFS ToolContext (浏览器)
      → HarnessAdapter → OrchestratorEvent → UI 更新
  → LLMSessionEngine (持久化到 VFS .chat 文件)
```

**协作要点：**
- `llm-ui` 不直接调用 LLM API — 通过 `SessionManager` 间接执行
- `llm-harness` 的 `AgentLoopExecutor` 通过 `LLMServiceAdapter` 调用 `device-llm`
- Harness 路径中的文件工具通过 `createVFSToolContext(vfs)` 操作 VFS，替代 `node:fs`
- 两种执行路径（Kernel / Harness）由 `TaskRunner` 统一调度，上层无感知

## 链 3：应用启动（App-Shell 装配）

```
initApp(options) 【唯一装配点】
  │
  ├─ 1. createVFS()              → { manager, config }
  ├─ 2. LLMDeviceDriver 初始化
  ├─ 3. 核心服务 (Settings, AgentService, SessionEngine)
  ├─ 4. createHarness({ llmDriver })
  │     → setVFSContext + syncSkillsToHarness
  ├─ 5. initializeLLMEngine({ agentService, sessionEngine, harness* })
  │     → SessionManager + HarnessAdapter
  ├─ 6. WorkspaceStrategy[] × 5
  ├─ 7. 路由 + 事件绑定
  └─ 8. 初始导航 → MemoryManager (惰性创建)
```

**协作要点：**
- `initApp()` 是**唯一装配点** — 所有跨包具体实现的注入都发生在这里
- 应用的其他部分只依赖 `common` 中的接口，不依赖具体类
- `syncSkillsToHarness()` 桥接 VFS 持久化的 `LLMSkill` 和 harness 内存的 `SkillDefinition`
