# CLAUDE.md — @itookit/mdxeditor

CodeMirror 6 驱动的 Markdown/MDX 编辑器。编辑/预览双模式、流式渲染、Mermaid/数学公式/PlantUML。

## Architecture

```
src/
├── editor/        ← MDxEditor (实现 IEditor，v3.3: sessionEngine = IModuleFS)
├── renderer/      ← MDxRenderer (实时预览)
├── adapters/      ← CodeMirror 6 + marked 适配
├── core/          ← PluginManager, EventBus, DI 容器
├── managers/      ← Navigation, Save, Search, Mode, StreamingDiffer
├── plugins/       ← 20+ 插件 (语法/交互/自动完成/Cloze/Asset/Upload/UI)
├── services/      ← MDxProcessor, PrintService
└── utils/         ← 工具函数
```

`registerPlugin(MyPlugin)` — 全局注册。`defaultEditorFactory` — 默认 `EditorFactory`。

### v3.3: PluginContext 变更

```ts
// PluginContext.getSessionEngine() 返回 IModuleFS（v3.3，不再返回 IFSEngine）
const fs = context.getSessionEngine();
const file = createMDXFile(fs, ownerNodeId);  // v3.3: 参数改为 IModuleFS
```

详情: [插件目录](./doc/plugin-catalog.md)

## Conventions

- 流式更新使用 `StreamingDiffer` 而非整体替换
- `ScopedPersistenceStore` — 插件私有 localStorage（scopeId 隔离）
- `AssetResolverPlugin` 通过 `createMDXFile(fs, nodeId)` 创建文件句柄
- Asset 上传路径路由修复：正确处理 `/` vs `null` parentPath
- 暗色主题 CSS 同时使用 `[data-theme="dark"]` 和 `@media (prefers-color-scheme: dark)` 选择器，支持手动和系统主题切换
