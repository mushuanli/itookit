# 跨包开发模式

## 新增跨包功能的标准流程

| 步骤 | 涉及包 | 操作 |
|---|---|---|
| 1. 定义类型 | `common` | 添加接口/类型 |
| 2. 后端逻辑 | `device-llm` / `vfslib` | 实现新能力 |
| 3. 运行时支持 | `llm-harness` | 注册工具/Skill loader |
| 4. 服务对接 | `llm-engine` | 持久化需求处理 |
| 5. UI | `llm-ui` / `vfs-ui` | 编辑器/表单 |
| 6. 装配 | `app-shell` | 通常无需改动 |
| 7. i18n | `common` | `zh-CN.ts` + `en.ts` |

## 新增内置 Agent 工具

1. `llm-harness/tools/` — 创建文件（meta + definition + handler）
2. `llm-harness/tools/index.ts` — 加入 `BUILTIN_TOOLS` 数组

## 新增 VFS 能力子接口

1. `common` — 定义新接口（如 `IXxxOperations`）
2. `vfslib` — 在 `ModuleFS` 实现，在 `capabilities` 声明
3. `vfs-ui` — 通过 `VFSService` 暴露给 UI

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

### 服务注入模式

```typescript
// app-shell/bootstrap.ts — 唯一的装配点
const harness = await createHarness({ llmDriver });
await initializeLLMEngine({
    harnessRuntime:      harness.runtime,       // IAgentRuntime
    harnessSkillService: harness.skillService,   // ISkillService
    harnessToolService:  harness.toolService,    // IToolService
});
```

## 浏览器 vs Node 差异

| 差异点 | 浏览器 | Node/Electron | 切换机制 |
|---|---|---|---|
| 存储后端 | `vfsdriver-indexeddb` | `vfsdriver-fs` | `createVFS()` 的 `rootBackend` 参数 |
| Shell 工具 | 不可用 | `NodeShellRunner` | 仅在 Node 环境 import |
| TTY 设备 | 无 ttyDriver | `NodeTTYDriver` | `createHarness({ ttyDriver? })` |
| 文件工具 | 通过 `ToolVFSContext` | `node:fs` | `ToolDeviceDriver.setVFSContext()` |

## 测试策略

| 层级 | 测试重点 | 模拟对象 |
|---|---|---|
| `common` | 类型检查、工具函数 | 无需 mock |
| `vfslib` | VFS 操作正确性 | `MemoryBackend` |
| `device-llm` | Provider 适配 | Mock HTTP |
| `llm-harness` | Agent 循环、工具执行 | Mock ILLMService |
| `llm-engine` | 会话管理、持久化 | Mock VFS |
| UI 包 | 组件测试 | Mock ISessionEngine |
