import '@itookit/mdxeditor/style.css';
import { createMDxEditor } from '@itookit/mdxeditor';

// 由于这是演示，我们直接在这里实现简化版本

// 初始化示例内容
const initialContent = `# MDxEditor 演示文档

欢迎使用 **MDxEditor**！这是一个功能强大的、插件化的 Markdown 编辑器。

---

## 🎨 新增可视化扩展 (Visual Extensions)

MDxEditor 支持多种丰富的可视化格式，不仅限于标准的 Markdown。

### 1. 提示块 (Callouts) - 由 \`CalloutPlugin\` 提供
支持 GitHub/Obsidian 风格的提示块语法 \`> [!TYPE]\`。

> [!NOTE]
> **这是一个笔记**
> 提示块非常适合用来强调重要信息，或者区分不同类型的上下文。

> [!TIP]
> **小技巧**
> 你可以使用不同的类型，如 \`TIP\`, \`WARNING\`, \`DANGER\`, \`SUCCESS\` 等。

> [!DANGER]
> **注意安全**
> 这是一个危险警告！

### 2. SVG 渲染 - 由 \`SvgPlugin\` 提供
你可以直接在代码块中编写 SVG 代码，编辑器将其渲染为矢量图形。

\`\`\`svg
<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f0f0f0" rx="10" ry="10"/>
  <circle cx="50" cy="50" r="30" fill="#ef476f" />
  <rect x="100" y="20" width="60" height="60" fill="#118ab2" rx="5" />
  <text x="100" y="95" font-family="Arial" font-size="12" fill="#333">MDx SVG</text>
</svg>
\`\`\`

### 3. PlantUML 绘图 - 由 \`PlantUMLPlugin\` 提供
除了 Mermaid，现在还支持专业的 UML 绘图工具 PlantUML。

\`\`\`plantuml
@startuml
skinparam backgroundColor transparent
skinparam handwritten true

actor User
participant "MDx Editor" as Editor
participant "Plugin System" as Plugins
participant "Renderer" as View

User -> Editor: 输入 Markdown
Editor -> Plugins: 处理语法扩展
Plugins -> Plugins: 解析 Callouts/SVG/PlantUML
Plugins --> Editor: 返回处理结果
Editor -> View: 更新 DOM
View --> User: 显示可视化结果
@enduml
\`\`\`

### 4. Vega 数据可视化 - 由 \`VegaPlugin\` 提供
支持 Vega-Lite 语法进行数据绘图。

\`\`\`vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "description": "A simple bar chart with embedded data.",
  "data": {
    "values": [
      {"a": "A", "b": 28}, {"a": "B", "b": 55}, {"a": "C", "b": 43},
      {"a": "D", "b": 91}, {"a": "E", "b": 81}, {"a": "F", "b": 53},
      {"a": "G", "b": 19}, {"a": "H", "b": 87}, {"a": "I", "b": 52}
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": {"field": "a", "type": "nominal", "axis": {"labelAngle": 0}},
    "y": {"field": "b", "type": "quantitative"}
  }
}
\`\`\`

---

## ⚡ 自动完成 (Autocomplete) 新功能

MDxEditor 现在集成了强大的自动完成系统，支持标签和提及功能。

### 1. 标签 (Tags) - 由 \`TagPlugin\` 提供

*   **如何操作**: 在编辑器中输入 \`#\` 符号，然后开始输入。例如，尝试输入 \`#java\` 或 \`#re\`。
*   **功能**: 会弹出一个建议列表，供您快速插入预定义的标签。
*   **示例**: #javascript #react #bugfix

### 2. 提及 (Mentions) - 由 \`MentionPlugin\` 提供

提及功能支持多种数据源，并提供丰富的交互体验。

#### @ 提及用户

*   **如何操作**: 输入 \`@\` 符号，然后输入用户名，例如 \`@John\` 或 \`@an\`。
*   **功能**:
    1.  **自动完成**: 从列表中选择用户。
    2.  **悬浮预览**: 在 **预览模式** 下，将鼠标悬停在提及链接上，会显示用户的预览卡片。
    3.  **点击事件**: 在 **预览模式** 下，点击提及链接会触发自定义事件（在本示例中会弹出一个提示框）。
*   **示例**: 让我们 @[John Doe](mdx://users/john) 来审查代码，并通知 @[Anna Smith](mdx://users/anna)。

#### @@ 提及文档

*   **如何操作**: 输入 \`@@\` 符号，然后输入文档标题，例如 \`@@Project\`。
*   **功能**: 与用户提及类似，支持自动完成、悬浮预览和点击。
*   **示例**: 请参考设计文档 @@[Project Plan](mdx://docs/proj-plan) 和技术规范 @@[API Design V2](mdx://docs/api-v2)。

### 3. 内容嵌入 (Transclusion)

*   **如何操作**: 使用 \`!@provider:id\` 语法。例如，输入 \`!@docs:proj-plan\`。
*   **功能**: 在 **预览模式** 下，这行语法会被替换为对应文档的完整内容。
*   **示例**:

下面是 "Project Plan" 文档的嵌入内容：
!@docs:proj-plan

---

## ✨ 其他核心功能

### 1. 标题栏与侧边栏交互

*   **功能**: 编辑器顶部的标题栏现在由 \`core:titlebar\` 插件驱动。它提供了一组可配置的核心操作按钮。
*   **如何操作**:
    1.  点击标题栏左上角的 **汉堡菜单图标** (<i class="fas fa-bars"></i>)。
    2.  观察左侧的“会话列表”侧边栏会平滑地展开和收起。
    3.  这是通过在编辑器配置中传入 \`toggleSidebarCallback\` 实现的，展示了编辑器与外部 UI 解耦的能力。

### 2. 源码同步跳转

*   **功能**: 在预览模式下，快速从渲染后的内容跳转到对应的 Markdown 源码位置，由 \`interaction:source-sync\` 插件提供支持。
*   **如何操作**:
    1.  首先，确保你处于 **预览模式** (点击标题栏的 <i class="fas fa-book-open"></i> 图标切换)。
    2.  按住键盘上的 \`Ctrl\` 键 (Windows/Linux) 或 \`Cmd\` 键 (Mac)。
    3.  在按住不放的同时，**用鼠标双击本段落中的任意文字**。
    4.  编辑器会自动切换回 **编辑模式**，并高亮你刚才双击的文本所在的源码行。

---

## 丰富的功能集

### 交互式任务列表 (Task List)
在预览模式下，直接点击下方的复选框，可以修改任务状态。这个更改会 **自动同步** 回 Markdown 源码。

- [ ] 学习 MDxEditor 的插件系统。
- [x] 审查 codeblock-controls 插件的实现。
- [ ] 为项目贡献代码。

---

### 图表绘制 (Mermaid)
使用 Mermaid 语法可以直接在 Markdown 中绘制流程图、序列图等。
\`\`\`mermaid
graph TD;
    A[开始] --> B{检查内容};
    B -- 内容有效 --> C[渲染预览];
    B -- 内容无效 --> D[显示错误];
    C --> E[完成];
    D --> E[完成];
\`\`\`

### 媒体嵌入 (Media)
使用 \`!video[标题](链接)\` 语法嵌入视频，或使用 \`!file[文件名](链接)\` 嵌入可下载的文件。

!video[Big Buck Bunny 演示视频](http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4)

!file[项目文档.pdf](https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf)

## 挖空填词 (Cloze) 功能

这是通过 'cloze' 插件启用的新功能。在预览模式下，点击 --挖空部分-- 即可显示答案。

- **基本用法**: --太阳-- 是太阳系的中心。
- **带 ID**: [c1]--地球-- 是我们居住的行星。
- **带音频**: 法语单词 "你好" 的发音是 --Bonjour--^^audio:Bonjour^^。
- **多行内容**: 
  Markdown 是一种 --轻量级标记语言--，由 --John Gruber-- 创建。

---

## 其他功能

### 1. 基础 Markdown 语法

支持所有标准 Markdown 语法：

- **粗体文本**
- *斜体文本*
- ~~删除线~~
- \`行内代码\`
- [链接](https://example.com)
- [ ] 选择框

### 2. 代码块

\`\`\`javascript
function hello(name) {
  // 代码块高度超过阈值时，会出现复制、下载和折叠按钮
  console.log(\`Hello, \${name}!\`);
  return true;
}

hello('World');
\`\`\`

### 3. 数学公式

行内公式：质能方程 $E = mc^2$ 是物理学中最著名的公式之一。

公式块：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

欧拉公式：

$$
e^{i\\pi} + 1 = 0
$$

### 4. 引用

> 这是一段引用文本。
> 
> 可以包含多行内容。

### 5. 列表

#### 无序列表
- 项目 1
- 项目 2
  - 子项目 2.1
  - 子项目 2.2
- 项目 3

#### 有序列表
1. 第一步
2. 第二步
3. 第三步

### 6. 可折叠块 (由 Folder 插件提供)

::> 点击这里展开/折叠
    这里是 **可以折叠** 的内容。
    - 支持列表
    - 支持各种 Markdown 语法


### 7. 表格

| 功能 | 状态 | 说明 |
|------|------|------|
| 编辑模式 | ✅ | 支持 CodeMirror |
| 渲染模式 | ✅ | 实时预览 |
| 数学公式 | ✅ | MathJax 支持 |
| 插件系统 | ✅ | 可扩展架构 |

## 使用说明

1. 点击 **View** 按钮切换到预览模式
2. 点击 **Edit** 按钮返回编辑模式
3. 点击 **Save** 按钮保存内容到本地存储
4. 点击 **Clear** 按钮清空编辑器

---

**提示**：尝试编辑这个文档，然后切换到预览模式查看效果！
`;

// --- Sidebar Logic ---
const sidebar = document.getElementById('sidebar');
function toggleSidebar() {
    sidebar.classList.toggle('collapsed');
}
// Populate sidebar sessions
const sessions = [
    { id: 1, title: 'MDxEditor 功能介绍' },
    { id: 2, title: '项目周报（2023-W48）' },
    { id: 3, title: '插件系统设计思路' },
    { id: 4, title: '用户反馈与改进计划' },
];
const sessionList = document.getElementById('sessionList');
sessions.forEach((session, index) => {
    const li = document.createElement('li');
    li.className = `session-item ${index === 0 ? 'active' : ''}`;
    li.textContent = session.title;
    if (index === 0) {
        li.classList.add('active'); // 默认选中第一项
    }
    sessionList.appendChild(li);
});

// --- Autocomplete Data Providers ---
const allTags = ['javascript', 'typescript', 'react', 'vue', 'css', 'html', 'refactor', 'bugfix', 'performance'];
const mockUsers = [
    { id: 'john', label: 'John Doe', type: 'Frontend Developer', avatar: '👨‍💻' },
    { id: 'anna', label: 'Anna Smith', type: 'Backend Developer', avatar: '👩‍💻' },
    { id: 'peter', label: 'Peter Jones', type: 'UI/UX Designer', avatar: '🎨' },
];
const mockDocuments = [
    { id: 'proj-plan', label: 'Project Plan', type: 'Planning Document' },
    { id: 'api-v2', label: 'API Design V2', type: 'Technical Spec' },
    { id: 'ux-research', label: 'UX Research Report', type: 'Research' },
];

const userMentionProvider = {
    key: 'users', triggerChar: '@',
    async getSuggestions(query) {
        await new Promise(r => setTimeout(r, 150));
        return mockUsers.filter(u => u.label.toLowerCase().includes(query.toLowerCase()));
    },
    async getHoverPreview(item) {
        const user = mockUsers.find(u => u.id === item.id);
        if (!user) return null;
        return {
            title: `${user.avatar} ${user.label}`,
            content: `<strong>Position:</strong> ${user.type}<br><em>Active on 3 projects.</em>`,
        };
    },
};

const documentMentionProvider = {
    key: 'docs', triggerChar: '@@',
    async getSuggestions(query) {
        await new Promise(r => setTimeout(r, 100));
        return mockDocuments.filter(d => d.label.toLowerCase().includes(query.toLowerCase()));
    },
    async getHoverPreview(item) {
        const doc = mockDocuments.find(d => d.id === item.id);
        if (!doc) return null;
        return { title: `📄 ${doc.label}`, content: `A <strong>${doc.type}</strong>.` };
    },
    async getFullContent(id) {
        const doc = mockDocuments.find(d => d.id === id);
        if (!doc) return '<div>Document not found.</div>';
        return `
          <div style="border-left: 3px solid #ccc; padding-left: 15px; margin: 10px 0;">
            <h4>${doc.label}</h4>
            <p>This is the embedded content for <strong>${doc.label}</strong>.</p>
            <ul><li>Define project scope</li><li>Create initial mockups</li></ul>
          </div>
        `;
    },
};

// --- Editor Initialization ---
const editorContainer = document.getElementById('editor');
let editor;

if (editorContainer) {
    const savedContent = localStorage.getItem('mdx-editor-content') || initialContent;

    // Create and initialize the editor in one step
    editor = await createMDxEditor(editorContainer, {
        initialContent: savedContent,
        initialMode: 'edit',
        plugins: [
            'core:titlebar',
            'interaction:source-sync',
            'cloze',
            'autocomplete:tag',
            'autocomplete:mention',
            'plantuml',
            'vega'
        ],
        defaultPluginOptions: {
            'core:titlebar': {
                enableToggleEditMode: true,
                toggleSidebarCallback: toggleSidebar,
                saveCallback: (editor) => {
                    const content = editor.getText();
                    localStorage.setItem('mdx-editor-content', content);
                    console.log('Content saved via title bar button:', content);
                    alert('Content saved successfully!');
                }
            },
            'autocomplete:tag': {
                getTags: async () => allTags,
            },
            'autocomplete:mention': {
                providers: [userMentionProvider, documentMentionProvider],
                onMentionClick: (providerKey, id) => {
                    alert(`Mention clicked!\nProvider: ${providerKey}\nID: ${id}`);
                },
            },
            // [可选] 配置 SVG 或 PlantUML 选项，例如服务器地址
            'plantuml': {
                format: 'svg'
            },
            'vega': {
                theme: 'quartz', // 可选: 'excel' | 'ggplot2' | 'quartz' | 'vox' | 'dark'
                actions: true
            }
        }
    });

    console.log('MDxEditor instance created and initialized.', editor);
}

// --- Search Logic ---
const searchInput = document.getElementById('searchInput');
const searchResultsEl = document.getElementById('searchResults');
const searchPrevBtn = document.getElementById('searchPrevBtn');
const searchNextBtn = document.getElementById('searchNextBtn');
const searchClearBtn = document.getElementById('searchClearBtn');

let searchResults = [];
let currentMatchIndex = -1;

function updateSearchUI() {
    const hasResults = searchResults.length > 0;
    // @ts-ignore
    searchPrevBtn.disabled = !hasResults;
    // @ts-ignore
    searchNextBtn.disabled = !hasResults;
    // @ts-ignore
    searchClearBtn.disabled = !searchInput.value;

    if (hasResults) {
        searchResultsEl.textContent = `${currentMatchIndex + 1} of ${searchResults.length}`;
    } else {
        // @ts-ignore
        searchResultsEl.textContent = searchInput.value ? 'No results' : '';
    }
}

async function performSearch() {
    // @ts-ignore
    const query = searchInput.value;
    if (!query) {
        clearSearch();
        return;
    }
    searchResults = await editor.search(query);
    if (searchResults.length > 0) {
        currentMatchIndex = 0;
        editor.gotoMatch(searchResults[currentMatchIndex]);
    } else {
        currentMatchIndex = -1;
    }
    updateSearchUI();
}

function clearSearch() {
    editor.clearSearch();
    // @ts-ignore
    searchInput.value = '';
    searchResults = [];
    currentMatchIndex = -1;
    updateSearchUI();
}

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        performSearch();
    }
});

searchNextBtn.addEventListener('click', () => {
    if (searchResults.length === 0) return;
    currentMatchIndex = (currentMatchIndex + 1) % searchResults.length;
    editor.gotoMatch(searchResults[currentMatchIndex]);
    updateSearchUI();
});

searchPrevBtn.addEventListener('click', () => {
    if (searchResults.length === 0) return;
    currentMatchIndex = (currentMatchIndex - 1 + searchResults.length) % searchResults.length;
    editor.gotoMatch(searchResults[currentMatchIndex]);
    updateSearchUI();
});

searchClearBtn.addEventListener('click', clearSearch);

// --- Other Event Handling ---
const clearBtn = document.getElementById('clearBtn');
clearBtn.addEventListener('click', () => {
    if (confirm('确定要清空编辑器内容吗？')) {
        editor.setText('');
        localStorage.removeItem('mdx-editor-content');
    }
});
