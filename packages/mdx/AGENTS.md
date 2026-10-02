# @itookit/mdxeditor

目录 `packages/mdx`，发布名 `@itookit/mdxeditor`。
CodeMirror 6 驱动的 Markdown/MDX 编辑器。编辑/预览双模式、流式渲染、Mermaid/数学公式/PlantUML。

## Architecture

```
src/
├── editor/        ← MDxEditor (实现自有 IEditor，通过 assets/storeFactory/host 注入能力) + CodeMirrorAdapter
│                    + ModeManager / NavigationManager / SaveManager / SearchManager + commands
├── renderer/      ← MDxRenderer (实时预览) + MarkedAdapter + StreamingDiffer
├── core/          ← PluginManager, PluginRegistry, EventBus (独立实现，支持 coalesce), ServiceContainer, store/
├── plugins/       ← 6 组插件：core / syntax-extensions / interactions / autocomplete / cloze / ui
├── services/      ← MDxProcessor, DefaultPrintService, asset-helper
└── utils/         ← logger, regex-cache
```

`registerPlugin(MyPlugin)` — 全局注册。`defaultEditorFactory` — 默认 `EditorFactory`。

### 公共宿主接口

核心不依赖其他 `@itookit/*` 包。接口定义在 `src/editor/contracts.ts`，从包根导出：

- `AssetProvider`：附件读取，可选上传、清理与 MIME 类型。
- `StoreFactory` / `ScopedPersistenceStore`：插件持久化，未注入时使用内存。
- `EditorHost`：文档打开、重命名和通知；`onSave` 提供内容保存。
- `documentPath` / `onDocumentPathChange`：宿主提供的文档标识，核心不推断消息或 Session 身份。

```ts
const bytes = await context.getAssets()?.read('image.png');
const path = context.getDocumentPath();
```

VFS、Session/namespace 校验、文件后缀判断、附件管理 UI 和会话打印位于 `packages/mdx-adapter`。

详情: [插件目录](./doc/plugin-catalog.md)

## Conventions

- 流式更新使用 `StreamingDiffer` 而非整体替换
- `ScopedPersistenceStore` — 插件私有持久化，由 `createStore()` 二级回退：注入的 `StoreFactory` → 内存（`MemoryStore`）
- `AssetResolverPlugin` 通过 `AssetProvider` 读取资源；路径生成统一走 `services/asset-helper.ts`
- 暗色主题 CSS 同时使用 `[data-theme="dark"]` 和 `@media (prefers-color-scheme: dark)` 选择器，支持手动和系统主题切换
- Mermaid 默认使用本地依赖且只在出现 `language-mermaid` 块时动态加载；Tauri 构建把其依赖放入独立 `mermaid-runtime` chunk。MathJax 只在渲染结果含 `\\(`/`\\[` 时加载。普通 Markdown 更新不得触发这两个运行时。

运行: `pnpm --filter @itookit/mdxeditor typecheck` / `test` / `build`
