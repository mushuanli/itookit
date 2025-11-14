# MDxEditor: 下一代可扩展 Markdown 编辑与渲染引擎

**MDxEditor** 是一个功能强大的 JavaScript 库，提供了一套完整、现代化的 Markdown 编辑和渲染解决方案。它并非又一个简单的解析器，而是一个以**插件为中心**、**服务驱动**、高度可扩展的内容处理平台，专为需要深度定制和丰富交互的复杂应用场景而设计。

我们的核心设计哲学是：**内核只做编排，功能皆由插件贡献**。

这种架构赋予了您无与伦比的灵活性。无论您是想构建：
*   一个类似 Anki 的**记忆卡片应用**（需要 Cloze 填空和自定义交互）
*   一个类似 Obsidian 的**双向链接知识库**（需要强大的提及和嵌入系统）
*   一个**交互式文档或教程系统**
*   一个 AI Agent 的**流式响应渲染界面**
*   一个**后端的文档转换服务** (例如，将包含特殊指令的 Markdown 转换为另一种格式)

MDxEditor 都能为您提供坚如磐石的基础。

![MDxEditor 动画演示](https://user-images.githubusercontent.com/12345/placeholder.gif)  
*(请替换为展示 @mention、Cloze 交互、双向跳转和工具栏的 GIF 动画)*

## ✨ 核心特性

*   **编辑与预览无缝切换**: 提供一个集成的视图，用户可以在源码编辑和实时预览之间流畅切换，并支持**像素级同步滚动**。
*   **统一的程序化搜索 API**: 无论是在编辑模式还是预览模式，都提供了一套简单易用的 API (`search`, `gotoMatch`, `clearSearch`)，允许外部 UI 组件轻松实现对内容的查找、高亮和定位功能。
*   **源码-预览双向链接**: 在预览模式下，按住 `Ctrl/Cmd` 并双击任意元素（如段落、填空），即可**精准跳转**到其对应的源码位置，极大提升了内容维护效率。
*   **高度可配置的 UI**: 除了强大的工具栏，还提供了一个可定制的**标题栏**，可以轻松添加自定义操作按钮，如 AI 处理、保存、打印等，并将它们与您的应用逻辑深度集成。
*   **插件化架构 (Plugin-Driven Architecture)**: 核心库轻量稳定，所有高级功能（包括提及、图表、公式等）均由**独立的插件**提供。您可以按需组合，甚至编写自己的插件来扩展无限可能。
*   **世界级的提及与内容链接系统 (`@mention`)**:
    *   **智能建议**: 输入 `@` (或其他可配置的触发符) 即可从一个或多个数据源获得上下文相关的建议列表。
    *   **悬浮预览**: 将鼠标悬停在提及链接上，即可查看由数据源提供的丰富内容预览卡片。
    *   **内容嵌入 (Transclusion)**: 使用 `!@type:id` 语法将其他文档或内容块直接嵌入到当前文档中。
    *   **引用自动更新**: 当被引用的项目（如文件名）发生变化时，编辑器内的所有相关提及链接都会**自动更新**其显示文本，解决了链接失效的痛点。
    *   **完全可扩展**: 通过实现一个简单的 `Provider` 接口，您可以轻松添加对任何内容源的支持，例如 `@user`、`#jira-ticket`、`!file` 或您自己的业务对象。
*   **两种渲染模式**:
    *   **静态块渲染 (Static Rendering)**: 一次性将完整的 Markdown 文本渲染成 HTML，适用于文章、文档等场景。
    *   **流式渲染 (Streaming Rendering)**: 动态地将文本块追加到视图中并实时渲染，完美适配 AI 对话、日志流等需要增量更新的场景。
*   **`MDxProcessor`: 强大的无头处理引擎**:
    *   **与UI完全解耦**: 在 Node.js 或任何非浏览器环境中使用 MDxEditor 的核心解析与转换能力。
    *   **声明式转换规则**: 通过简单的配置对象，精确控制每种 `@mention` 在处理后的行为——是**替换**为特定内容、从文本中**移除**，还是保持**原样**。
    *   **元数据提取**: 在转换文本的同时，自动提取所有提及（mention）的结构化信息，用于后续分析或API调用。
*   **丰富的语法支持 (由内置插件提供)**:
    *   **Cloze (完形填空)**: ` --内容--` 创建交互式填空，并可通过 `^^audio:text^^` 添加语音提示。
    *   **GFM 任务列表**: `- [ ]` 和 `- [x]` 创建可交互的任务清单。
    *   **图表与公式**: 内置支持 **Mermaid** 图表和 **MathJax** 公式。
    *   **可折叠内容块**: `::>` 语法创建可以展开和收起的内容区域。
    *   **媒体嵌入**: `!video[...]` 和 `!file[...]` 轻松嵌入视频和文件附件。

## 🚀 快速上手

### 1. 环境准备

通过 npm/yarn 安装 MDxEditor。
```bash
npm install mdx-editor-lib # 假设包名为 mdx-editor-lib
```

在您的 HTML 页面中，确保已引入核心依赖。MDxEditor 采用模块化设计，不捆绑这些大型库，让您可以自由选择版本或加载方式。
```html
<!-- 核心依赖 -->
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>

<!-- 可选依赖 (根据您启用的插件选择) -->
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
<!-- Font Awesome (用于标题栏和工具栏图标) -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">


<!-- 您的应用入口，将从这里导入 MDxEditor -->
<script type="module" src="./app.js"></script>
```

### 2. 基本用法：静态渲染

创建一个渲染器，将 Markdown 文本渲染到页面元素中。

```html
<div id="output"></div>
```

```javascript
// app.js
import { MDxRenderer, defaultPlugins } from 'mdx-editor-lib';

// 1. 创建渲染器实例，并加载默认插件包
const renderer = new MDxRenderer(defaultPlugins);

// 2. 获取目标元素和 Markdown 文本
const outputElement = document.getElementById('output');
const markdown = `# 标题\n\n这是一个 --cloze-- 填空，和一个 Mermaid 图表：\n\n\`\`\`mermaid\ngraph TD;\n    A-->B;\n\`\`\``;

// 3. 执行渲染
renderer.render(outputElement, markdown);
```

### 3. 高级用法：集成编辑器

创建一个功能完备的编辑器，包含工具栏、**可配置的标题栏**、编辑/预览切换和所有默认功能。

```html
<div id="editor-container" style="height: 600px;"></div>
```

```javascript
// app.js
import { MDxEditor, defaultPlugins } from 'mdx-editor-lib';

const container = document.getElementById('editor-container');
const initialText = `# 欢迎使用 MDxEditor!\n\n选择文本，然后点击标题栏上的 ✨ AI 按钮。\n或者直接点击 💾 保存按钮。`;

// 创建编辑器实例
const editor = new MDxEditor(container, {
    initialText: initialText,
    plugins: defaultPlugins, // 加载包含所有功能的插件包
    
    // [新功能] 配置标题栏
    titleBar: {
        title: 'My Document.md', // 设置文档标题

        // 提供 AI 回调函数后，AI 按钮会自动显示
        aiCallback: (text) => {
            alert(`AI 正在处理以下文本 (如果是选中文本，则只处理选中的部分):\n\n---\n${text}\n---`);
            // 在这里，您可以调用您的实际 AI 服务
        },

        // 提供保存回调函数后，保存按钮会自动显示
        saveCallback: (text) => {
            console.log('正在保存内容:', text);
            alert('内容已保存到控制台！');
            // 在这里，您可以将文本发送到后端或本地存储
        }
    }
});
```

## 🛠️ **核心功能：无头处理与内容转换 (`MDxProcessor`)**

这是 MDxEditor 最强大的功能之一，它允许您在后端或任何非UI环境中使用其核心解析能力。

### 场景

假设您有一段包含特殊指令的 Markdown，您希望：
1.  提取出 `@app` 指令作为元数据。
2.  将 `@file` 指令替换为其真实的文件内容。

**原始 Markdown (`input.md`):**
```markdown
@app:parserai
here is the demo file:
@file:file1
```

**期望的输出:**
- **转换后的文本:** `here is the demo file:\n---\n[filename: file1]\n---\nhello world\n---`
- **提取的元数据:** `{ app: ['parserai'], file: ['file1'] }`

### 实现

```javascript
// processor-example.js (可以在 Node.js 中运行)
import { MDxProcessor, IMentionProvider } from 'mdx-editor-lib';

// 1. [定义数据源] 创建 Provider，它们只负责提供原始数据。
class AppProvider extends IMentionProvider {
    key = 'app';
    // 在无头模式下，我们只关心数据，所以只实现 getDataForProcess
    async getDataForProcess(targetURL) {
        // targetURL.pathname is '/parserai'
        return { id: targetURL.pathname.substring(1) };
    }
}

class FileProvider extends IMentionProvider {
    key = 'file';
    async getDataForProcess(targetURL) {
        const fileId = targetURL.pathname.substring(1); // '/file1' -> 'file1'
        // 模拟数据库或文件系统查找
        const fileDatabase = {
            'file1': 'hello world'
        };
        const content = fileDatabase[fileId];
        return content ? { id: fileId, name: fileId, content } : null;
    }
}

// 2. [初始化] 创建 Processor 实例，并传入 Providers
const processor = new MDxProcessor([new AppProvider(), new FileProvider()]);

// 3. [定义规则] 创建一个 ProcessOptions 对象，声明式地定义转换行为
const markdownText = `@app:parserai\nhere is the demo file:\n@file:file1`;
const options = {
    rules: {
        'app': {
            action: 'remove',       // 从文本中移除 @app:parserai
            collectMetadata: true,  // 并将其 ID 'parserai' 收集到元数据中
        },
        'file': {
            action: 'replace',      // 将 @file:file1 替换为自定义内容
            collectMetadata: true,  // 同样收集其 ID
            // 定义如何生成替换内容
            getReplacementContent: (data, mention) => {
                if (!data) return `[File not found: ${mention.id}]`;
                return `---\n[filename: ${data.name}]\n---\n${data.content}\n---`;
            }
        }
    }
};

// 4. [执行] 调用 process 方法
processor.process(markdownText, options).then(result => {
    console.log('--- Transformed Content ---');
    console.log(result.transformedContent);

    console.log('\n--- Extracted Metadata ---');
    console.log(result.metadata);

    /*
    --- Transformed Content ---
    here is the demo file:
    ---
    [filename: file1]
    ---
    hello world
    ---

    --- Extracted Metadata ---
    { app: [ 'parserai' ], file: [ 'file1' ] }
    */
});
```
`MDxProcessor` 为您提供了将一种标记语言转换为另一种结构化数据和文本的强大而灵活的工具。

---

## 🔌 插件化架构：按需定制

MDxEditor 的真正威力在于其插件系统。以下示例展示了如何配置一个带有自定义 `@mention` 功能的编辑器。

```javascript
// app.js
import { 
    MDxEditor, 
    MDxRenderer,
    MentionPlugin,
    IMentionProvider
} from 'mdx-editor-lib';

// 1. [您的业务逻辑] 创建一个自定义 Provider 来提供数据
// Provider 实现了 UI 和无头处理所需的所有方法
class FileMentionProvider extends IMentionProvider {
    key = 'file'; // 必须的唯一标识符, 对应 mdx://file/...
    triggerChar = '@';

    async getSuggestions(query) {
        // 在实际应用中，这里会发起 API 请求搜索文件
        const files = [
            { id: 'doc-123', name: 'Project Proposal.md' },
            { id: 'img-456', name: 'Company Logo.png' }
        ];
        return files
            .filter(f => f.name.toLowerCase().includes(query.toLowerCase()))
            .map(f => ({ id: f.id, label: `📄 ${f.name}` })); // 返回指定格式
    }

    // (用于 MDxProcessor) 提供核心数据
    async getDataForProcess(targetURL) {
        const fileId = targetURL.pathname.substring(1);
        // ... 查找文件并返回数据对象
        return { id: fileId, name: 'Proposal.md', content: '...' };
    }
}

// 2. 实例化 Mention 插件
const mentionPlugin = new MentionPlugin({ providers: [new FileMentionProvider()] });

// 3. 创建编辑器实例，并传入插件
const editor = new MDxEditor(container, {
    renderer: new MDxRenderer([mentionPlugin]),
    plugins: [mentionPlugin],
    initialText: '请在这里引用文件 @'
});
```

## 📚 核心 API

### `MDxProcessor`

#### `new MDxProcessor(providers)`
创建一个无头处理器实例。
- `providers` (Array): 一个 `IMentionProvider` 实例的数组。

#### `processor.process(markdownText, options)`
处理 Markdown 文本。
- `markdownText` (String): 原始 Markdown 文本。
- `options` (ProcessOptions): 定义转换规则的配置对象。
- **返回**: `Promise<ProcessResult>`，一个包含 `originalContent`, `transformedContent`, `mentions`, 和 `metadata` 的对象。

### `MDxRenderer`

#### `new MDxRenderer(plugins)`
创建一个渲染器实例。
- `plugins` (Array): 一个插件实例的数组。

#### `renderer.render(element, markdown, options)`
渲染 Markdown。
- `element` (HTMLElement): 渲染结果的目标容器。
- `markdown` (String): 要渲染的 Markdown 文本。
- `options` (Object): 渲染选项，可以传递给插件。例如，控制 Cloze 状态：
  ```javascript
  const options = {
      contextId: 'my-context',
      clozeStates: {
          'my-context_hash123': { isHidden: false, memoryTier: 'mature' }
      }
  };
  ```
### `MDxEditor` 和 `MDxRenderer` 实例 API

`MDxEditor` 和 `MDxRenderer` 共享一套相似的公共 API 用于内容控制和交互。

```javascript
const editor = new MDxEditor(container, options);
const renderer = new MDxRenderer(plugins);
```

#### `instance.search(query)`
查找所有匹配项并高亮。
- `query` (String): 要搜索的文本。
- **返回**: `Array`。对于 `MDxEditor`，返回 `{ from, to }` 位置对象数组。对于 `MDxRenderer`，返回高亮的 `<mark>` DOM 元素数组。

#### `instance.gotoMatch(match)`
跳转到指定的匹配项并高亮显示为“当前项”。
- `match`: 一个从 `search()` 方法返回的项。

#### `instance.clearSearch()`
清除所有搜索高亮。

*示例：实现一个带“下一个”功能的外部搜索框*
```html
<input id="search-input" placeholder="搜索...">
<button id="next-btn">下一个</button>
<span id="match-counter"></span>
```
```javascript
// `instance` 可以是 editor 或 renderer
const searchInput = document.getElementById('search-input');
const nextBtn = document.getElementById('next-btn');
const counter = document.getElementById('match-counter');

let matches = [];
let currentIndex = -1;

searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (query) {
        matches = instance.search(query);
        currentIndex = -1;
        counter.textContent = `找到 ${matches.length} 个匹配项`;
    } else {
        instance.clearSearch();
        matches = [];
        counter.textContent = '';
    }
});

nextBtn.addEventListener('click', () => {
    if (matches.length === 0) return;
    currentIndex = (currentIndex + 1) % matches.length;
    instance.gotoMatch(matches[currentIndex]);
    counter.textContent = `第 ${currentIndex + 1} / ${matches.length} 个`;
});
```

#### `editor.switchTo(mode)`
切换编辑器的视图。
- `mode` (String): `'edit'` 或 `'render'`。

#### `instance.getText()`
获取当前完整的 Markdown 文本。
- **返回**: `String`

#### `instance.setText(markdownText)`
用新的文本内容替换所有内容。

#### `editor.setTitle(newTitle)`
**[新功能]** 动态更新编辑器标题栏中显示的标题。这在与外部文档管理系统（如文件树）集成时非常有用。
- `newTitle` (String): 要显示的新标题。

*示例：与文件列表集成*
```javascript
// fileList 是你的文件列表UI组件
fileList.on('fileSelected', (file) => {
    editor.setText(file.content);
    editor.setTitle(file.name); // 更新标题以匹配所选文件
});
```

#### `editor.handleExternalUpdate({ uri, newLabel })`
**[关键 API]** 通知编辑器外部引用已更新，实现**引用自动更新**。
- `payload` (Object):
  - `uri` (String): 被更新项目的完整 MDx URI, e.g., `'mdx://file/doc-123'`。
  - `newLabel` (String): 新的显示文本。

*示例：当用户在文件系统中重命名文件时*
```javascript
// 假设用户在别处将 'Project Proposal.md' 重命名为 'Final Proposal.md'
// 您的文件系统监听到了这个变化
const updatePayload = {
    uri: 'mdx://file/doc-123',
    newLabel: '📄 Final Proposal.md'
};
// 通知编辑器更新所有相关的 `[...](mdx://file/doc-123)` 链接
editor.handleExternalUpdate(updatePayload);
```

#### `editor.destroy()`
销毁编辑器实例，释放所有资源，包括 CodeMirror 实例和事件监听器，防止内存泄漏。

#### `editor.on(eventName, callback)`
**[新功能]** 监听编辑器的核心事件，如内容变更。
- `eventName` (String): 目前支持 `'change'` 事件。
- `callback` (Function): 事件触发时的回调函数。
- **返回**: 一个 `unsubscribe` 函数。

*示例：实现自动保存*
```javascript
let saveTimeout;
editor.on('change', () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        const content = editor.getText();
        // myApi.save(content);
        console.log('内容已自动保存！');
    }, 500); // 500ms 防抖
});
```

### 插件间的交互：服务与事件
插件可以通过**服务 (Services)** 和**事件 (Events)** 进行解耦通信。例如，一个用于抽认卡的自定义插件可以监听 `clozeRevealed` 事件，并在用户回答后，通过注入的 `ClozeAPI` 服务来重新隐藏填空。

```javascript
// anki-plugin.js
import { ClozeAPIKey } from 'mdx-editor-lib';

// 监听由 ClozePlugin 发出的全局事件
editor.pluginManager.listen('clozeRevealed', (detail) => {
    console.log(`填空 "${detail.clozeId}" 已被揭示！`);
    
    // 显示一个评分 UI...
    showFeedbackUI(detail.element, (userChoice) => {
        if (userChoice === 'again') {
            // 通过注入的 ClozeAPI 服务来安全地操作 DOM
            const clozeApiFactory = editor.getService(ClozeAPIKey);
            if (clozeApiFactory) {
                const clozeApi = clozeApiFactory(editor.renderEl);
                clozeApi.toggle(detail.clozeId, false); // 重新关闭该填空
            }
        }
    });
});
```
这种设计使得复杂功能可以被任意组合和扩展，而不会导致代码混乱。

## 🛠️ 开发自己的插件

### 1. 简单语法插件
创建一个插件非常简单，只需实现 `install` 方法。这是一个添加 `||spoiler||` 剧透语法的插件示例：

```javascript
// plugins/spoiler.plugin.js

// 1. 定义 Marked.js 语法扩展
const spoilerExtension = {
    name: 'spoiler',
    level: 'inline',
    start: (src) => src.indexOf('||'),
    tokenizer(src) {
        const match = /^\|\|(.*?)\|\|/.exec(src);
        if (match) {
            return { type: 'spoiler', raw: match[0], text: match[1] };
        }
    },
    renderer(token) {
        // 添加点击切换 class 的简单交互
        return `<span class="spoiler" onclick="this.classList.toggle('revealed')">${token.text}</span>`;
    }
};

// 2. 创建插件类
export class SpoilerPlugin {
    name = 'custom:spoiler'; // 唯一的插件名称

    install(context) {
        // 3. 通过上下文 API 注册你的功能
        context.registerSyntaxExtension(spoilerExtension);
    }
}
```

### 2. 实现高级交互：提供者模式 (Provider Pattern)
对于像 `@mention` 这样需要与外部数据源交互的复杂功能，MDxEditor 采用了**提供者模式**。您只需实现 `IMentionProvider` 接口，即可同时为编辑器UI和无头处理器提供能力。

```javascript
// providers/jira-ticket.provider.js
import { IMentionProvider } from 'mdx-editor-lib';

export class JiraTicketProvider extends IMentionProvider {
    key = 'jira'; // 对应 mdx://jira/...
    triggerChar = '#'; // 可以自定义触发符！

    // 根据用户输入获取建议列表
    async getSuggestions(query) {
        const response = await fetch(`/api/jira/search?q=${query}`);
        const tickets = await response.json();
        return tickets.map(t => ({ id: t.key, label: `${t.key}: ${t.summary}` }));
    }

    // [可选] 定义点击链接时的行为
    async handleClick(targetURL) {
        const ticketId = targetURL.pathname.substring(1);
        window.open(`https://my-jira.com/browse/${ticketId}`);
    }

    // [可选] 提供悬浮预览的内容
    async getHoverPreview(targetURL) {
        const ticketId = targetURL.pathname.substring(1);
        const response = await fetch(`/api/jira/ticket/${ticketId}`);
        const ticket = await response.json();
        return {
            title: `${ticket.key}: ${ticket.summary}`,
            contentHTML: `<p>Status: <strong>${ticket.status}</strong></p><p>Assignee: ${ticket.assignee.name}</p>`
        };
    }
}
```
通过这种方式，您可以将任何数据源无缝集成到 MDxEditor 的提及、链接和嵌入生态系统中，同时服务于前端交互和后端处理两种场景。

## 🤝 贡献

我们欢迎任何形式的贡献，包括 Bug 报告、功能请求或代码提交。请在开始工作前查阅我们的贡献指南（待补充），并在 GitHub 上创建 Issue 或 Pull Request。

## 📜 许可证

本项目采用 [MIT License](./LICENSE)。