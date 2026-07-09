# C3 - UI 层组件图 (v4.1 优化后)

## 技术栈

- **原生 DOM** + 模板字符串 + `addEventListener` 委托绑定
- **CSS**: BEM 命名 (`llm-input__xxx`), 变量在 `llm-ui/src/styles/variables.css`
- **图标**: 从 `@itookit/common` import

## 包职责

### mdxeditor — MDX 编辑器

| 组件 | 职责 |
|---|---|
| `MDxEditor` | CodeMirror 6 编辑器核心 |
| `MDxRenderer` | Markdown 渲染器（编辑/预览双模式） |
| `PluginManager` | 20+ 插件注册管理 |
| `MDxProcessor` | MDX 处理服务 |
| `defaultEditorFactory` | 默认 EditorFactory |
| `SRSItemData/ISRSService` | SRS 接口（从 common 移入，types/srs.ts） |

### vfs-ui — VFS 文件树 UI

| 组件 | 职责 |
|---|---|
| `VFSUIShell` | 文件树导航外壳 (ISessionUI) |
| `VFSService` | 文件操作服务 |
| `FileMentionSource` | 文件 @mention 补全源 |
| `FileTypeRegistry` | 文件类型注册 |
| `connectEditorLifecycle()` | VFS-UI ↔ 编辑器生命周期桥接 |
| `IAutocompleteSource/IMentionSource` | 自动完成接口（从 common 移入，autocomplete-source.ts） |

### llm-ui — Chat UI

| 组件 | 职责 |
|---|---|
| `LLMWorkspaceEditor` | LLM 工作区视图 |
| `ChatInput` | Claude.ai 风格对话输入组件 |
| `ConnectionSettingsEditor` | LLM 连接设置编辑器 |
| `ProviderSettingsEditor` | Provider 设置编辑器 |
| `SkillSettingsEditor` | Skill 设置编辑器 |
| `MCPSettingsEditor` | MCP 设置编辑器 |
| `CostEditor` | 费用仪表板 |
| `AIContextMenu` | AI 右键菜单 |

> **优化**: 设置编辑器通过 `LLMUIEditors` 注入给 `app-settings`，解耦上行依赖

### memory-manager — 工作区容器

| 组件 | 职责 |
|---|---|
| `MemoryManager` | 顶层工作区容器（一个实例 = 一个标签页） |
| `BackgroundBrain` | AI 后台处理 |
