# CLAUDE.md — @itookit/app-shell

应用启动引导 + 路由 + 策略装配。`initApp()` 是唯一顶层初始化函数，将所有 `@itookit/*` 包装配为完整的应用。

peerDependencies: 所有 `@itookit/*` 包

## Commands

```bash
pnpm --filter @itookit/app-shell test       # vitest
pnpm --filter @itookit/app-shell test:watch # vitest --watch
```

## Architecture

```
src/
├── index.ts              ← initApp() + AppOptions/AppHandle 类型导出
├── bootstrap.ts          ← initApp() 主函数（~580 行）
├── types.ts              ← AppOptions, AppHandle, WorkspaceConfig...
├── strategies/
│   ├── types.ts          ← WorkspaceStrategy 接口
│   ├── standard.ts       ← StandardWorkspaceStrategy (MDxEditor + VFSModuleEngine)
│   ├── settings.ts       ← SettingsWorkspaceStrategy (ISettingsWidget)
│   └── chat.ts           ← ChatWorkspaceStrategy (LLMFactory + LLMSessionEngine)
└── config/
    └── file-registry.ts  ← FILE_REGISTRY (文件类型→编辑器映射)
```

## initApp() 启动流程（9 步）

```typescript
const app: AppHandle = await initApp({
    backend: IStorageBackend,         // IndexedDB / SQLite+FS
    workspaces: WorkspaceConfig[],    // 工作区列表
    defaultSlug?: string,
    routeAliases?: Record<string, string>,
    onProgress?: (msg: string) => void,
});
```

```
1. createVFS({ rootBackend, modules })
   → VFSEngine + VFSManager + ConfigService
   → 注册 /dev/null, /dev/zero, /dev/random
   → 挂载业务模块

2. LLMDeviceDriver 初始化
   → new LLMDeviceDriver(vfs) → init()
   → vfs.devices.register()
   → createDeviceNodes()
   → setKernelDeviceManager()

3. 核心服务
   → createSettingsModule(vfs)
   → new VFSAgentService(vfs, llmDriver)
   → new LLMSessionEngine(vfs)

4. createHarness({ llmDriver })
   → 装配 AgentLoopExecutor + 内置工具 + Skill
   → setVFSContext (浏览器 VFS 桥接)
   → syncSkillsToHarness (VFS → harness 同步)

5. initializeLLMEngine({ agentService, sessionEngine, harness* })
   → Kernel + SessionManager + HarnessAdapter

6. 策略工厂
   → StandardWorkspaceStrategy × 2
   → ChatWorkspaceStrategy
   → SettingsWorkspaceStrategy × 2
   → SkillsEditorFactory

7. 路由系统
   → routeMap: slug → elementId
   → hash routing: #/slug/resourceId
   → popstate + NAVIGATION_EVENTS 监听

8. 初始导航
   → 解析 location.hash
   → loadWorkspace → MemoryManager

9. 返回 AppHandle { vfs, navigate(), addWorkspace() }
```

## 工作区策略模式

```typescript
interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine?(moduleName: string): ISessionEngine;
}

// 五种策略:
StandardWorkspaceStrategy    → MDxEditor + VFSModuleEngine (standard / agent)
ChatWorkspaceStrategy        → LLMWorkspaceEditor + LLMSessionEngine
SettingsWorkspaceStrategy    → SettingsEditor + SettingsEngine/SkillsEngine (settings / skills)
```

## WorkspaceConfig

```typescript
interface WorkspaceConfig {
    elementId: string;         // DOM 容器 ID
    slug: string;              // URL hash 标识
    moduleName: string;        // VFS 模块名
    type: WorkspaceType;       // 'standard' | 'chat' | 'agent' | 'settings' | 'skills'
    title: string;
    icon?: string;
    supportedFileTypes?: string[];  // 引用 FILE_REGISTRY 的 key
    mentionAble?: boolean;     // 是否出现在 @mention 结果中
    mentionScope?: string[];   // mention 搜索范围
    isSystem?: boolean;        // 系统模块 — 不在 sync 中
    isProtected?: boolean;
    syncEnabled?: boolean;
    plugins?: any[];           // MDxEditor 插件
    readOnly?: boolean;
    showFileExtensions?: boolean;
    defaultContent?: string;
}
```

## FILE_REGISTRY

```typescript
const FILE_REGISTRY: Record<string, AppFileTypeConfig> = {
    chat:    { extension: '.chat', icon: '💬', editorType: 'chat', ... },
    agent:   { extension: '.agent.yml', icon: '🤖', editorType: 'agent', ... },
    note:    { extension: '.md', icon: '📄', editorType: 'standard', ... },
    // ...
};
```

## VFS ToolContext 桥接

浏览器环境中 `node:fs` 不可用。`createVFSToolContext(vfsManager)` 将 VFS 暴露为 `ToolVFSContext`：

```typescript
interface ToolVFSContext {
    readFile(path): Promise<string>;
    writeFile(path, content): Promise<void>;
    listFiles(dir?): Promise<string[]>;
}
```

Harness 文件工具自动 fallback 到此上下文。

## LLMSkill → SkillDefinition 同步

`syncSkillsToHarness()` 在启动和每次 `llmDriver.onChange()` 时，将 VFS 持久化的 `LLMSkill` 同步为 harness 运行时的 `SkillDefinition`。包含增删改的全量同步。

## Conventions

- `initApp()` 是唯一修改入口 — 不要在外部模块直接装配 VFS/Harness/LLM
- `WorkspaceConfig.type` 决定使用哪个 Strategy
- `loadWorkspace()` 包含去重 — 并发加载同一工作区共享同一个 Promise
- 路由使用 `history.pushState` / `replaceState`，监听 `popstate`
