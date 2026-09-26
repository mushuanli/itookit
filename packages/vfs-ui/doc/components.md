# vfs-ui 接口与组件

## 模块边界

浏览器维护展示和交互，不拥有编辑器。公共工具、图标、Heading 和 TaskCounts 使用 common 的唯一实现；菜单、标签编辑器和文件创建契约复用 ui-common；状态仍使用 immer。没有为削减依赖复制公共代码。

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

## 文件工作台高级入口

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
| columns | 项目工作台的双列布局配置；省略时单列 |
| persistence、scopeId | 是否持久化及实例命名空间；旧文件工作台默认保留持久化 |
| onError | 操作错误报告 |

Shell 提供 `getNode/updateNodeMetadata/setQuery/setSelection/setExpanded/getSnapshot`，宿主不再访问 store.dispatch。getSnapshot 仅返回冻结的 activeId/query/selectedIds/expandedIds，不暴露内部 Store、可变 Set 或缓存。

`selectPath` 定位并激活；`expandPath` 仅展开。自定义 source 根据 parentId 寻找祖先，标准文件 adapter 处理路径。后台刷新保留当前选择与已展开分支。

双列使用 `setContentRoot/getContentRoot/setContentVisible/showColumn` 控制右列和窄屏显示。每列独立搜索和选择，节点保留原身份；上层决定项目、文件入口和会话家族如何投影。`backLabel` 由宿主决定，缺省为通用“返回”。

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
