# @itookit/vfs-ui

原生 DOM 资源浏览组件：树、抽屉、单/双列、搜索、排序、选择和动作执行。
仅依赖 `@itookit/vfs-core`，不依赖 common、ui-common、LLM 包或 immer。内置 SVG、基础样式和主要控件的中英文文案，不需要 MindOS 的初始化或全局配置。

## 安装与文件浏览

```bash
npm install @itookit/vfs-ui @itookit/vfs-core
```

```ts
import { createVFSBrowser, fromVFS } from '@itookit/vfs-ui';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import '@itookit/vfs-ui/style.css';

const container = document.querySelector<HTMLElement>('#files')!;
const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
const fs = await manager.openFileSystem('/');
await fs.driver.createFile({ name: 'hello.md', content: '# Hello' });
const browser = createVFSBrowser({
  container,
  source: fromVFS(fs),
  presentation: { locale: 'en' },
  onActivate: node => console.log(node.resource),
});
await browser.start();
// At unmount:
browser.destroy();
await manager.dispose();
```

容器需要明确高度，例如 `<div id="files" style="height: 400px"></div>`。Web、Tauri、Electron 等宿主使用相同 DOM API；浏览器之外需要 DOM 环境。

此入口默认只浏览，不隐式创建文件或保存选择状态。传入 `actions` 可增加业务操作；同一动作可出现在工具栏、单项和多选菜单。普通文件 CRUD、标签、大纲和双列装配使用 `createVFSUI(options, fs)`；它与简明入口共享状态、列表和交互实现。

## 自定义数据源与接入接口

可以直接实现公开的 `BrowserSource`，不创建 VFS：

```ts
import { createVFSBrowser, type BrowserNode, type BrowserSource } from '@itookit/vfs-ui';

const nodes: BrowserNode[] = [
  { id: 'note:1', parentId: null, kind: 'file', label: 'My note' },
];
const source: BrowserSource = {
  get: async id => nodes.find(node => node.id === id),
  children: async parentId => nodes.filter(node => node.parentId === parentId),
  subscribe: () => () => {}, // Notify the listener when a mutable source changes.
};
const browser = createVFSBrowser({ container, source });
await browser.start();
```

ID 是展示身份；关联真实文件时用 `resource: { viewId, path }`。`children` 应返回直接子项，异步数据源应响应可选的 AbortSignal，`subscribe` 返回取消订阅函数。搜索覆盖当前已加载条目。

| 公共接口 | 用户提供的能力 |
| --- | --- |
| `BrowserSource` / `BrowserAction` | 数据读取、变化订阅、业务操作与确认 |
| `VFSPresentationOptions` | `locale`、`translate(key, params)`、SVG 图标、`fileIcon`、启动 `trace` |
| `TagEditorFactory` / `IAutocompleteSource` | 标签编辑组件与建议列表 |
| `ContextMenuConfig` | 单项/批量菜单及动作回调 |
| `UIPersistencePort` | 版本化 UI 快照的读取与保存 |
| `IFileSystem`（从 vfs-core 导入） | 高级文件入口的读写、权限和事件 |

实现接口的公共结构即可，无需继承类或使用 itookit 的其他包。`presentation` 按实例配置，不会影响另一个浏览器。默认文案以中文为主，`locale: 'en'` 切换主要控件；旧高级弹窗仍有固定中文文案。自定义图标是可信 HTML/SVG，不应直接使用未经处理的用户输入。

```ts
const browser = createVFSBrowser({
  container, source,
  presentation: {
    translate: (key, params) => yourI18n(key, params),
    fileIcon: (filename, directory) => yourFileIcon(filename, directory),
  },
});
```

## 高级文件操作与宿主迁移

`createVFSUI` 通过端口接收宿主策略而不是复制业务：`favoriteAction.state/toggle` 提供收藏状态与切换，`onQuickDelete` 执行声明了 `presentation.quickDelete` 的虚拟条目删除；行级只读、固定条目与行内删除的判定集中在 `src/utils/row-policy.ts`。

`persistence` 默认关闭；`true` 选用包内 localStorage 存储，或传入 `UIPersistencePort` 使用自己的存储。编辑器通过 `sessionSelected` 和 `navigateToHeading` 等事件由宿主连接，不需要捆绑 mdxeditor。

原先从 common/ui-common 导入的 Heading、TaskCounts、菜单和标签工厂类型，现可直接从 vfs-ui 导入。原有结构兼容实现继续可用。需要跟随宿主的语言、图标或启动统计时，通过 `presentation` 注入；MindOS 的示例在 `packages/app-shell/src/browser/vfs-presentation.ts`。

- [接口与组件](./doc/components.md)
- [边界与迁移记录](../../doc/design/vfs-ui-boundary-review.md)
- [开发说明](./AGENTS.md)

```bash
pnpm --filter @itookit/vfs-ui build
pnpm --filter @itookit/vfs-ui test
```
