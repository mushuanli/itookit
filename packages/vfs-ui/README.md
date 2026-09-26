# @itookit/vfs-ui

原生 DOM 资源浏览组件：树、抽屉、单/双列、搜索、排序、选择和动作执行。
依赖 `vfs-core`、`common`、`ui-common` 的通用契约及 `immer`；不创建编辑器，不处理项目、会话或提供商的业务生命周期。

```ts
import { createVFSBrowser, fromVFS } from '@itookit/vfs-ui';
import '@itookit/vfs-ui/style.css';

const browser = createVFSBrowser({
  container,
  source: fromVFS(fs),
  onActivate: node => openResource(node.resource),
});
await browser.start();
// At unmount:
browser.destroy();
```

此入口默认只浏览，不隐式创建文件或保存选择状态。传入 `actions` 可增加业务操作；同一动作可出现在工具栏、单项和多选菜单。普通文件 CRUD、标签、大纲和双列装配使用 `createVFSUI(options, fs)`；它与简明入口共享状态、列表和交互实现。

- [接口与组件](./doc/components.md)
- [边界与迁移记录](../../doc/design/vfs-ui-boundary-review.md)
- [开发说明](./AGENTS.md)

```bash
pnpm --filter @itookit/vfs-ui build
pnpm --filter @itookit/vfs-ui test
```
