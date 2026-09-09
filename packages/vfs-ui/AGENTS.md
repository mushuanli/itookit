# @itookit/vfs-ui

文件树 UI — `VFSUIShell`、`VFSService`、mention 提供者、文件类型注册。

## 命令

```bash
pnpm --filter @itookit/vfs-ui build        # vite build
pnpm --filter @itookit/vfs-ui dev          # vite build --watch
pnpm --filter @itookit/vfs-ui test         # vitest run
```

## 结构

```
src/
├── shell/          ← VFSUIShell (ISessionUI), Assembler (DI)
├── services/       ← VFSService, VFSStore, EngineAdapter, NodeMapper,
│                     FileTypeRegistry, IFileTypeRegistry, StatePersistence
├── ui/             ← NodeList, FileOutline, MoveToModal, TagEditor 及 items/handlers/popovers
├── contracts/      ← types (VFSNodeUI/VFSUIState/UISettings), ports, commands, events
├── interaction/    ← CommandBus, Coordinator, EventBus, handlers/(File/Bulk/Navigation/
│                     Selection/UI/Import/Export/CustomMenu CommandHandler)
├── integrations/   ← editor-connector (VFS-UI ↔ Editor 生命周期)
├── mention/        ← FileMentionSource, DirectoryMentionSource, EngineTagSource,
│                     createVFSMentionProviders
├── editors/        ← MediaViewerEditor
└── utils/          ← helpers, parser, delete-guard, delete-error, adapter-debug
```

## 约定

- `createVFSUI(options, engine)` — 工厂函数,返回 `ISessionUI<VFSNodeUI, VFSService>`(`VFSUIShell` 实例)
- `connectEditorLifecycle` — 连接 VFS-UI 和编辑器生命周期
- 状态管理使用 `immer`(`VFSStore` 内 `produce`)进行不可变更新
- 节点操作经 `VFSService`(createFile / createDirectory / renameItem / updateMultipleItemsTags 等),事件经 `contracts/events.ts` 的映射表处理

详情: [组件 + Options](./doc/components.md)
