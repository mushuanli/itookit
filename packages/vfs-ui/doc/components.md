# vfs-ui 组件详情

## VFSUIShell

继承 `ISessionUI<VFSNodeUI, VFSService, PublicEventMap>`（`@itookit/ui-common`）：

```typescript
class VFSUIShell extends ISessionUI<VFSNodeUI, VFSService, PublicEventMap> {
    constructor(options: VFSUIShellOptions, engine: IFileSystem);
    async start(): Promise<VFSNodeUI | undefined>;
    getActiveSession(): VFSNodeUI | undefined;
    toggleSidebar(): void;
    setNodeWaitingInput(nodeId: string, waiting: boolean): void;
    destroy(): void;
}
```

工厂 `createVFSUI(options, engine)` 返回 `ISessionUI<VFSNodeUI, VFSService>`（`VFSUIShell` 实例）。

`fileCreation.resolveParent(parentPath)` 可将虚拟容器映射到可创建目录；省略时沿用所选目录。内联创建在放置输入框前解析，直接创建命令也解析，因此回调应幂等；返回 `null` 表示根级，不授予额外写权限。该映射同时用于文件和目录创建，不改变导入、复制及后端权限检查。

## VFSService

写操作服务，实现 `IDataOperationPort`：`createFile` / `createFiles` / `createDirectory` / `renameItem` / `updateMultipleItemsTags`。构造依赖 `{ engine: IFileSystem, newFileContent?, defaultExtension? }`。

## FileTypeRegistry

实现 `IFileTypePort`，按扩展名解析图标、编辑器工厂与内容解析器：

```typescript
interface FileTypeDefinition {
    extensions: string[];
    mimeTypes?: string[];
    icon?: string;
    editorFactory?: EditorFactory;
    contentParser?: ContentParser;
    duplicateTransformer?: DuplicateTransformer;
}
```

## VFSUIOptions

```typescript
type VFSUIOptions = SessionUIOptions<VFSNodeUI> & {
    initialState?: Partial<VFSUIState>;
    defaultUiSettings?: Partial<UISettings>;
    fileTypes?: FileTypeDefinition[];
    defaultEditorFactory: EditorFactory;
    customEditorResolver?: CustomEditorResolver;
    scopeId?: string;
};
```

`VFSUIShell` 构造函数接受 `VFSUIShellOptions`（同样 extends `SessionUIOptions<VFSNodeUI>`），额外含 `defaultExtension` / `showFileExtensions` / `searchFilter` / `directoryAction` / `primaryAction` 等，其中 `defaultEditorFactory` 可选。
