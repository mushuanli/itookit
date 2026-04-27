# CLAUDE.md — packages/ 模块协作指南

本文件描述 `packages/` 下 14 个模块之间的协作关系、集成点和跨包开发规范。
各模块自身的架构和命令详见 `packages/<pkg>/CLAUDE.md`。

## 模块分层

```
┌──────────────────────────────────────────────────┐
│  apps/web-app                     入口 + 配置     │
├──────────────────────────────────────────────────┤
│  app-shell                 引导 + 路由 + 装配    │
├──────────────┬──────────────┬────────────────────┤
│ memory-mgr   │  llm-ui      │  vfs-ui   mdx      │  UI 层
├──────────────┼──────────────┼────────────────────┤
│ llm-engine   │  llm-harness │  app-settings      │  业务层
├──────────────┼──────────────┼────────────────────┤
│ llm-kernel   │  device-llm  │  vfslib            │  引擎层
├──────────────┴──────────────┴────────────────────┤
│  vfsdriver-*                         存储驱动     │
├──────────────────────────────────────────────────┤
│  common                    接口 + 类型 + i18n     │
└──────────────────────────────────────────────────┘
```

### 依赖铁律

| 规则 | 说明 |
|---|---|
| 上层可依赖下层 | UI 层 → 业务层 → 引擎层 → `common` |
| 下层永不知上层 | `vfslib` 不 import `llm-engine` |
| 跨层通过接口 | 具体实现通过 `app-shell` 注入，其他包只依赖 `@itookit/common` 的接口类型 |

## 核心集成链

### 链 1：文件操作（VFS 全栈）

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
- `BaseModuleService`（vfslib）是所有需要直接 VFS 访问的服务的基类，提供 `readJson`/`writeJson`/`ensureDirectory`
- 添加新存储后端 = 实现 `IStorageBackend`，在 `createVFS()` 中注入，不影响任何上层代码

### 链 2：LLM 消息发送（Chat 全栈）

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
- `llm-harness` 的 `AgentLoopExecutor` 通过 `LLMServiceAdapter` 调用 `device-llm` — 解耦循环逻辑和通信协议
- Harness 路径中的文件工具通过 `createVFSToolContext(vfs)` 操作 VFS，替代 `node:fs`
- 两种执行路径（Kernel / Harness）由 `TaskRunner` 统一调度，上层无感知

### 链 3：应用启动（App-Shell 装配）

```
initApp(options) 【唯一装配点】
  │
  ├─ 1. createVFS()              → { manager, config }
  ├─ 2. new LLMDeviceDriver(vfs) → llmDriver
  ├─ 3. 核心服务:
  │     ├─ createSettingsModule(vfs)
  │     ├─ new VFSAgentService(vfs, llmDriver)
  │     └─ new LLMSessionEngine(vfs)
  │
  ├─ 4. createHarness({ llmDriver })
  │     → HarnessInstance { runtime, toolService, skillService... }
  │     → setVFSContext          ← 浏览器 VFS 桥接
  │     → syncSkillsToHarness    ← VFS LLMSkill → harness SkillDefinition
  │
  ├─ 5. initializeLLMEngine({ agentService, sessionEngine, harness* })
  │     → SessionManager + HarnessAdapter
  │
  ├─ 6. WorkspaceStrategy[]      ← 5 种策略
  ├─ 7. 路由 + 事件绑定
  └─ 8. 初始导航 → MemoryManager (惰性创建)
```

**协作要点：**
- `initApp()` 是**唯一装配点** — 所有跨包具体实现的注入都发生在这里
- 应用的其他部分（UI、Service）只依赖 `common` 中的接口，不依赖具体类
- `syncSkillsToHarness()` 桥接 VFS 持久化的 `LLMSkill` 和 harness 内存的 `SkillDefinition` — 这两套体系通过此函数保持同步

## 跨包接口契约（common 定义）

### VFS 体系

| 接口 | 所在文件 | 消费者 | 实现者 |
|---|---|---|---|
| `IVFSManager` | `common/interfaces/fs/services/vfs-manager.ts` | `app-shell`, 各 Service | `vfslib/VFSManager` |
| `IModuleFS` | `common/interfaces/fs/services/module-fs.ts` | 所有需要文件操作的 Service | `vfslib/ModuleFS` |
| `ISessionEngine` | `common/interfaces/ISessionEngine.ts` | `vfs-ui`, `memory-manager` | `vfslib/VFSModuleEngine`, `llm-engine/LLMSessionEngine`, `app-settings/SkillsEngine` |
| `IStorageBackend` | `common/interfaces/fs/storage/backend.ts` | `vfslib/VFSEngine` | `vfsdriver-indexeddb`, `vfsdriver-fs` |
| `IConfigService` | `common/interfaces/fs/services/config-service.ts` | `app-settings`, 各 Service | `vfslib/ConfigService` |

### LLM 体系

| 接口 | 所在文件 | 消费者 | 实现者 |
|---|---|---|---|
| `IAgentRuntime` | `common/interfaces/agent/agent-service.ts` | `llm-engine`, `llm-ui` | `llm-harness/AgentLoopExecutor` |
| `ILLMService` | `common/interfaces/llm/llm-service.ts` | `llm-harness` | `llm-harness/LLMServiceAdapter` |
| `IDeviceDriver` | `common/interfaces/fs/device/device.ts` | `vfslib` (VFS 设备树) | `device-llm/LLMDeviceDriver` |
| `IToolService` | `common/interfaces/tools/tool-service.ts` | `llm-harness`, `llm-engine` | `llm-harness/ToolDeviceDriver` |
| `ISkillService` | `common/interfaces/skills/skill-service.ts` | `llm-harness`, `llm-engine` | `llm-harness/SkillDeviceDriver` |
| `ILLMSessionEngine` | `llm-engine/persistence/types.ts` | `llm-ui`, `llm-engine` | `llm-engine/LLMSessionEngine` |

### UI 体系

| 接口 | 所在文件 | 消费者 | 实现者 |
|---|---|---|---|
| `ISessionUI` | `common/interfaces/ISessionUI.ts` | `memory-manager` | `vfs-ui/VFSUIShell` |
| `IEditor` | `common/interfaces/IEditor.ts` | `vfs-ui` (editor-connector) | `mdx/MDxEditor`, `llm-ui/LLMWorkspaceEditor` |
| `EditorFactory` | `common/interfaces/IEditorFactory.ts` | `memory-manager` | 各编辑器的工厂函数 |
| `ISettingsWidget` | `common/interfaces/ISettingsWidget.ts` | `app-settings/SettingsEngine` | 各 Settings Editor |

## 跨包事件流

### Agent 事件 → UI 更新

```
llm-harness/AgentLoopExecutor
  → emit agent:stream:content { delta }
    → llm-engine/HarnessAdapter (单例)
      → node_update { field: 'output', nodeId }
        → llm-ui/StreamController
          → HistoryView 增量更新
```

### VFS 事件 → UI 刷新

```
vfslib/VFSEngine
  → emit node:created { nodeId, path }
    → vfslib/VFSManager
      → emit node:created { nodeId, path, moduleId }
        → vfs-ui/EngineAdapter
          → VFSUIShell → NodeList 刷新
```

### VFS 变更 → LLMSkill 同步

```
device-llm/LLMDeviceDriver
  → onChange() (用户编辑了 Skill)
    → app-shell/syncSkillsToHarness()
      → 读取 VFS 中的 LLMSkill[]
      → llmSkillToSkillDef() 转换
      → harness.skillService.saveSkill() / deleteSkill()
```

## 跨包开发模式

### 新增跨包功能的标准流程

以添加一个新的 Skill 类型为例：

| 步骤 | 涉及包 | 操作 |
|---|---|---|
| 1. 定义类型 | `common` | 在 `skill-types.ts` 添加新 `SkillType` |
| 2. 后端逻辑 | `device-llm` | 在 `LLMDeviceDriver` 处理新类型的 ioctl |
| 3. 运行时支持 | `llm-harness` | 在 `SkillDeviceDriver` 注册新类型的 loader |
| 4. 服务对接 | `llm-engine` | 如有新的持久化需求，在 `VFSAgentService` 处理 |
| 5. Settings UI | `llm-ui` | 在 `SkillSettingsEditor` 添加新类型编辑表单 |
| 6. 装配 | `app-shell` | 无需改动（接口注入已到位） |
| 7. i18n | `common` | `zh-CN.ts` + `en.ts` 添加新字符串 |

### 新增 VFS 能力子接口的标准流程

1. `common` — 定义新接口（如 `IXxxOperations`）
2. `vfslib` — 在 `ModuleFS` 实现，在 `capabilities` 声明
3. `vfs-ui` — 通过 `VFSService` 暴露给 UI

### 新增内置 Agent 工具的标准流程

1. `common` — 如需新 ToolMeta 字段
2. `llm-harness/tools/` — 创建工具文件（meta + definition + handler）
3. `llm-harness/tools/index.ts` — 加入 `BUILTIN_TOOLS` 数组

## 模块隔离与边界

### 严格单向依赖

```
common ← vfslib ← { vfs-ui, llm-engine }
common ← device-llm ← { llm-harness, llm-engine, llm-ui }
common ← llm-kernel ← llm-engine
common ← mdx ← { memory-manager, llm-ui }
```

### 关键边界规则

| 规则 | 原因 |
|---|---|
| `llm-harness` 不依赖 `llm-engine` | 避免循环：engine 使用 harness 的 runtime |
| `vfs-ui` 不依赖 `vfslib` 具体类 | 通过 `ISessionEngine` 接口通信 |
| `llm-ui` 不依赖 `llm-harness` 具体类 | 通过 `IAgentRuntime` / `IToolService` / `ISkillService` 接口 |
| `memory-manager` 不直接依赖任何引擎 | 通过 `ISessionEngine` + `EditorFactory` 注入 |
| `app-settings` peer 依赖其他包 | 不硬 import，由上层装配时提供实例 |

### 服务注入模式（以 harness ↔ engine 为例）

```typescript
// app-shell/bootstrap.ts — 唯一的装配点
const harness = await createHarness({ llmDriver });
await initializeLLMEngine({
    harnessRuntime:      harness.runtime,       // IAgentRuntime
    harnessSkillService: harness.skillService,   // ISkillService
    harnessToolService:  harness.toolService,    // IToolService
});
// llm-engine 通过接口使用 harness 能力，
// 双方都只依赖 @itookit/common 的接口定义
```

## 双 Skill 体系同步

系统中存在两套独立的 Skill 存储体系，必须在 `app-shell` 中保持同步：

```
LLMSkill (VFS 持久化, device-llm)
  ├─ 位置: __config:/llm/.skills/<id>.skill.yml
  ├─ 内容: id, name, type, enabled, instructions, endpoint, command...
  ├─ 管理者: LLMDeviceDriver (通过 ioctl CRUD)
  └─ 变更通知: llmDriver.onChange()

        ↓ syncSkillsToHarness() 转换 ↓

SkillDefinition (运行时内存, llm-harness)
  ├─ 位置: SkillDeviceDriver 内存 Map
  ├─ 内容: id, name, type, enabled, instructions, tools[], triggerPatterns, autoLoad...
  ├─ 管理者: SkillDeviceDriver (loadSkill / unloadSkill)
  └─ 使用: ContextManager.buildSystemPrompt() 注入 P2/P3/P4
```

**同步触发时机：**
1. `initApp()` 启动时 — 全量同步
2. `llmDriver.onChange()` — 增量同步（用户增删改 Skill）

**System Prompt 注入归属：** `ContextManager` 独占，`AgentResolver` 不注入。确保：
- 无 harness 时（Kernel 路径）→ system prompt 无 Skill 内容
- 有 harness 时（Harness 路径）→ `ContextManager` 统一管理，单一注入点

## 浏览器 vs Node 差异处理

| 差异点 | 浏览器行为 | Node/Electron 行为 | 切换机制 |
|---|---|---|---|
| 存储后端 | `vfsdriver-indexeddb` | `vfsdriver-fs` | `createVFS()` 的 `rootBackend` 参数 |
| Shell 工具 | 不可用（无害降级） | `NodeShellRunner` | `NodeShellRunner` 仅在 Node 环境 import |
| TTY 设备 | 无 ttyDriver 注入 | `NodeTTYDriver` | `createHarness({ ttyDriver? })` |
| 文件工具 | 通过 `ToolVFSContext` 操作 VFS | 通过 `node:fs` | `ToolDeviceDriver.setVFSContext()` |

## 测试策略

| 层级 | 测试重点 | 模拟对象 |
|---|---|---|
| `common` | 类型检查、工具函数 | 无需 mock |
| `vfslib` | VFS 操作正确性 | `MemoryBackend`（内存后端） |
| `device-llm` | Provider 适配、消息格式 | Mock HTTP |
| `llm-kernel` | Executor/Orchestrator 逻辑 | Mock 外部依赖 |
| `llm-harness` | Agent 循环、工具执行 | Mock ILLMService |
| `llm-engine` | 会话管理、持久化 | Mock VFS |
| UI 包 | 组件测试 | Mock ISessionEngine |

### 关键测试文件

```
packages/vfslib/src/__tests__/    ← 最完整的测试套件
  ├── 04-tag-ops.test.ts         ← 标签操作测试
  ├── 01-basic-ops.test.ts       ← 基本文件操作
  └── ...
```

## 关键文件快速索引

| 场景 | 查找 |
|---|---|
| 理解某个接口 | `packages/common/src/interfaces/` |
| 理解 VFS 如何工作 | `packages/vfslib/src/engine/vfs-engine.ts` → `services/module-fs.ts` |
| 理解 Agent 循环 | `packages/llm-harness/src/executor/agent-loop-executor.ts` |
| 理解 Chat 持久化 | `packages/llm-engine/src/persistence/session-engine.ts` |
| 理解启动流程 | `packages/app-shell/src/bootstrap.ts` |
| 理解 Skill 系统 | `packages/llm-harness/src/drivers/skill-device-driver.ts` + `app-shell/bootstrap.ts` syncSkillsToHarness |
| 理解 Mission 编排 | `packages/llm-engine/src/mission/mission-scheduler.ts` |
| 添加新工作区 | `apps/web-app/src/config/modules.ts` → WORKSPACES |
| 添加文件类型 | `packages/app-shell/src/config/file-registry.ts` → FILE_REGISTRY |
