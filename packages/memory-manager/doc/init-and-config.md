# memory-manager 初始化与配置

## 初始化流程

```
constructor(config)
    ├─ 1. Engine 解析 (customEngine 或 vfs+moduleName → VFSModuleEngine)
    ├─ 2. Factory 解析 (editorFactory ?? 默认 MDxEditor)
    ├─ 3. 创建 VFSUIShell → createVFSUI(options, engine)
    ├─ 4. BackgroundBrain (可选) → node:updated → debounce → MDxProcessor
    ├─ 5. connectEditorLifecycle → sidebar 选中 → editor.loadContent()
    └─ 6. start() → engine.init() + vfsUI.start() + openFile()
```

## MemoryManagerConfig

```typescript
interface MemoryManagerConfig {
    container: HTMLElement;
    scopeId?: string;
    vfs?: IVFSManager;
    customEngine?: ISessionEngine;
    moduleName?: string;
    editorFactory?: EditorFactory;
    editorConfig?: { plugins?: any[]; readOnly?: boolean; mentionScope?: string[] };
    fileTypes?: FileTypeDefinition[];
    customEditorResolver?: CustomEditorResolver;
    uiOptions?: SessionUIOptions;
    aiConfig?: { enabled: boolean };
    onNavigate?: (req: NavigationRequest) => Promise<void>;
    onSessionChange?: (sessionId: string) => void;
}
```

## BackgroundBrain

1. 监听 `node:updated` → 2s debounce → 读取文件 → `MDxProcessor` 提取 → 写入元数据
