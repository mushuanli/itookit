# vfs-ui 接口与组件

## 模块边界

浏览器维护展示和交互，不拥有编辑器。本包仅依赖 vfs-core；Heading、TaskCounts、菜单、标签编辑器和文件创建等消费方契约由本包公开。宿主实现相同结构即可接入，无需 common/ui-common。默认 SVG、基础工具和中英文主要控件文案包含在包内；presentation 可按实例覆盖翻译、图标与启动跟踪。状态通过路径复制保持不可变，不依赖 immer。

编辑器连接、媒体预览、Markdown 元数据解析、mention 来源与编辑器选择位于 app-shell 的 `src/browser/`。设置页通过 `FileBrowserConnector` 注入连接器，不向上依赖 app-shell。vfs-ui 的 FileTypeRegistry 仅处理图标、解析器配置与复制转换，不持有 EditorFactory。

## 简明入口

```ts
const browser = createVFSBrowser({
  container,
  source: fromVFS(fs, { root: '/notes' }),
  title: 'Notes',
  sort: { by: 'title', direction: 'asc' },
  actions,
  onActivate: node => openResource(node.resource),
  onError: error => showError(error),
});
await browser.start();
```

`VFSBrowser` 提供 `start/reveal/expand/setQuery/select/refresh/getSelection/destroy`。此入口默认单列、不自动选中、不写 localStorage，也不为自定义数据源注册文件写操作。

`BrowserSource` 只有 `get(id, signal?)`、`children(parentId, signal?)`、`subscribe(listener)`。ID 是不可解析的显示身份，父链来自 parentId。BrowserNode 的 `kind` 明确区分 file/directory/group，`resource?: { viewId, path }` 是真实资源引用。分组没有默认文件动作；源范围由 fromVFS 的 root 限定，实际读写权限仍由 IFileSystem 校验。

SourceAdapter 将公开节点映射到内部展示模型，支持懒加载、展开恢复、变化订阅与取消。搜索当前已加载条目，不隐式扫描整个文件系统。

### 动作

```ts
const archive = {
  id: 'archive',
  label: 'Export JSON',
  placements: ['toolbar', 'menu', 'selection'],
  state: context => ({ visible: true, enabled: context.selection.length > 0 }),
  run: async (context, signal) => exportSelection(context.selection, signal),
};
```

`ActionContext` 包含 selection/target/parent。动作拥有业务确认和执行；UI 在执行时检查可用性。同一列表的 ActionRunner 合并同 ID 的进行中操作、报告异步错误，并在销毁时发出 AbortSignal。宿主异步操作须遵守 signal；UI 无法撤销已提交的领域写入。

工具栏、菜单、行内删除与底部批量操作共享执行边界。高级入口的旧菜单配置仍可用；底部批量按钮与拖拽会检查宿主菜单策略，不能通过另一入口绕过已移除的操作。固定排序下禁止 before/after 拖拽重排。异步 CommandBus 返回 Promise，调用方可以等待完成或拒绝。

### 删除与移动的公共执行机制

`createSelectionOperation` 是删除和移动共用的执行核心。宿主 `resolve` 返回有序批次（`ids` + `execute`）；核心在确认前按真实资源身份跨批次去重，依次执行，取消或异常立即停止，全部成功后调用 `completed`。ID 在一次操作内必须唯一标识真实资源（跨视图时包含 viewId），不能使用同一资源的不同展示节点 ID。异常交给既有 ActionRunner 报告；核心不另建锁或吞掉错误，也不回滚已经提交的写入。

- `createDeleteOperation`：宿主提供 `resources` 和可选 `containers` 批次，每批通过 `remove` 返回 `completed` / `cancelled`。所有资源删除成功后才执行容器删除，空抽屉也可以只提供容器批次。
- `createMoveOperation`：调用参数为 `{ selection, destination }`；宿主解析完整来源、校验目标并提供执行批次。目标可以是文件目录、抽屉名或其他领域身份，公共层不解析路径，也不推测移动分组是否意味着移动其内容。
- 两者都支持异步 `confirm`、成功回调 `completed` 和 AbortSignal。取消后不启动下一批或刷新；已经提交的操作无法撤销，宿主内部的长异步步骤也应遵守 signal。
- 文件单删、批删、文件移动及工具箱抽屉操作复用上述机制；实际权限与目标有效性仍由服务端口／领域服务校验。

```ts
const move = createMoveOperation<string[], string>({
  resolve: (ids, destination) => ({ batches: [{
    ids,
    execute: async paths => {
      await files.move(paths, destination);
      return 'completed';
    },
  }] }),
  completed: () => browser.refresh(),
});
// Use inside a BrowserAction.run or another existing ActionRunner boundary.
await move({ selection: selectedResourceIds, destination: targetId }, signal);
```

完整删除目标必须来自数据源或宿主目录，不能依赖渲染树的 children、当前搜索结果或展开状态。分组是否删除、Provider 关联影响确认、文件递归删除和抽屉归属变更均由适配器定义。UI 不将 group 默认解释为可递归删除的目录。

## 文件工作台高级入口

`directoryPreview(node)` 可返回目录初始显示的子项数；不配置时显示全部。双列导航可单独配置 `columns.navigationDirectoryPreview`。超过数量后提供“显示更多／收起”；展开后的子列表限制高度并独立滚动，收起按钮固定在底部；当前项、选中项及其祖先仍可见，搜索时不截断结果。限制仅作用于呈现，原始树、选择范围和导出不变，展开状态在当前组件生命周期内保留。

`createVFSUI(options, fs)` 返回 `VFSUIShell`。`VFSUIOptions` 是 `VFSUIShellOptions` 的别名，只有一份配置声明；Shell 不再继承 ISessionUI。

常用配置：

| 配置 | 用途 |
| --- | --- |
| sessionListContainer、title、searchPlaceholder | 容器与文案；保留既有参数名 |
| fileCreation、fileTypes、defaultExtension | 普通文件创建、图标与复制行为 |
| source | 可选自定义 BrowserSource；设置页已采用 VFS source adapter |
| listItems、cardDirectory、listHeader | 宿主投影、抽屉外观、附加筛选条 |
| sort、compareItems | 固定排序及宿主排序；选择条目不会改变固定排序 |
| contextMenu、toolbarOptions | 文件工作台已有菜单与工具栏扩展 |
| favoriteAction、onQuickDelete | 宿主行级动作：收藏状态/切换与虚拟条目的删除执行 |
| columns | 项目工作台的双列布局配置；省略时单列 |
| persistence、scopeId | 是否持久化及实例命名空间；旧文件工作台默认保留持久化 |
| onError | 操作错误报告 |

`favoriteAction` 是宿主持久化的收藏端口：`state(node)` 在渲染期查询（返回 `undefined` 隐藏控件，必须无副作用），`toggle(node)` 在用户激活后执行。`onQuickDelete(node)` 只对声明 `presentation.quickDelete` 的条目生效，未提供时回退到普通文件删除。

### 行级写入策略

策略与机制分离：`utils/row-policy.ts` 是唯一的策略来源，`resolveRowPolicy(viewReadOnly, node)` 产出 `RowPolicy`（`readOnly` / `fixed` / `inlineDelete` / `hostOwnedDelete`）。renderer、`BaseNodeItem`、右键菜单、拖拽门禁与行处理器只消费该结果；DOM 侧的数据属性名由 `ROW_FLAGS` 统一发布，避免渲染与拖拽各自硬编码。

规则：只读来自视图级 `readOnly` 或节点 `_readOnly`；`_fixedEntry` 的宿主条目没有行内删除，删除管线本身也会跳过它们；文件始终有行内删除，虚拟目录通过 `presentation.quickDelete` 显式开启，并因此把删除交给 `onQuickDelete`（未提供时回退 `file:delete`）。`resolveColumnReadOnly` 让只读的内容根（离线挂载、历史树）整列只读——注意这同时关闭该列的排序与批量选择，宿主需要排序时应提供 `compareItems`。

右键菜单的收藏项进入默认菜单后再交给宿主 `contextMenu.items` 过滤，因此宿主菜单策略仍是唯一权威；收藏读写宿主元数据而非资源本身，只读条目同样可以收藏。选择属于视图级语义，行级只读只限制修改（拖拽、删除、重命名、移动）。

Shell 提供 `getNode/updateNodeMetadata/setQuery/setSelection/setExpanded/getSnapshot`，宿主不再访问 store.dispatch。getSnapshot 仅返回冻结的 activeId/query/selectedIds/expandedIds，不暴露内部 Store、可变 Set 或缓存。

`selectPath` 定位并激活；`expandPath` 仅展开。自定义 source 根据 parentId 寻找祖先，标准文件 adapter 处理路径。后台刷新保留当前选择与已展开分支。

双列使用 `setContentRoot/getContentRoot/setContentVisible/showColumn` 控制右列和窄屏显示。每列独立搜索和选择，节点保留原身份；上层决定项目、文件入口和会话家族如何投影。`backLabel` 由宿主决定，缺省为通用“返回”。

`columns.navigationAction` 是固定导航动作：除 `label/icon/visible/disabled/active/run` 外，`afterChildId(parentPath)` 返回同级子条目的资源 ID，使动作固定在该子条目之后（缺省或未命中时追加到末尾）；`placement: 'after-first'` 保持原有语义。

## 展示信息

VFSNodeUI 是高级文件视图的展示模型，保留原 metadata/content 字段以兼容现有投影；新数据源使用精简 BrowserNode。两者由 SourceAdapter 转换，不能把显示 ID 当成文件路径。

`presentation` 包含通用 subtitle/badges/attention/unread。应用将 Agent 连接标签、任务数量、等待输入状态转换为这些显示字段；renderer 不再识别 `.agent` 或解释 HITL。`setNodeAttention(id, label?)` 控制提示标记。

## 生命周期与样式

持久化使用带 version 的 UI 状态记录，兼容旧无版本记录；相同快照不重复写入。简明入口默认关闭持久化，避免实例共享默认选择状态。

样式变量和基础 reset 限定在 `.vfs-ui` 范围，弹出菜单也设置该作用域，不修改宿主 body、全局按钮或列表。宿主仍可通过现有主题样式覆盖组件。

## 实现入口

- `src/browser/Browser.ts`：简明 facade。
- `src/contracts/source.ts`、`src/browser/actions.ts`：数据源、节点和动作契约。
- `src/browser/from-vfs.ts`、`src/browser/SourceAdapter.ts`：读取适配。
- `src/shell/VFSUIShell.ts`、`Assembler.ts`：文件工作台装配。
- `src/interaction/ActionRunner.ts`、`CommandBus.ts`：异步执行。
- `src/services/VFSStore.ts`、`StatePersistence.ts`：状态与快照。

### 行操作的内部边界

- `handlers/RowMutationPort.ts`：行内删除和拖拽的命令适配器；执行时重新解析节点，拒绝失效目标，明确宿主删除与普通文件删除的路由。
- `DirectoryActions.ts`：目录按钮的 DOM、锚点、激活展示与进行中状态；通过 `ActionRunner` 执行并报告错误，刷新列表不会重新开放仍在执行的按钮。
- `utils/row-policy.ts` 的 `allowsRowAction`：单项/批量内置操作的统一权限判断。宿主菜单可隐藏或替换呈现；未提供执行回调的内置命令不能绕过只读或固定条目策略。显式 `onClick` 是宿主生命周期端口（例如删除只读工具箱投影所代表的资源），由宿主授权并执行，不回退到通用文件命令。
- `ContextMenuHandler`：菜单呈现和调度，在执行前读取最新节点和菜单配置；底层资源权限仍由 VFS 校验。
- `ColumnState.commands()`：投影列的命令转发必须返回原命令的 Promise，使上层执行器能够等待完成、合并重复动作及报告失败。

渲染器在任意行策略变化时重建节点，而非只监听只读变化；资源 ID 按数据比较，避免把文件名当作 CSS 选择器解释。

## 宿主目录详情菜单

`VFSUIShell.showItemMenu(event, path)` 允许宿主在宽目录详情行上打开原有节点菜单。节点尚未加载时先展开父目录，再交给 NodeList；节点查找可回退到原始浏览状态，因此导航投影隐藏文件不会丢失文件行操作。权限判定与执行仍经过原有 row-policy、ContextMenuHandler 与命令管线。

宿主可用 `titleHeader` 替换标题行，通过 `toolbarContainer` 将原有工具栏控件挂到宿主标题区（保留事件、上下文和权限检查），使用 `rowCreation` 在可写目录行提供创建图标；执行前重新检查同一 row-policy。`allowsBulkAction` / `runBulkAction` 复用 ContextMenuHandler 的批量菜单过滤、删除确认与移动选择器，宿主不直接操作 store 或复制授权逻辑。

宿主目录详情与已打开列表通过 `getResourceIcon(node)` 复用节点显式图标、已注册文件类型图标及默认图标；图标容器使用 `file-type-icon` 复用资源浏览的浅色/深色主题配色。公共 `formatFileSize(bytes)` 提供 B、KiB、MiB 等易读大小，未知大小显示破折号。
