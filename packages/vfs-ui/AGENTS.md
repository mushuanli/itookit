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
                      delete-guard, fixed-entry, delete-error, error-detail, adapter-debug
```

## 约定

- `createVFSUI(options, engine)` — 工厂函数,返回 `VFSUIShell` 实例（不继承 ISessionUI）
- 编辑器连接、媒体预览、mention 及 Markdown 元数据策略位于 `app-shell/src/browser/`，不在本包。
- 本包仅依赖 vfs-core。消费方契约在 contracts/ 定义；通过结构兼容接口接收宿主能力，禁止重新引入 common/ui-common 或其他业务包。
- 翻译、图标和启动跟踪经 presentation 按实例注入；内置默认值保证无宿主适配时也能使用。
- 宿主使用语义 API，不能访问内部 store.dispatch。
- 行级读写策略只在 `utils/row-policy.ts` 定义（`resolveRowPolicy` / `resolveColumnReadOnly` / `ROW_FLAGS`）；renderer、右键菜单、拖拽与行处理器都是机制，禁止各自重新推导 `_readOnly` / `_fixedEntry` / `quickDelete`。
- 虚拟目录可通过 `presentation.quickDelete` 开启两步行内删除；`onQuickDelete(node)` 接入宿主生命周期，在第二次确认后执行。未提供回调时走普通文件删除；固定入口及只读条目不开放。行内控件的两次点击本身就是确认，第二次点击直接进删除管线，不再复用右键菜单动作（否则会再问一次）；菜单与批量删除各自的确认保持不变。右键菜单策略独立于显式开启的行内操作，且收藏项进入默认菜单，宿主仍可过滤。
- 收藏是宿主持久化的状态：`favoriteAction.state(node)` 只读（返回 `undefined` 隐藏控件），`favoriteAction.toggle(node)` 执行；本包不保存收藏。
- 状态更新由 VFSStore + services/state-update.ts 完成：只复制被修改节点及其祖先，复用未变分支、Set 和配置；无变化不通知 state 订阅者，action hook 仍先执行。
- 节点操作经 `VFSService`(createFile / createDirectory / renameItem / updateMultipleItemsTags 等),事件经 `contracts/events.ts` 的映射表处理

详情: [组件 + Options](./doc/components.md)

文件树的 `.gitignore` 过滤属于 UI 展示，位于 `utils/gitignore-visibility.ts`；默认不额外排除 node_modules 等目录，不更改原始 VFS、工具或服务端行为。合成导航使用 `hideGitignored: false`，实际文件通过宿主注入的展示回调过滤；规则变更重新加载已展开分支。

- 行内删除/移动通过 `RowMutationPort` 分派；目录按钮由 `DirectoryActions` 管理进行中状态。菜单呈现不是授权，执行前通过 `allowsRowAction` 和最新节点重新检查。
- 内置「新建文件/新建目录」的目标目录：有选中时取首个选中项（目录→自身，文件→其父目录），否则取**当前激活行**（同上），再退回列根。激活一行会清掉单条选中，所以不能只看 `selectedItemIds`——否则"点开一个文件夹再新建"会落到列根。宿主给同名动作提供了自定义 `actions` 时仍以宿主语义为准。
- `FileSystemView` 把 provider 消息统一成 `Source operation failed: <method>`，原文只在 `cause` 里。面向用户的报错路径（`CommandBus` 日志、`ActionRunner` 默认 reporter、宿主 report）统一用 `utils/error-detail.ts` 的 `describeErrorReason()`（日志可用 `describeCauseChain()`） 取最内层原因，否则「跨项目移动」这类可操作解释永远不会显示。
