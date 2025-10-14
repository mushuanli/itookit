

# SessionUI v2 - README.md

## SessionUI v2

**SessionUI v2** 是一个现代、无框架依赖的 JavaScript UI 库，用于高效地管理和展示层级化的会话列表。它高度可扩展，可与任何数据源集成，非常适合笔记应用、文档管理器、聊天历史记录或任何需要树状结构列表和丰富交互的场景。

这个库的设计遵循“关注点分离”的原则，将状态管理（Store）、业务逻辑（Services）和UI渲染（Components）清晰地解耦，并通过一个简洁的公共 API 进行通信，使得扩展和集成变得简单。

<!-- 这是一个示意图，您可以替换为真实的截图 -->

---

### ✨ 核心功能

SessionUI v2 提供了一套完整的功能，让您能快速构建强大的会话管理界面。

#### 🗂️ 层级化管理
*   **文件与文件夹**：支持创建、重命名和删除会话（文件）与文件夹。
*   **无限层级**：文件夹可以无限嵌套，构建复杂的树状结构。
*   **目录内创建**：通过右键菜单或智能全局按钮，可以在指定文件夹内创建新项目。

#### 🎮 丰富的交互体验
*   **拖放操作**：通过拖放轻松地对单个或多个项目进行重新排序和移动。
*   **精确移动**：提供 "移动到..." 模态框，用于将项目精确地移动到目标文件夹。
*   **多选与批量操作**：支持 `Cmd/Ctrl` + 点击进行多选，并提供批量删除、移动等操作栏。
*   **高度可定制的右键菜单**：为每个项目提供上下文菜单，并允许开发者**完全重写、添加或修改**菜单项及其行为。
*   **智能文件夹**：文件夹可展开/折叠，并为展开的空文件夹提供明确的视觉反馈。
*   **自动展开**：在拖动项目悬停在折叠的文件夹上时，文件夹会自动展开。

#### 🎨 UI 与可定制性
*   🆕 **可定制标题**：支持在创建时设置侧边栏标题，或在运行时动态修改。
*   **强大的搜索**：支持按标题、内容、标签进行实时过滤。
*   **灵活的排序与显示**：可按修改时间或标题排序，并能切换“舒适”与“紧凑”两种显示密度。
*   **内容预览**：可选择性地显示摘要、标签和元数据徽章（如任务列表进度）。
*   **文档大纲 (可选)**：能解析并展示当前激活会话的文档大纲，并支持点击导航。
*   **灵活的布局控制**：内置响应式的、可切换的侧边栏状态管理，轻松集成到任何应用布局中。
*   **主题化**：完全基于 CSS 变量构建，轻松定制颜色、字体、间距等主题。

#### 🔌 集成与 API
*   **简洁的公共 API**：提供封装良好的 `on()`, `toggleSidebar()` 等方法，让应用集成更简单、更安全。
*   **事件驱动**：通过 `manager.on()` 方法监听关键事件（如会话选择、侧边栏状态变更、**自定义菜单点击**），实现与宿主应用的解耦通信。
*   **可插拔的持久化层**: 库本身不绑定任何特定数据库。您需要提供一个实现了 `IPersistenceAdapter` 接口的适配器（如内置的 `LocalStorageAdapter` 或您自定义的 `IndexedDBAdapter`），并将其包装在 `DatabaseService` 中进行注入。

---

### 🚀 安装与设置

SessionUI v2 是一个原生的 ES 模块库，可以直接在现代浏览器中使用。

#### 1. HTML 结构

您需要在 HTML 文件中提供几个容器元素，以及一个用于切换侧边栏的按钮。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>My Awesome App</title>
    <link rel="stylesheet" href="path/to/session-ui.bundle.css">
    <style>
        /* 您的应用布局样式 */
        .app-container { display: grid; grid-template-columns: 320px 1fr; /* ... */ }
        .app-container.sidebar-collapsed { grid-template-columns: 0 1fr; /* ... */ }
    </style>
</head>
<body>
    <!-- [新增] 用于切换侧边栏的按钮，您可以放置在任何地方 -->
    <button id="sidebar-toggle-button">Toggle Sidebar</button>

    <div id="app-container">
        <!-- 1. SessionList 组件的容器 (必需) -->
        <div id="session-list-container"></div>
    
        <!-- 2. 主内容区 -->
        <main>...</main>
    </div>
    
    <!-- 3. MoveToModal 组件的容器 (必需，用于移动操作) -->
    <div id="mdx-modal-container"></div>

    <!-- 依赖库: Immer.js 是必需的 -->
    <script src="https://cdn.jsdelivr.net/npm/immer/dist/immer.umd.production.min.js"></script>
    <script>
      // [关键] 必须在使用库之前启用 Map 和 Set 支持
      if (window.immer) { window.immer.enableMapSet(); }
    </script>
    
    <!-- 你的应用脚本 -->
    <script type="module" src="my-app.js"></script>
</body>
</html>
```

#### 2. JavaScript 初始化 (基础)

**[修改]** 这是最简单的初始化方式，使用内置的 `LocalStorageAdapter` 进行数据存储。

```javascript
// my-app.js
import { 
    createSessionUI, 
    LocalStorageAdapter, 
    DatabaseService 
} from './path/to/sessionUI/index.js';

// 1. 创建一个持久化适配器
// `prefix` 用于避免多个应用在同一个域名下的 LocalStorage 键冲突
const adapter = new LocalStorageAdapter({ prefix: 'my-awesome-app' });

// 2. 用适配器创建一个数据库服务实例
const dbService = new DatabaseService({ adapter });

// 3. 初始化 UI 管理器，并注入数据库服务
const manager = createSessionUI({
    sessionListContainer: document.getElementById('session-list-container'),
    databaseService: dbService,
    storageKey: 'session-data', // 指定此库的数据在数据库中的命名空间/键名
    title: '我的项目' // <-- 新增：创建时设置标题
});

// 启动库
await manager.start();

// ... 交互逻辑见下文 ...
```

#### 3. (高级) 使用自定义数据库适配器

您可以完全控制数据的存储位置。只需创建一个实现 `IPersistenceAdapter` 接口的类即可。

**a. 创建你的适配器 (例如 `IndexedDBAdapter.js`)**

```javascript
// IndexedDBAdapter.js
import { IPersistenceAdapter } from './path/to/sessionUI/common/store/adapters/IPersistenceAdapter.js';

export class IndexedDBAdapter extends IPersistenceAdapter {
    // ... ( IndexedDB 连接和 get/set/remove 方法的实现 ) ...
}
```

**b. 在初始化时注入适配器**

**[修改]** 注入流程现在统一通过 `DatabaseService`。

```javascript
// my-app.js
import { createSessionUI, DatabaseService } from './path/to/sessionUI/index.js';
import { IndexedDBAdapter } from './IndexedDBAdapter.js'; // 导入你的适配器

// 1. 创建你的自定义适配器实例
const myAdapter = new IndexedDBAdapter({ dbName: 'my-app-db' });

// 2. 用它创建数据库服务
const dbService = new DatabaseService({ adapter: myAdapter });

// 3. 在初始化时注入数据库服务
const manager = createSessionUI({
    sessionListContainer: document.getElementById('session-list-container'),
    databaseService: dbService,
    storageKey: 'main-session-state' // 同样可以指定命名空间
});

await manager.start();
```

---

### 📖 API & 使用方法

#### `createSessionUI(options)`

这是库的唯一入口点。

*   `options` `(Object)`: 配置对象。
    *   `sessionListContainer` `(HTMLElement)` **(必需)**: 挂载会话列表的容器。
    *   `databaseService` `(DatabaseService)` **(必需)**: 一个 `DatabaseService` 的实例，负责所有数据持久化。
    *   `documentOutlineContainer` `(HTMLElement)` (可选): 挂载文档大纲的容器。
    *   `storageKey` `(string)` (可选): 用于在提供的 `databaseService` 中存储此库数据的唯一**命名空间**（或键名）。如果未提供，将使用默认值 `'sessionState'`。
    *   `initialSidebarCollapsed` `(boolean)` (可选): 设置侧边栏的初始折叠状态，默认为 `false`。
    *   `title` `(string)` (可选): 设置侧边栏的标题，默认为 `'会话列表'`。
    *   `contextMenu` `(Object)` **(新增)**: 自定义右键上下文菜单。
        *   `items` `(Function)`: 一个函数 `(item, defaultItems) => finalItems`，用于生成菜单项。
            *   `item`: 被右键点击的项（会话或文件夹）。
            *   `defaultItems`: 库生成的默认菜单项数组。
            *   返回值 `finalItems`: 最终要显示的菜单项数组。

*   **返回值**: `(SessionUIManager)`: 管理器实例。

#### SessionUIManager 实例 (核心 API)

`manager` 实例是与库交互的主要方式。

*   `manager.start()`: `async` 方法。初始化组件，从持久化层加载数据并渲染。**必须调用**。

*   `manager.destroy()`: 销毁组件，清除事件和 DOM。

*   `manager.on(eventName, callback)`: **(推荐)** 监听库的公共事件。返回一个 `unsubscribe` 函数。
*   `manager.toggleSidebar()`: 切换侧边栏的折叠状态。库会管理状态并触发 `sidebarStateChanged` 事件。
*   `manager.setTitle(newTitle)`: 动态更新侧边栏的标题。
*   `manager.updateSessionContent(sessionId, newContent)`: `async` 方法。以编程方式更新会话内容，并自动触发持久化保存。
*   `manager.getActiveSession()`: 返回当前激活的会话对象。

---

### 🎧 与应用交互 (事件)

推荐使用 `manager.on()` 方法来响应库的事件，实现应用解耦。

```javascript
const manager = createSessionUI({ ... });
const appContainer = document.getElementById('app-container');
const toggleButton = document.getElementById('sidebar-toggle-button');

// 示例 1: 响应侧边栏状态变化
manager.on('sidebarStateChanged', ({ isCollapsed }) => {
    // 你的应用只需根据状态更新 UI
    appContainer.classList.toggle('sidebar-collapsed', isCollapsed);
    console.log(`侧边栏现在是 ${isCollapsed ? '折叠的' : '展开的'}`);
});
// 将你的按钮连接到库的 API
toggleButton.addEventListener('click', () => {
    manager.toggleSidebar();
});


// 示例 2: 当用户选择一个新会话时
manager.on('sessionSelected', ({ session }) => {
    if (session) {
        console.log('用户选择了:', session.title);
        // 在这里更新你的编辑器内容
        // myEditor.setContent(session.content);

        // [新增] 示例：选择会话后，动态更新侧边栏标题
        manager.setTitle(session.title);
    } else {
        console.log('用户取消了选择');
        manager.setTitle('我的项目'); // 恢复默认标题
    }
});

// 示例 3: 响应导入文件请求
manager.on('importRequested', () => {
    // 触发文件选择对话框: myFileInput.click();
});

// [新增] 示例 4: 响应自定义菜单项点击
manager.on('menuItemClicked', ({ actionId, item }) => {
    console.log(`自定义菜单项 "${actionId}" 在项目 "${item.title}" 上被点击了。`);
    if (actionId === 'copy-id') {
        navigator.clipboard.writeText(item.id);
        alert('ID 已复制!');
    }
});

await manager.start();
```

---

### 🎨 定制化

#### 外观定制

你可以通过覆盖 CSS 变量来轻松地定制 SessionUI 的外观。

```css
/* my-app.css */
:root {
  /* --- 示例：修改主题色 --- */
  --mdx-color-brand-primary: #d946ef; /* 紫色 */
  --mdx-color-brand-hover: #c026d3;
  
  /* --- 示例：修改字体 --- */
  --mdx-font-family-sans: 'Georgia', serif;
}
```

完整的变量列表请参考 `styles/base/_variables.css` 文件。

#### **(新增)** 功能定制：上下文菜单

通过 `contextMenu` 选项，你可以完全控制右键菜单的行为。

```javascript
const manager = createSessionUI({
    sessionListContainer: document.getElementById('session-list-container'),
    
    contextMenu: {
        items: (item, defaultItems) => {
            // `item` 是被右键点击的对象
            // `defaultItems` 是库提供的默认菜单项数组

            // 示例：在默认菜单顶部增加一个“复制ID”的选项
            const copyIdAction = { 
                id: 'copy-id', // 唯一ID，用于事件监听
                label: '复制 ID', 
                iconHTML: '<i class="fas fa-clipboard"></i>' 
            };
            
            // 返回最终的菜单项数组
            return [copyIdAction, { type: 'separator' }, ...defaultItems];
            
            // 或者，你可以根据 item 类型动态修改
            if (item.type === 'session') {
                defaultItems.push({ id: 'share', label: '分享...' });
            }
            return defaultItems;
        }
    }
});
```

菜单项对象结构:
*   `id` (string): 动作的唯一标识符。
*   `label` (string): 显示的文本。
*   `iconHTML` (string, 可选): 图标的 HTML 字符串。
*   `type` ('item' | 'separator', 可选): `separator` 会渲染一条分割线。
*   `hidden` (Function, 可选): 一个函数 `(item) => boolean`，返回 `true` 则隐藏该菜单项。

---

### 📄 许可证

本项目采用 [MIT](https://opensource.org/licenses/MIT) 许可证。