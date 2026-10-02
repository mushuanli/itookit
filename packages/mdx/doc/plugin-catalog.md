# mdx 插件目录

## MDxEditor

实现 `IEditor`。`createMDxEditor(container, options)` 返回实例。支持 edit/render 双模式。

## MDxPlugin 接口

```typescript
interface MDxPlugin {
    name: string;
    install(ctx: PluginContext): void;
    destroy?(): void;
}
```

## 核心插件一览

| 类别 | 插件 | 功能 |
|---|---|---|
| 语法 | `MermaidPlugin` | Mermaid 图表 |
| | `MathJaxPlugin` | LaTeX 公式 |
| | `FoldablePlugin` | 可折叠块 |
| | `CalloutPlugin` | Callout |
| 交互 | `TaskListPlugin` | 任务列表 toggle |
| | `TablePlugin` | 表格编辑 |
| | `CodeBlockControlsPlugin` | 代码块复制/运行 |
| 自动完成 | `MentionPlugin` | @-mention |
| | `TagPlugin` | #-tag 自动完成 |
| Anki | `ClozePlugin` / `MemoryPlugin` | 完形填空/间隔重复 |
| UI | `ToolbarPlugin` / `TitleBarPlugin` | 工具栏/标题栏 |

## 宿主与数据适配

插件通过 `PluginContext.getAssets()`、`getDocumentPath()`、`getScopedStore()` 和 `notify()` 访问公共能力；使用 `registerCodeMirrorExtension` / `registerSyntaxExtension` 注册扩展。

`MentionProvider`、`AutocompleteProvider` 和 `TagPluginOptions.getTags` 接收用户自己的查询实现。MindOS 的 VFS、附件管理和会话打印由 `@itookit/mdx-adapter` 接入，核心插件不导入内部业务包。
