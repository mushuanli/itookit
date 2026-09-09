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
