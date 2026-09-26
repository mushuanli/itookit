# @itookit/vfs-ui

文件/资源浏览 UI — `createVFSBrowser`、`VFSUIShell`、`VFSService`、数据源与动作契约。

## 命令

```bash
pnpm --filter @itookit/vfs-ui build        # vite build
pnpm --filter @itookit/vfs-ui dev          # vite build --watch
pnpm --filter @itookit/vfs-ui test         # vitest run
```

## 结构

```
src/
├── shell/          ← VFSUIShell、双列布局、Assembler (DI)
├── services/       ← VFSService, VFSStore, EngineAdapter, NodeMapper,
│                     FileTypeRegistry, StatePersistence
├── ui/             ← NodeList, FileOutline, MoveToModal, TagEditor 及 items/handlers/popovers
├── contracts/      ← types (VFSNodeUI/VFSUIState/UISettings), ports, commands, events
├── interaction/    ← CommandBus, ActionRunner, EventBus, handlers/(File/Bulk/Navigation/
│                     Selection/UI/Import/Export/CustomMenu CommandHandler)
├── browser/        ← Browser、fromVFS、SourceAdapter、actions
└── utils/          ← helpers, node-sort, delete-guard, delete-error, adapter-debug
```

## 约定

- `createVFSUI(options, engine)` — 工厂函数,返回 `VFSUIShell` 实例（不继承 ISessionUI）
- 编辑器连接、媒体预览、mention 及 Markdown 元数据策略位于 `app-shell/src/browser/`，不在本包。
- common/ui-common 契约保持唯一来源；不要为减少依赖复制定义。
- 宿主使用语义 API，不能访问内部 store.dispatch。
- 状态管理使用 `immer`(`VFSStore` 内 `produce`)进行不可变更新
- 节点操作经 `VFSService`(createFile / createDirectory / renameItem / updateMultipleItemsTags 等),事件经 `contracts/events.ts` 的映射表处理

详情: [组件 + Options](./doc/components.md)
