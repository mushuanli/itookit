# @itookit/mdxeditor

![npm version](https://img.shields.io/npm/v/@itookit/mdxeditor.svg)
![license](https://img.shields.io/npm/l/@itookit/mdxeditor.svg)

一个功能强大、由插件驱动、基于 CodeMirror 6 的 MDX 编辑器组件，专为可扩展性和富内容创作而设计。

`@itookit/mdxeditor` 提供了一个完整的解决方案，集成了强大的 CodeMirror 6 编辑核心和一个基于 `marked` 的可扩展渲染器。它通过灵活的插件系统，实现了编辑和预览两种模式，并内置了大量开箱即用的功能。

## ✨ 核心特性

- **🚀 双模式操作**: 在原生 Markdown/MDX 编辑器 (CodeMirror 6) 和精美的渲染视图之间无缝切换。
- **🧩 可扩展的插件系统**: 包含丰富的内置插件，并提供简单的 API 来创建您自己的插件，轻松定制编辑器功能。
- **📚 丰富的语法支持**:
  - 通过 **MathJax** 支持 LaTeX 数学公式 (`...` 和 `...`)。
  - 使用 **Mermaid** 绘制图表和流程图。
  - 支持 Anki 风格的**挖空填词 (Cloze)** (`--挖空内容--`)，并支持音频提示。
  - 创建**可折叠内容块** (`::> 标题`) 以组织长文。
  - 自定义**媒体嵌入** (`!video[...]`, `!file[...]`)。
- **🎨 交互式 UI 组件**:
  - 可配置的**工具栏**和**标题栏**，用于执行常用操作。
  - 交互式**任务列表** (`- [x] 任务`)，点击即可更改状态。
  - 高级的**代码块控件**，提供一键复制、下载和折叠功能。
- **✍️ 高级编辑体验**:
  - 强大的**自动完成**框架，支持标签 (`#`)、提及 (`@`) 等。
  - **源码同步**: 在渲染视图上按住 `Ctrl/Cmd` 并双击，可立即跳转到其源码位置。
  - 为挖空填词集成了**间隔重复系统 (SRS)**。
- **💾 灵活集成**: 通过公开接口接入宿主的保存、附件与持久化服务；不依赖其他 `@itookit/*` 包。

## 📦 安装

```bash
# 使用 pnpm
pnpm add @itookit/mdxeditor

# 使用 npm
npm install @itookit/mdxeditor

# 使用 yarn
yarn add @itookit/mdxeditor
```

## 🚀 快速上手

1.  **准备 HTML 容器**

    在您的 HTML 文件中，创建一个用于挂载编辑器的容器。

    ```html
    <div id="editor-container" style="height: 600px; border: 1px solid #ccc;"></div>
    ```

2.  **初始化编辑器**

    在您的 JavaScript 或 TypeScript 文件中，导入并使用 `createMDxEditor` 工厂函数。

    ```typescript
    import { createMDxEditor } from '@itookit/mdxeditor';
    // 引入基础样式，您可以根据需要覆盖它
    import '@itookit/mdxeditor/style.css';

    async function initializeEditor() {
      const container = document.getElementById('editor-container');
      
      if (container) {
        const initialContent = `# Hello, MDxEditor!

This is a demo. Try some syntax:

- [x] Interactive task list
- [ ] Another task

$$E=mc^2$$

\`\`\`mermaid
graph TD;
    A[Start]-->B{Is it?};
    B-->|Yes|C[OK];
    B-->|No|D[Find out];
\`\`\``;

        const editor = await createMDxEditor(container, {
          initialContent: initialContent,
        });

        console.log('Editor is ready!', editor);

        // 您现在可以与 editor 实例交互
        // editor.setText('New content!');
      }
    }

    initializeEditor();
    ```

## ⚙️ 配置

`createMDxEditor` 函数接受一个配置对象，允许您深度自定义编辑器的行为和功能。

### 插件配置

您可以通过 `plugins` 数组和 `defaultPluginOptions` 对象来管理插件。

```typescript
import { createMDxEditor } from '@itookit/mdxeditor';

const editor = await createMDxEditor(container, {
  initialContent: '...',
  
  // 自定义插件列表
  plugins: [
    '-mermaid', // 禁用默认的 Mermaid 插件
    'core:titlebar',
    'autocomplete:tag',
    'cloze:cloze', // Add cloze syntax
    'cloze:memory', // Add spaced repetition
  ],

  // 为特定插件提供配置
  defaultPluginOptions: {
    // 配置任务列表插件
    'task-list': {
      autoUpdateMarkdown: false, // 检查任务时不要自动更新 Markdown 源码
    },
    // 配置标签自动完成插件（需要手动启用 'autocomplete:tag'）
    'autocomplete:tag': {
      getTags: async () => ['bug', 'feature', 'docs', 'refactor']
    },
    // 配置标题栏
    'core:titlebar': {
        enableToggleEditMode: true, // 启用编辑/阅读模式切换按钮
        saveCallback: (editor) => {
            console.log('Content saved:', editor.getText());
        }
    }
  }
});
```

-   **启用插件**: 在 `plugins` 数组中添加插件名称 (e.g., `'cloze:cloze'`)。
-   **禁用默认插件**: 在插件名称前添加 `-` (e.g., `'-mermaid'`)。
-   **禁用所有默认插件**: 将 `'-all'` 作为 `plugins` 数组的第一个元素。

## 🔌 核心插件


### 模块功能说明表

以下是根据代码 (`factory.ts` 和各插件文件) 整理的模块功能、默认状态及常用配置选项。

| 模块/插件名称 | 注册名称 (Name) | 功能说明 | 默认状态 (Default) | 常用选项 (Common Options) |
| :--- | :--- | :--- | :--- | :--- |
| **Core Editor** | `editor:core` | 提供基础编辑能力 (CodeMirror 6)，包括行号、软换行、折叠、撤销重做等。 | **已启用**<br>行号: 关闭<br>自动换行: 开启<br>折叠: 开启 | `enableLineNumbers`: boolean (行号)<br>`enableLineWrapping`: boolean (长行自动换行)<br>`enableHistory`: boolean (历史记录)<br>`enableAutocompletion`: boolean (自动补全) |
| **Title Bar** | `core:titlebar` | 顶部标题栏，包含标题、模式切换、保存、打印及 AI 按钮。 | `defaultEditorFactory` 默认启用；`createMDxEditor` 需在 `plugins` 中添加 | `enableToggleEditMode`: boolean<br>`title`: string<br>`onSidebarToggle`: function |
| **Toolbar** | `ui:toolbar` | 编辑器工具栏容器，用于放置格式化按钮。 | **已启用** | `className`: string (自定义样式类) |
| **Formatting** | `ui:formatting` | 提供加粗、斜体、列表、链接等基础 Markdown 格式化按钮和命令。 | **已启用**<br>功能: All | `enabledFormats`: string[] (如 `['bold', 'italic']`)<br>`customIcons`: object (自定义图标) |
| **Clipboard** | `interaction:clipboard` | 智能粘贴：富文本转 Markdown；`Cmd/Ctrl+Shift+V` 原始粘贴。 | **已启用**<br>模式: smart | `pasteMode`: `'smart'\|'plain'\|'rich'`<br>`enablePlainPasteShortcut`: boolean |
| **Source Sync** | `interaction:source-sync` | **双击**渲染内容可跳转至编辑模式对应的源码位置。 | **已启用** | 无配置项 (依赖 DOM 结构查找) |
| **Table** | `interaction:table` | 增强表格功能，支持点击表头**排序**和表头下方输入框**筛选**。 | **已启用**<br>排序: 开启<br>筛选: 关闭 | `enableSorting`: boolean<br>`enableFiltering`: boolean (开启筛选行) |
| **Foldable** | `folder` | 支持折叠块语法 `::> 标题`，可包含复选框。 | **已启用**<br>默认: 展开 | `defaultOpen`: boolean<br>`enableTaskCheckbox`: boolean (标题是否支持任务框) |
| **MathJax** | `mathjax` | 渲染 LaTeX 数学公式 (`$$...$$`, `$..$`)。 | **已启用**<br>自动加载 CDN | `cdnUrl`: string (自定义 CDN)<br>`config`: object (MathJax 配置) |
| **Media** | `media` | 渲染视频、音频、嵌入内容 (YouTube/Bilibili/Office/PDF)。 | **已启用**<br>视频控制条: 开启 | `videoAutoplay`: boolean<br>`videoControls`: boolean |
| **Callout** | `callout` | 支持 GitHub/Obsidian 风格的提示块 (`> [!NOTE]`)。 | **已启用** | `defaultFolded`: boolean (暂未实现) |
| **Mermaid** | `mermaid` | 渲染 Mermaid 流程图、时序图等。 | **已启用**<br>按需加载本地 mermaid 依赖 | `theme`: 'default'\|'dark'等 |
| **SVG** | `svg` | 将 ` ```svg ` 代码块直接渲染为内联 SVG 图片 (带安全过滤)。 | **已启用**<br>Sanitize: 开启 | `sanitize`: boolean (防XSS)<br>`containerClass`: string |
| **Code Controls** | `codeblock-controls` | 代码块增强：复制、下载、折叠过长代码。 | **已启用**<br>折叠阈值: 250px | `enableCopy`: boolean<br>`enableCollapse`: boolean<br>`collapseThreshold`: number (高度阈值) |
| **Task List** | `task-list` | 交互式任务列表 (`- [ ]`)，支持点击勾选并**回写 Markdown**。 | **已启用**<br>自动回写: 开启 | `autoUpdateMarkdown`: boolean (点击更新源码)<br>`checkboxSelector`: string |
| **Cloze (Core)** | `cloze:cloze` | 挖空插件核心 (`--text--`)，支持点击显示/隐藏，支持 TTS 发音。 | **按需加载**<br>(需在 plugins 列表) | `className`: string<br>`audioIconClass`: string |
| **Cloze UI** | `cloze:cloze-controls` | 挖空控制面板（全显/全隐/导航）。 | **按需加载** | `className`: string |
| **Memory** | `cloze:memory` | 记忆卡片/SRS (间隔重复) 功能，为挖空添加“忘记/简单”评分面板。 | **按需加载** | `gradingTimeout`: number<br>`coolingPeriod`: number (冷却时间)<br>`hideBeforeDueHours`: number |
| **PlantUML** | `plantuml` | 将 PlantUML 代码块转换为图片 (依赖外部 Server)。 | **默认未启用**<br>(不在 DEFAULT_PLUGINS) | `serverUrl`: string (默认 plantuml.com)<br>`format`: 'svg'\|'png' |
| **Vega** | `vega` | 渲染 Vega/Vega-Lite 数据可视化图表。 | **默认未启用**<br>(不在 DEFAULT_PLUGINS) | `theme`: 'quartz'等<br>`actions`: boolean (显示导出菜单) |
| **Autocomplete**| `autocomplete:tag/mention` | 自动补全 (`#tag`, `@mention`)。 | **默认未启用** | `getTags`: function (标签源)<br>`providers`: array (提及源配置) |

### 3. 如何配置默认选项

在调用 `createMDxEditor` 或 `defaultEditorFactory` 时，可以通过 `defaultPluginOptions` 修改上述默认状态。

**示例：开启行号并禁用表格排序**

```typescript
createMDxEditor(container, {
  plugins: [/* ... */], // 如果不传则使用 DEFAULT_PLUGINS
  defaultPluginOptions: {
    'editor:core': {
      enableLineNumbers: true, // 开启行号
      enableLineWrapping: true, // 长行仅在视图中自动换行
      enableFolding: true
    },
    'interaction:table': {
      enableSorting: false, // 禁用表格排序
      enableFiltering: true // 开启表格筛选
    }
  }
});
```

## API

`createMDxEditor` 返回实现 `IEditor` 公共接口的 `MDxEditor` 实例，您可以使用它来与编辑器进行交互。

-   `editor.getText(): string`: 获取当前编辑器的 Markdown 全文。
-   `editor.setText(markdown: string): void`: 设置编辑器的内容。
-   `editor.switchToMode(mode: 'edit' | 'render'): Promise<void>`: 切换编辑或渲染模式。
-   `editor.getHeadings(): Promise<Heading[]>`: 获取文档中的标题列表（用于大纲）。
-   `editor.setReadOnly(isReadOnly: boolean): void`: 设置编辑器为只读模式。
-   `editor.destroy(): Promise<void>`: 销毁编辑器实例并释放资源。
-   `editor.on(event, callback)`: 监听编辑器事件，如 `change` 或 `ready`。

## 📜 许可证

本项目基于 MIT 许可证。

## 独立运行与宿主适配

编辑器不依赖其他 `@itookit/*` 包。创建实例只需 DOM 容器与内容；附件、保存和持久化可按需注入公共接口，接口由 TypeScript 结构化匹配，无需继承特定实现。

```typescript
import { createMDxEditor, type AssetProvider } from '@itookit/mdxeditor';
import '@itookit/mdxeditor/style.css';

const assets: AssetProvider = {
  async read(name) {
    const response = await fetch(`/attachments/${encodeURIComponent(name)}`);
    return response.ok ? response.arrayBuffer() : null;
  },
};
async function saveContent(content: string): Promise<void> {
  localStorage.setItem('my-document', content);
}
const editor = await createMDxEditor(document.getElementById('editor-container')!, {
  initialContent: '# Hello',
  contentFormat: 'markdown',
  assets,
  onSave: async content => { await saveContent(content); },
});
```

`saveContent` 是宿主自己的保存函数。`EditorHost` 提供可选的打开文档、重命名和通知；`StoreFactory` 提供插件存储，默认使用内存。核心默认按 Markdown 处理，纯文本需显式传入 `contentFormat: 'text'`。

本仓库的 MindOS 使用 `@itookit/mdx-adapter` 的 `createMDxEditor` / `defaultEditorFactory`，接收 `ui-common` 的 `EditorOptions`，校验 namespace/Session 上下文并适配 VFS、附件、插件元数据及文件格式。`AssetManagerUI` 和 `LLMPrintService` 也由适配包导出。外部移动文件后调用适配实例的 `updateNodeId(newPath)`，更新后续保存、附件与元数据的文档路径。

适配包目前在 monorepo 内使用；独立用户可直接实现核心公共接口。适配包样式：`import '@itookit/mdx-adapter/style.css'`。

标签、提及与自动补全也支持用户提供数据：`TagPluginOptions.getTags`、`MentionProvider`、`AutocompleteProvider` 均由核心公开。用户可查询自己的 REST 服务、本地数据或其他存储，再通过 `plugins` 安装插件，无需引入 itookit 的业务服务。`translate` 可接入宿主 i18n；复杂交互可实现 `MDxPlugin`，通过插件上下文使用公开能力。

### 保存与生命周期

`onSave` 接收 Markdown 内容，保存失败时应抛出异常，使编辑器保留 dirty 状态。程序调用 `setText()` 后若需要保存，请显式标记修改：

```typescript
editor.setText('# Updated');
editor.setDirty(true);
await editor.save();
await editor.destroy();
```

用户编辑支持自动保存；`flushPendingSave()` 可在导航或引用内容前等待保存。标题栏的保存按钮通过 `core:titlebar.saveCallback` 配置，例如 `async editor => { await editor.save(); }`。

### 公共接口

| 能力 | 配置 | 使用者实现 |
|---|---|---|
| 附件 | `assets: AssetProvider` | 必需 `read(name)`；可选 `upload`、`prune`、`mimeType` |
| 插件存储 | `storeFactory: StoreFactory` | 为插件返回含 `get`、`set`、`remove` 的 `ScopedPersistenceStore`；默认内存存储 |
| 文档交互 | `host: EditorHost` | 可选 `openDocument`、`renameDocument`、`notify` |
| 保存 | `onSave` | 异步保存函数 |
| 文档标识 | `documentPath` | 移动文件后调用 `updateDocumentPath(newPath)`；可通过 `onDocumentPathChange` 接收更新 |
| 本地化 | `locale` / `translate` | 内置 `zh-CN`、`en`，或提供自己的翻译函数 |

以上类型均可从 `@itookit/mdxeditor` 根入口导入。接口采用结构化匹配，用户无需依赖 itookit 的 VFS、LLM 或上下文模块。未配置能力时，相关功能按需省略；核心默认把内容当作 Markdown，纯文本可显式设置 `contentFormat: 'text'`。

### 从旧宿主接口迁移

`0.5.0` 使用 `documentPath`、`assets`、`storeFactory`、`host` 和 `onSave` 接收能力，原 `target/files/hostContext` 应由宿主转成上述配置。核心的 `updateNodeId` 改为 `updateDocumentPath`；VFS 附件管理 UI 与会话专用打印迁入本仓库的 `mdx-adapter`。
