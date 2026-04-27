# CLAUDE.md — @itookit/memory-manager

工作区顶层容器。粘合 VFS-UI (sidebar) + MDx Editor + BackgroundBrain，管理一个工作区的完整生命周期。

peerDependencies: `@itookit/common`, `@itookit/mdxeditor`, `@itookit/vfs-ui`, `@itookit/vfslib`

## Commands

```bash
pnpm --filter @itookit/memory-manager build   # vite build
pnpm --filter @itookit/memory-manager dev     # vite dev
```

## Architecture

```
src/
├── index.ts               ← 公共 API 出口
├── types.ts               ← MemoryManagerConfig 类型
├── core/
│   ├── MemoryManager.ts   ← 主类 — 粘合 VFS-UI + Editor + Brain
│   ├── BackgroundBrain.ts ← AI 后台处理 (Mention/Tag/Reference 提取)
│   └── Layout.ts          ← DOM 布局管理 (sidebar + editor + resizer)
└── styles/
```

## MemoryManager

```typescript
class MemoryManager {
    constructor(config: MemoryManagerConfig);

    // 生命周期
    async start(initialResourceId?: string): Promise<void>;

    // 文件操作
    async openFile(nodeId: string): Promise<void>;
    async createAndOpenFile(opts: {
        title?: string;
        content?: string;
        parentId?: string;
    }): Promise<string>;

    // 查询
    getActiveSessionId(): string | null;

    // 清理
    destroy(): void;
}
```

### 初始化流程

```
constructor(config)
    │
    ├─ 1. Engine 解析
    │   ├─ config.customEngine  → 直接使用
    │   └─ config.vfs + moduleName → new VFSModuleEngine()
    │
    ├─ 2. Factory 解析
    │   └─ config.editorFactory ?? createMDxEditor (默认)
    │
    ├─ 3. 创建 VFSUIShell (sidebar)
    │   └─ createVFSUI(options, engine)
    │       ├─ 注入 enhancedEditorFactory (wires VFS mention providers)
    │       └─ 注入 fileTypes + customEditorResolver
    │
    ├─ 4. BackgroundBrain (可选)
    │   └─ 监听 node:updated → 2s debounce → MDxProcessor → write metadata
    │
    ├─ 5. connectEditorLifecycle
    │   └─ sidebar 选中 → editor.loadContent()
    │
    └─ 6. start()
        ├─ await engine.init()
        ├─ await vfsUI.start()
        └─ 如果 initialResourceId → openFile()
```

### start() → openFile() 流程

```
start(resourceId)
  → engine.init()
  → vfsUI.start(resourceId)
      → engine.getNode(resourceId)
      → factory(container, options) → editor
      → editor.init(container, content)
```

## MemoryManagerConfig

```typescript
interface MemoryManagerConfig {
    container: HTMLElement;           // DOM 容器
    scopeId?: string;                 // 实例隔离标识
    vfs?: IVFSManager;               // VFS 实例
    customEngine?: ISessionEngine;   // 自定义后端
    moduleName?: string;             // VFS 模块名
    editorFactory?: EditorFactory;   // 编辑器工厂
    editorConfig?: {
        plugins?: any[];
        readOnly?: boolean;
        mentionScope?: string[];
    };
    fileTypes?: FileTypeDefinition[];
    customEditorResolver?: CustomEditorResolver;
    uiOptions?: SessionUIOptions;
    aiConfig?: { enabled: boolean };
    onNavigate?: (req: NavigationRequest) => Promise<void>;
    onSessionChange?: (sessionId: string) => void;
}
```

## BackgroundBrain

AI 后台处理器，可选启用：

1. 监听 `node:updated` 事件
2. 2 秒 debounce
3. 读取文件内容
4. 调用 `MDxProcessor` 提取 mentions/tags/references
5. 将结果写入文件元数据 (`_ai_last_scan`, `_ai_processed`)
6. 通过比较时间戳防止无限循环

## Conventions

- `MemoryManager` 是工作区的唯一入口 — 一个实例 = 一个工作区 Tab
- 如果提供 `vfs` + `moduleName`，自动创建 `VFSModuleEngine`
- 每个 `editorConfig.plugins` 中的插件传递给 MDxEditor
- `mentionScope` 控制 @-mention 的搜索范围（`['*']` = 全局）
