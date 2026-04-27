# CLAUDE.md — @itookit/vfs-ui

文件树 UI 组件库。提供 `VFSUIShell`（主组件）、`VFSService`（业务逻辑）、mention 提供者、文件类型注册等。

## Commands

```bash
pnpm --filter @itookit/vfs-ui build        # vite build
pnpm --filter @itookit/vfs-ui dev          # vite dev
pnpm --filter @itookit/vfs-ui test         # vitest
pnpm --filter @itookit/vfs-ui test:watch   # vitest --watch
```

## Architecture

```
src/
├── index.ts               ← createVFSUI() 工厂 + 导出
├── shell/
│   ├── VFSUIShell.ts      ← 主组件 (implements ISessionUI)
│   └── Assembler.ts       ← 组装器 (DI 装配)
├── services/
│   ├── VFSService.ts      ← 业务逻辑封装
│   ├── EngineAdapter.ts   ← ISessionEngine 事件 → UI 事件
│   ├── NodeMapper.ts      ← FSNode → VFSNodeUI 映射
│   ├── FileTypeRegistry.ts ← 文件扩展名 → 图标/编辑器工厂
│   └── StatePersistence.ts ← UI 状态持久化 (折叠/选中/滚动)
├── ui/
│   ├── components/
│   │   ├── NodeList/      ← 文件列表 + 渲染器
│   │   ├── FileOutline/   ← 文件大纲
│   │   ├── MoveToModal/   ← 移动文件弹窗
│   │   ├── ContextMenu/   ← 右键菜单
│   │   ├── Footer/        ← 底栏
│   │   └── items/         ← FileItem, DirectoryItem...
│   ├── handlers/          ← DragDrop, Selection, ContextMenu...
│   └── popovers/          ← SettingsPopover, TagEditorPopover
├── contracts/
│   ├── types.ts           ← VFSNodeUI, VFSUIState, UISettings...
│   └── ports.ts           ← IStatePort, ICommandPort, IEventPort...
├── mention/               ← @-mention 提供者
│   ├── FileMentionSource.ts
│   ├── DirectoryMentionSource.ts
│   └── createVFSMentionProviders.ts
├── integrations/
│   └── editor-connector.ts ← connectEditorLifecycle
├── commands/              ← CommandBus + 命令处理器
│   ├── FileCommandHandler.ts
│   ├── BulkCommandHandler.ts
│   ├── NavigationCommandHandler.ts
│   └── ...
├── editors/
│   └── MediaViewerEditor.ts ← 媒体预览 (图片/音频/视频)
└── styles/
```

## 关键组件

### VFSUIShell

主要 UI 门面，实现 `ISessionUI<VFSNodeUI, VFSService>`：

```typescript
class VFSUIShell implements ISessionUI<VFSNodeUI, VFSService> {
    constructor(options: VFSUIOptions, engine: ISessionEngine);
    async start(sessionId?): Promise<void>;
    getActiveSession(): VFSNodeUI | null;
    toggleSidebar(): void;
    destroy(): void;
}
```

### VFSService

封装 `ISessionEngine` 的业务逻辑层。处理节点 CRUD、标签、SRS、资产等操作。

### FileTypeRegistry

文件类型 → 编辑器/图标解析：

```typescript
interface FileTypeDefinition {
    extensions: string[];           // ['.md', '.txt']
    icon: string;                   // 文件图标
    editorFactory?: EditorFactory;  // 自定义编辑器
    contentParser?: (content) => any; // 内容解析器
}
```

### VFSUIOptions

```typescript
type VFSUIOptions = SessionUIOptions & {
    initialState?: Partial<VFSUIState>;
    defaultUiSettings?: Partial<UISettings>;
    defaultFileName?: string;
    defaultFileContent?: string;
    fileTypes?: FileTypeDefinition[];
    defaultEditorFactory: EditorFactory;
    customEditorResolver?: CustomEditorResolver;
    scopeId?: string;
    showFileExtensions?: boolean;  // 外部文件系统显示扩展名
};
```

## Conventions

- `createVFSUI(options, engine)` — 工厂函数，返回 `ISessionUI`
- `connectEditorLifecycle` — 连接 VFS-UI 和编辑器生命周期
- `createVFSMentionProviders(engine, scope)` — 创建 @-mention 源（支持 scope 控制）
- 所有 UI 字符串通过 `t()` 从 `@itookit/common` 导入
- 状态管理使用 `immer` 进行不可变更新
