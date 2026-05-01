# CLAUDE.md — @itookit/mdxeditor

CodeMirror 6 驱动的 Markdown/MDX 编辑器。编辑/预览双模式、流式渲染、Mermaid/数学公式/PlantUML。

## Architecture

```
src/
├── editor/        ← MDxEditor (实现 IEditor)
├── renderer/      ← MDxRenderer (实时预览)
├── adapters/      ← CodeMirror 6 + marked 适配
├── core/          ← PluginManager, EventBus, DI 容器
├── managers/      ← Navigation, Save, Search, Mode, StreamingDiffer
├── plugins/       ← 20+ 插件 (语法/交互/自动完成/Cloze/UI)
└── services/      ← MDxProcessor, PrintService
```

`registerPlugin(MyPlugin)` — 全局注册。`defaultEditorFactory` — 默认 `EditorFactory`。

详情: [插件目录](./doc/plugin-catalog.md)

## Conventions

- 流式更新使用 `StreamingDiffer` 而非整体替换
- `ScopedPersistenceStore` — 插件私有 localStorage（scopeId 隔离）
