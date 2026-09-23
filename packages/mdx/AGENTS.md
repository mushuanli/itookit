# @itookit/mdxeditor

目录 `packages/mdx`，发布名 `@itookit/mdxeditor`。
CodeMirror 6 驱动的 Markdown/MDX 编辑器。编辑/预览双模式、流式渲染、Mermaid/数学公式/PlantUML。

## Architecture

```
src/
├── editor/        ← MDxEditor (实现 IEditor，经 EditorOptions.files/assets 持有 IFileSystem) + CodeMirrorAdapter
│                    + ModeManager / NavigationManager / SaveManager / SearchManager + commands
├── renderer/      ← MDxRenderer (实时预览) + MarkedAdapter + StreamingDiffer
├── core/          ← PluginManager, PluginRegistry, EventBus (包装 vfs-core EventBus，支持 coalesce), ServiceContainer, store/
├── plugins/       ← 6 组插件：core / syntax-extensions / interactions / autocomplete / cloze / ui
├── services/      ← MDxProcessor, DefaultPrintService / LLMPrintService, asset-helper
└── utils/         ← logger, regex-cache
```

`registerPlugin(MyPlugin)` — 全局注册。`defaultEditorFactory` — 默认 `EditorFactory`。

### PluginContext 文件系统访问

```ts
// PluginContext 通过 getFileSystem()/getAssetFileSystem() 提供 IFileSystem 视图
const fs = context.getFileSystem?.() ?? null;
if (fs) { const file = createMDXFile(fs, context.getCurrentNodeId()!); }
```

`createMDXFile(fs: IFileSystem, nodeId: string): IMDXFile` 来自 `@itookit/vfs-core`。

详情: [插件目录](./doc/plugin-catalog.md)

## Conventions

- 流式更新使用 `StreamingDiffer` 而非整体替换
- `ScopedPersistenceStore` — 插件私有持久化，由 `createStore()` 二级回退：引擎节点元数据（`EngineMetadataStore`，基于 `IFileSystem`）→ 内存（`MemoryStore`）
- `AssetResolverPlugin` 用 `createMDXFile(fs, nodeId)` 创建文件句柄，资源文件系统取自 `getAssetFileSystem()`；路径生成统一走 `services/asset-helper.ts`
- 暗色主题 CSS 同时使用 `[data-theme="dark"]` 和 `@media (prefers-color-scheme: dark)` 选择器，支持手动和系统主题切换
- Mermaid 默认使用本地依赖且只在出现 `language-mermaid` 块时动态加载；Tauri 构建把其依赖放入独立 `mermaid-runtime` chunk。MathJax 只在渲染结果含 `\\(`/`\\[` 时加载。普通 Markdown 更新不得触发这两个运行时。

运行: `pnpm --filter @itookit/mdxeditor typecheck` / `test` / `build`
