# app-shell 启动 + 配置详情

## initApp() 启动流程（9 步）

```typescript
const app: AppHandle = await initApp({
    backend: IStorageBackend,
    workspaces: WorkspaceConfig[],
    defaultSlug?: string,
    routeAliases?: Record<string, string>,
    onProgress?: (msg: string) => void,
});
```

```
1. createVFS → VFSEngine + VFSManager + ConfigService + 注册内置设备 + 挂载模块
2. LLMDeviceDriver 初始化 → vfs.devices.register() + setKernelDeviceManager()
3. 核心服务 → createSettingsModule + VFSAgentService + LLMSessionEngine
4. createHarness → 装配 AgentLoopExecutor + 工具 + Skill + VFS 桥接
5. initializeLLMEngine → Kernel + SessionManager + HarnessAdapter
6. 策略工厂 → Standard×2 + Chat + Settings×2
7. 路由系统 → routeMap + hash routing + popstate
8. 初始导航 → 解析 location.hash → loadWorkspace → MemoryManager
9. 返回 AppHandle { vfs, navigate(), addWorkspace() }
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
    supportedFileTypes?: string[];
    mentionAble?: boolean;
    mentionScope?: string[];
    isSystem?: boolean;
    isProtected?: boolean;
    syncEnabled?: boolean;
    plugins?: any[];
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
};
```

## VFS ToolContext

浏览器环境中 `node:fs` 不可用。`createVFSToolContext(vfsManager)` 将 VFS 暴露为 `ToolVFSContext`：

```typescript
interface ToolVFSContext {
    readFile(path): Promise<string>;
    writeFile(path, content): Promise<void>;
    listFiles(dir?): Promise<string[]>;
}
```

## LLMSkill → SkillDefinition 同步

`syncSkillsToHarness()` 在启动和 `llmDriver.onChange()` 时全量同步。
