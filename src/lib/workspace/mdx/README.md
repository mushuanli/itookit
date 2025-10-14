
# MDxPage

**一个功能强大、高度可扩展的 Markdown 工作区解决方案，无缝集成笔记管理和富文本编辑。**

MDxPage 是一个前端 UI 库，它将功能丰富的 `SessionUI` (用于笔记/会话管理) 和强大的 `MDxEditor` (一个基于插件的 Markdown 编辑器) 组合成一个“开箱即用”的完整工作区组件。它旨在为需要构建知识库、笔记应用、文档中心或协作平台的开发者提供一个坚实、灵活的基础。

 <!-- 建议替换为真实的产品截图 -->

---

## ✨ 特性

-   **统一的工作区体验**: 将文件/目录管理和 Markdown 编辑融合在同一个组件中。
-   **强大的 Markdown 编辑**: 基于 [CodeMirror 6](https://codemirror.net/)，支持 GFM (GitHub Flavored Markdown)，并包含常用的格式化工具栏。
-   **所见即所得的预览**: 在编辑和预览模式之间无缝切换，支持滚动同步。
-   **灵活的会话管理**:
    -   支持文件夹和文件的树状结构。
    -   拖放式移动和组织。
    -   持久化存储（默认使用 LocalStorage）。
    -   强大的搜索和过滤功能。
-   **高度可扩展的 @mention 系统**:
    -   内置对内部文件 (`@file`) 和目录 (`@dir`) 的引用。
    -   支持自动补全、悬停预览和内容嵌入 (transclusion)。
    -   **完全可定制**: 轻松添加你自己的 mention 类型，如 `@user`, `@task` 或 `@app`。
-   **插件化架构**: 核心功能（如 Cloze 填空、数学公式、Mermaid 图表）都由插件提供，方便按需增删。
-   **简洁的 API**: 提供清晰的公共 API 和命令接口，易于与你的应用程序集成和控制。

## 📦 安装

目前，MDxPage 作为 ES 模块提供。你可以直接从源码或构建产物中导入。

```bash
# (未来) 通过 npm 安装
npm install @mdx/workspace
```

在你的 HTML 文件中，确保引入了必要的依赖（如 Marked.js, CodeMirror, Immer.js 等），然后导入库的主入口：

```html
<script type="module" src="path/to/your/app.js"></script>
```

```javascript
// app.js
import { MDxPage } from 'path/to/mdx-workspace/index.js';
```

## 🚀 快速上手

在你的 HTML 中创建两个容器，一个用于会话列表，一个用于编辑器。

```html
<div id="app-container">
    <aside id="sidebar-container"></aside>
    <main id="editor-container"></main>
</div>
```

然后在你的 JavaScript 中，用几行代码即可启动一个完整的工作区：

```javascript
import { MDxPage } from 'path/to/mdx-workspace/index.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. 获取容器元素
    const sidebarContainer = document.getElementById('sidebar-container');
    const editorContainer = document.getElementById('editor-container');

    // 2. 创建 MDxPage 实例
    const workspace = new MDxPage({
        sessionListContainer: sidebarContainer,
        editorContainer: editorContainer,
    });

    // 3. 监听 'ready' 事件，确保工作区已完全初始化
    workspace.on('ready', () => {
        console.log('MDxPage is ready to use!');
    });

    // 4. 启动工作区
    workspace.start();
});
```

就是这么简单！你现在就有了一个功能齐全、带数据持久化的 Markdown 工作区。

## 📘 API 文档

### `new MDxPage(options)`

创建 `MDxPage` 实例。

-   `options` (`object`): 配置对象。
    -   `sessionListContainer` (`HTMLElement`): **必需**。用于渲染会话列表的容器元素。
    -   `editorContainer` (`HTMLElement`): **必需**。用于渲染编辑器的容器元素。
    -   `documentOutlineContainer` (`HTMLElement`, 可选): 用于渲染文档大纲的容器。
    -   `plugins` (`MDxPlugin[]`, 可选): 一个 `MDxEditor` 插件数组，用于扩展默认的编辑器功能。
    -   `mentionProviders` (`(Function | IMentionProvider)[]`, 可选): 一个 mention provider 数组，用于添加或覆盖 `@mention` 功能。可以是 **Provider 类** 或 **工厂函数**。
    -   `editorOptions` (`object`, 可选): 直接传递给 `MDxEditor` 构造函数的额外选项。
    -   `sessionUIOptions` (`object`, 可选): 直接传递给 `SessionUI` 的额外选项。

### 实例方法

-   `workspace.start(): Promise<void>`
    启动工作区，初始化所有组件并加载数据。这是一个异步方法。

-   `workspace.on(eventName, callback): Function`
    监听工作区事件。返回一个取消监听的函数。
    -   `eventName` (`string`): 事件名称。
        -   `'ready'`: 工作区完全初始化并准备就绪时触发。
        -   `'sessionSelect'`: 当用户选择一个新会话时触发。`callback` 接收 `{ session }`。
        -   `'contentChange'`: 当编辑器内容被修改并自动保存后触发。`callback` 接收 `{ session, content }`。
    -   `callback` (`Function`): 事件处理函数。

-   `workspace.getContent(): string`
    获取当前编辑器中的 Markdown 内容。

-   `workspace.setContent(markdown: string): void`
    设置编辑器内容，并触发一次自动保存。

-   `workspace.getCurrentSession(): object | undefined`
    获取当前激活的会话对象。

-   `workspace.createSession(options: object): Promise<object>`
    创建一个新的会话。`options` 可包含 `title` 和 `parentId`。

-   `workspace.destroy(): void`
    销毁工作区实例，清理所有组件和事件监听器。

### `workspace.commands`

一个包含了所有可用编辑命令的对象，允许你通过程序控制编辑器。

**示例:**
```javascript
// 创建一个工具栏，并从外部控制编辑器
const boldButton = document.getElementById('bold-btn');
boldButton.addEventListener('click', () => {
    workspace.commands.toggleBold();
});

const insertTableButton = document.getElementById('insert-table-btn');
insertTableButton.addEventListener('click', () => {
    workspace.commands.insertTable();
});
```

**可用命令**: `toggleBold`, `toggleItalic`, `toggleStrikethrough`, `toggleHeading`, `toggleUnorderedList`, `toggleOrderedList`, `toggleTaskList`, `toggleBlockquote`, `applyCodeBlock`, `insertHorizontalRule`, `insertTable`, `insertImage`, `applyCloze`, 等等。

## 💡 高级用法：扩展 Mention 系统

这是 `MDxPage` 最强大的功能之一。你可以轻松地添加自定义的 `@mention` 类型。

**场景**: 添加一个 `@contact` mention，用于从联系人列表中选择人员。

**1. 创建你的 Provider 类**

你需要创建一个实现了 `IMentionProvider` 接口的类。

```javascript
// my-contact-provider.js
import { IMentionProvider } from 'path/to/mdx-editor/index.js';

// 假设你有一个获取联系人数据的方法
const contactAPI = {
    async search(query) {
        return [
            { id: 'u1', name: 'Alice', email: 'alice@example.com' },
            { id: 'u2', name: 'Bob', email: 'bob@example.com' },
        ].filter(c => c.name.toLowerCase().includes(query.toLowerCase()));
    },
    async findById(id) {
        // ...
    }
};

export class MyContactProvider extends IMentionProvider {
    key = 'contact'; // 对应 @contact:u1
    triggerChar = '@';

    async getSuggestions(query) {
        const contacts = await contactAPI.search(query);
        return contacts.map(contact => ({
            id: contact.id,
            label: `👤 ${contact.name}`
        }));
    }

    async getHoverPreview(targetURL) {
        const contactId = targetURL.pathname.substring(1);
        const contact = await contactAPI.findById(contactId);
        if (contact) {
            return {
                title: contact.name,
                contentHTML: `<p>Email: ${contact.email}</p>`,
                icon: '👤'
            };
        }
        return null;
    }
}
```

**2. 将 Provider 注入到 Workspace**

在初始化 `MDxPage` 时，通过 `mentionProviders` 选项传入你的 Provider **类**。

```javascript
import { MDxPage, DirMentionProvider, FileMentionProvider } from '@mdx/workspace';
import { MyContactProvider } from './my-contact-provider.js';

const workspace = new MDxPage({
    sessionListContainer: document.getElementById('sidebar-container'),
    editorContainer: document.getElementById('editor-container'),

    mentionProviders: [
        // 保留默认的 providers
        DirMentionProvider,
        FileMentionProvider,
        // 添加你自己的 provider
        MyContactProvider
    ]
});

workspace.start();
```

现在，你的工作区编辑器就自动支持 `@contact` 补全和预览了！

## 🤝 贡献

我们欢迎各种形式的贡献！如果你发现了 bug、有功能建议或想改进文档，请随时提交 [Issue](https://github.com/your-repo/mdx-workspace/issues) 或 [Pull Request](https://github.com/your-repo/mdx-workspace/pulls)。

## 📜 开源许可

本项目采用 [MIT License](./LICENSE)。