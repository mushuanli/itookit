# @itookit/mdxeditor

![npm version](https://img.shields.io/npm/v/@itookit/mdxeditor.svg)
![license](https://img.shields.io/npm/l/@itookit/mdxeditor.svg)

一个功能强大、由插件驱动、基于 CodeMirror 6 的 MDX 编辑器组件，专为可扩展性和富内容创作而设计。

`@itookit/mdxeditor` 提供了一个完整的解决方案，集成了强大的 CodeMirror 6 编辑核心和一个基于 `marked` 的可扩展渲染器。它通过灵活的插件系统，实现了编辑和预览两种模式，并内置了大量开箱即用的功能。

## ✨ 核心特性

- **🚀 双模式操作**: 在原生 Markdown/MDX 编辑器 (CodeMirror 6) 和精美的渲染视图之间无缝切换。
- **🧩 可扩展的插件系统**: 包含丰富的内置插件，并提供简单的 API 来创建您自己的插件，轻松定制编辑器功能。
- **📚 丰富的语法支持**:
  - 通过 **MathJax** 支持 LaTeX 数学公式 (`$...$` 和 `$$...$$`)。
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
- **💾 灵活集成**: 设计用于与持久化层和虚拟文件系统 (`@itookit/vfs-core`) 协同工作。

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
    import '@itookit/mdxeditor/styles/default.css'; 
    // 如果使用了 FontAwesome 图标，请确保已引入
    // import '@fortawesome/fontawesome-free/css/all.min.css';

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
    'cloze',      // 添加 Cloze 插件
    'memory',     // 添加 SRS 记忆插件
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

-   **启用插件**: 在 `plugins` 数组中添加插件名称 (e.g., `'cloze'`)。
-   **禁用默认插件**: 在插件名称前添加 `-` (e.g., `'-mermaid'`)。
-   **禁用所有默认插件**: 将 `'-all'` 作为 `plugins` 数组的第一个元素。

##🔌 核心插件

下表列出了一些核心插件及其功能。

| 插件名称                  | 描述                                             | 默认启用 |
| ------------------------- | ------------------------------------------------ | :------: |
| `ui:toolbar`              | 渲染主工具栏。                                   |    ✅    |
| `ui:formatting`           | 添加标准格式化按钮（粗体、斜体等）。             |    ✅    |
| `core:titlebar`           | 添加标题栏及按钮（保存、打印等）。               |    ❌    |
| `mathjax`                 | 渲染 LaTeX 数学公式。                            |    ✅    |
| `mermaid`                 | 在代码块中渲染 Mermaid 图表。                    |    ✅    |
| `folder`                  | 添加对可折叠内容块 (`::>`) 的支持。              |    ✅    |
| `media`                   | 添加自定义 `!video` 和 `!file` 语法。            |    ✅    |
| `task-list`               | 使 Markdown 任务列表可交互。                     |    ✅    |
| `codeblock-controls`      | 为代码块添加复制/下载/折叠按钮。                 |    ✅    |
| `interaction:source-sync` | 在渲染视图中按住 Ctrl/Cmd 并双击以跳转到源码。     |    ✅    |
| `cloze`                   | Anki 风格的挖空填词功能。                        |    ❌    |
| `cloze-controls`          | 为挖空填词提供导航和控制 UI。                    |    ❌    |
| `memory`                  | 为挖空填词添加间隔重复 (SRS) 评分功能。          |    ❌    |
| `autocomplete:tag`        | 提供标签的自动完成 (e.g., `#tag`)。              |    ❌    |
| `autocomplete:mention`    | 提供提及的自动完成 (e.g., `@user`)。             |    ❌    |

## API

`createMDxEditor` 返回一个 `MDxEditor` 实例，您可以使用它来与编辑器进行交互。

-   `editor.getText(): string`: 获取当前编辑器的 Markdown 全文。
-   `editor.setText(markdown: string): void`: 设置编辑器的内容。
-   `editor.switchToMode(mode: 'edit' | 'render'): void`: 切换编辑或渲染模式。
-   `editor.getHeadings(): Promise<Heading[]>`: 获取文档中的标题列表（用于大纲）。
-   `editor.setReadOnly(isReadOnly: boolean): void`: 设置编辑器为只读模式。
-   `editor.destroy(): void`: 销毁编辑器实例并释放资源。
-   `editor.on(event, callback)`: 监听编辑器事件，如 `change` 或 `ready`。

## 📜 许可证

本项目基于 [MIT](LICENSE) 许可证。