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
│                     FileTypeRegistry
├── ui/             ← NodeList, FileOutline, MoveToModal, TagEditor 及 items/handlers/popovers
├── contracts/      ← types (VFSNodeUI/VFSUIState/UISettings), ports, commands, events,
│                     persistence (UISnapshot / UIPersistencePort / localStorage adapter)
├── interaction/    ← CommandBus, ActionRunner, EventBus, handlers/(File/Bulk/Navigation/
│                     Selection/UI/Import/Export/CustomMenu CommandHandler)
├── browser/        ← Browser、fromVFS、SourceAdapter、actions
└── utils/          ← helpers, row-policy（读写策略唯一来源）, node-sort,
                      delete-guard, fixed-entry, delete-error, adapter-debug
```

## 约定

- `createVFSUI(options, engine)` — 工厂函数,返回 `VFSUIShell` 实例（不继承 ISessionUI）
- 编辑器连接、媒体预览、mention 及 Markdown 元数据策略位于 `app-shell/src/browser/`，不在本包。
- common/ui-common 契约保持唯一来源；不要为减少依赖复制定义。
- 宿主使用语义 API，不能访问内部 store.dispatch。
- 行级读写策略只在 `utils/row-policy.ts` 定义（`resolveRowPolicy` / `resolveColumnReadOnly` / `ROW_FLAGS`）；renderer、右键菜单、拖拽与行处理器都是机制，禁止各自重新推导 `_readOnly` / `_fixedEntry` / `quickDelete`。
- 虚拟目录可通过 `presentation.quickDelete` 开启两步行内删除；`onQuickDelete(node)` 接入宿主生命周期，在第二次确认后执行。未提供回调时走普通文件删除；固定入口及只读条目不开放。右键菜单策略独立于显式开启的行内操作，且收藏项进入默认菜单，宿主仍可过滤。
- 收藏是宿主持久化的状态：`favoriteAction.state(node)` 只读（返回 `undefined` 隐藏控件），`favoriteAction.toggle(node)` 执行；本包不保存收藏。
- 状态管理使用 `immer`(`VFSStore` 内 `produce`)进行不可变更新
- 节点操作经 `VFSService`(createFile / createDirectory / renameItem / updateMultipleItemsTags 等),事件经 `contracts/events.ts` 的映射表处理

详情: [组件 + Options](./doc/components.md)

文件树的 `.gitignore` 过滤属于 UI 展示，位于 `utils/gitignore-visibility.ts`；默认不额外排除 node_modules 等目录，不更改原始 VFS、工具或服务端行为。合成导航使用 `hideGitignored: false`，实际文件通过宿主注入的展示回调过滤；规则变更重新加载已展开分支。

- 行内删除/移动通过 `RowMutationPort` 分派；目录按钮由 `DirectoryActions` 管理进行中状态。菜单呈现不是授权，执行前通过 `allowsRowAction` 和最新节点重新检查。
