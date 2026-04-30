# vfs-ui 组件详情

## VFSUIShell

实现 `ISessionUI<VFSNodeUI, VFSService>`：

```typescript
class VFSUIShell implements ISessionUI<VFSNodeUI, VFSService> {
    constructor(options: VFSUIOptions, engine: ISessionEngine);
    async start(sessionId?): Promise<void>;
    getActiveSession(): VFSNodeUI | null;
    toggleSidebar(): void;
    setNodeWaitingInput(nodeId: string, waiting: boolean): void;
    destroy(): void;
}
```

## VFSService

封装 `ISessionEngine` 的业务逻辑层。节点 CRUD、标签、SRS、资产。

## FileTypeRegistry

```typescript
interface FileTypeDefinition {
    extensions: string[];
    icon: string;
    editorFactory?: EditorFactory;
    contentParser?: (content) => any;
}
```

## VFSUIOptions

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
    showFileExtensions?: boolean;
};
```
