# CLAUDE.md — @itookit/mdxeditor

CodeMirror 6 驱动的 Markdown/MDX 编辑器。支持编辑/预览双模式、20+ 插件、流式渲染、Mermaid/数学公式/PlantUML。

## Commands

```bash
pnpm --filter @itookit/mdxeditor build      # vite build
pnpm --filter @itookit/mdxeditor dev        # vite dev
pnpm --filter @itookit/mdxeditor type-check # tsc --noEmit
```

## Architecture

```
src/
├── index.ts              ← 公共 API + 插件导出
├── factory.ts            ← createMDxEditor / defaultEditorFactory / registerPlugin
├── editor/
│   └── mdx-editor.ts     ← MDxEditor — 主编辑器（实现 IEditor）
├── renderer/
│   └── mdx-renderer.ts   ← MDxRenderer — 实时预览
├── adapters/
│   ├── codemirror-adapter.ts   ← CodeMirror 6 适配
│   └── marked-adapter.ts      ← marked 适配
├── core/
│   ├── plugin-manager.ts ← PluginManager — 插件生命周期
│   ├── event-bus.ts      ← EventBus — 编辑器事件
│   ├── service-container.ts ← DI 容器
│   ├── command-registry.ts ← 命令注册
│   └── types.ts          ← MDxPlugin, PluginContext, ScopedPersistenceStore...
├── services/
│   ├── processor.ts      ← MDxProcessor — 内容处理 (mention/tag/reference 提取)
│   ├── asset-helper.ts   ← 资产路径/上传限制
│   └── print/            ← PrintService (Default + LLM)
├── managers/
│   ├── navigation-manager.ts ← 标题大纲
│   ├── save-manager.ts       ← 自动保存/脏跟踪
│   ├── search-manager.ts     ← 搜索高亮
│   ├── mode-manager.ts       ← 编辑/渲染切换
│   └── streaming-differ.ts   ← 流式增量 diff
├── plugins/               ← 20+ 插件
│   ├── core/             ← CoreEditorPlugin
│   ├── syntax-extensions/ ← Foldable, MathJax, Media, Svg, Mermaid, PlantUml, Vega, Callout
│   ├── interactions/     ← AutoSave, Clipboard, CodeBlockControls, SourceJump, Table, TaskList, Upload
│   ├── autocomplete/     ← AutocompletePlugin, MentionPlugin, TagPlugin, TagAutocompleteSource
│   ├── cloze/            ← ClozePlugin, ClozeControlsPlugin, MemoryPlugin
│   └── ui/               ← ToolbarPlugin, FormattingPlugin, AssetManagerUI, TitleBarPlugin
├── stores/
│   ├── engine-metadata-store.ts ← 元数据持久化 (→ ISessionEngine)
│   └── memory-store.ts          ← 内存存储
└── styles/
```

## 关键类

### MDxEditor

实现 `IEditor` 抽象类。`createMDxEditor(container, options)` 返回编辑器实例。

```typescript
class MDxEditor extends IEditor {
    async init(container, content?): Promise<void>;
    getText(): string;
    setText(text): void;
    focus(): void;
    getMode(): 'edit' | 'render';
    switchToMode(mode): Promise<void>;
    isDirty(): boolean;
    navigateTo(line, col?): void;
    search(query): Promise<UnifiedSearchResult[]>;
    destroy(): void;
}
```

### MDxPlugin 接口

插件运行在编辑/渲染双上下文：

```typescript
interface MDxPlugin {
    id: string;
    init(ctx: PluginContext): Promise<void>;
    destroy(): void;
    // CodeMirror 扩展
    getExtensions?(): Extension[];
    // Marked 渲染器扩展
    getRendererExtension?(): MarkedExtension;
}
```

### PluginContext

```typescript
interface PluginContext {
    editor: MDxEditor;
    eventBus: EventBus;
    serviceContainer: ServiceContainer;
    scopedStore: ScopedPersistenceStore; // 插件私有存储
}
```

## 核心插件一览

| 类别 | 插件 | 功能 |
|---|---|---|
| 语法 | `MermaidPlugin` | Mermaid 图表渲染 |
| | `MathJaxPlugin` | LaTeX 公式 |
| | `FoldablePlugin` | 可折叠块 |
| | `CalloutPlugin` | Callout/提示块 |
| 交互 | `TaskListPlugin` | 任务列表 toggle |
| | `TablePlugin` | 表格编辑 |
| | `CodeBlockControlsPlugin` | 代码块复制/运行 |
| 自动完成 | `MentionPlugin` | @-mention 文件引用 |
| | `TagPlugin` | #-tag 自动完成 (TagAutocompleteSource) |
| Anki | `ClozePlugin` / `MemoryPlugin` | 完形填空/间隔重复 |
| UI | `ToolbarPlugin` / `TitleBarPlugin` | 工具栏/标题栏 |

## Conventions

- `registerPlugin(MyPlugin)` — 全局注册，影响后续所有编辑器实例
- `defaultEditorFactory` — 默认 `EditorFactory`（供 `MemoryManager` 使用）
- 流式更新使用 `StreamingDiffer` 而非整体替换
- `ScopedPersistenceStore` — 插件私有 localStorage 命名空间（scopeId 隔离）
