// 文件: #demo/mdxworkspace.js (已重构)

import { MDxWorkspace } from '../workspace/mdx/MDxWorkspace.js';
import { ConfigManager } from '../config/ConfigManager.js'; // [新] 导入 ConfigManager
import { IndexedDBAdapter } from './indexdbadapter.js';

// =========================================================================
// === [核心重构] 1. 应用级数据管理器初始化
// =========================================================================
// 在整个 Demo 应用的生命周期中，只创建一个 ConfigManager 实例。
// 所有 MDxWorkspace 实例都将共享这个管理器，以实现数据服务的统一管理。
console.log("正在初始化应用级 ConfigManager...");
const configManager = ConfigManager.getInstance({
    // 为所有仓库提供一个统一的持久化适配器实例
    adapter: new IndexedDBAdapter({ dbName: 'MDxWorkspaceDemoDB' }),
    // 为 LocalStorageAdapter（如果作为备用）提供前缀
    adapterOptions: { prefix: 'mdx_demo_' } 
});

let currentWorkspace = null;

// =========================================================================
// === Demo 初始化函数 (已适配新接口)
// =========================================================================

    // [新增] Demo 1 的示例文本，用于展示 Cloze 功能
    const demo1InitialText = `
# Cloze 学习模式演示

欢迎来到 MDxWorkspace 的学习模式！此模式已开启 **clozeControl** 选项。

## 如何使用

1.  **点击**下面 --[c1]颜色不同-- 的卡片来查看答案。
2.  答案下方会出现 **“重来、困难、良好、简单”** 按钮。
3.  根据你的记忆情况选择一个，卡片会自动关闭并安排下次复习。
4.  如果你在5分钟内没有选择，系统会默认按 **“良好”** 处理。
5.  右下角的 **浮动按钮** 可以帮你快速展开/折叠所有卡片，或在关闭的卡片间跳转。

---

## 示例卡片

- 这是一个 --[c2]新创建-- 的卡片，它的下划线是蓝色的。
- 法国的首都是 --[c3]巴黎--。
- 这是一张已经**成熟**的卡片：太阳从 --[c4]东方-- 升起。你会发现它默认就是打开的，并且有虚线底划线。
- **双击**上面那张成熟的卡片，可以**重置**它的学习进度。

---

## 提及功能

提及功能 (@mention) 在渲染模式下同样可用：
- 提及用户：@John Doe
- 提及文件：@[示例文件](mdx://file/some-file-id)
`;
        
function initDemo1() {
    console.log("Initializing Demo 1: Cloze Learning Mode");
    const workspace = new MDxWorkspace({
        // --- [核心重构] 注入 ConfigManager 和 Namespace ---
        configManager: configManager,          // 注入全局管理器
        namespace: 'demo1-cloze-learning-data', // 指定此工作区的数据分区
        // ---

        sidebarContainer: document.getElementById('demo1-sidebar'),
        editorContainer: document.getElementById('demo1-editor'),
        
        editor: {
            clozeControl: true,
            initialText: demo1InitialText,
            mentionProviders: [
                (dependencies) => ({
                    key: 'user', triggerChar: '@',
                    async getSuggestions(query) {
                        const users = [{ id: 'john', name: 'John Doe' }, { id: 'jane', name: 'Jane Smith' }];
                        return users.filter(u => u.name.toLowerCase().includes(query.toLowerCase()))
                                    .map(u => ({ id: u.id, label: `🧑 ${u.name}` }));
                    }
                })
            ]
        }
    });
    
    workspace.on('ready', () => console.log('Demo 1 Ready!'));
    workspace.start();
    return workspace;
}
        
function initDemo2() {
    console.log("Initializing Demo 2: External title bar & custom sidebar");
    const workspace = new MDxWorkspace({
        // --- [核心重构] 注入 ConfigManager 和 Namespace ---
        configManager: configManager,          // 注入全局管理器
        namespace: 'demo2-knowledge-base',     // 指定此工作区的数据分区
        // ---
        // 注意：我们不再需要在此处单独指定 adapter，因为它由 ConfigManager 统一管理。
        
        sidebarContainer: document.getElementById('demo2-sidebar'),
        editorContainer: document.getElementById('demo2-editor'),
        
        sidebar: {
            title: '我的知识库',
            contextMenu: {
                items: (item, defaultItems) => [
                    { id: 'alert-id', label: '显示ID', iconHTML: '<i class="fas fa-info-circle"></i>' },
                    { type: 'separator' },
                    ...defaultItems
                ]
            }
        },
        editor: {
            titleBar: { title: null, toggleSidebarCallback: null, enableToggleEditMode: false }
        }
    });

    const titleDisplay = document.getElementById('session-title-display');
    workspace.on('sessionSelect', ({ item }) => {
        titleDisplay.textContent = item ? item.metadata.title : '无活动会话';
    });

    // 事件监听逻辑保持不变，因为公共 API 是稳定的
    workspace.on('menuItemClicked', ({ actionId, item }) => {
        if (actionId === 'alert-id') {
            alert(`项目 "${item.metadata.title}" 的 ID 是: ${item.id}`);
        }
    });
    
    workspace.start();
    return workspace;
}

function initDemo3() {
    console.log("Initializing Demo 3: Custom toolbar & manual save");
    const workspace = new MDxWorkspace({
        // --- [核心重构] 注入 ConfigManager 和 Namespace ---
        configManager: configManager,      // 注入全局管理器
        namespace: 'demo3-manual-save',    // 指定此工作区的数据分区
        // ---
        
        sidebarContainer: document.getElementById('demo3-sidebar'),
        editorContainer: document.getElementById('demo3-editor'),
        
        editor: {
            showToolbar: false,
            showSaveButton: false 
        }
    });

    workspace.on('ready', () => {
        console.log("Demo 3 workspace is ready. Attaching command buttons.");
        console.log("Available commands:", workspace.commands);
        
        document.getElementById('custom-bold-btn').onclick = () => workspace.commands.applyBold();
        document.getElementById('custom-strikethrough-btn').onclick = () => workspace.commands.applyStrikethrough();
        document.getElementById('custom-cloze-btn').onclick = () => workspace.commands.applyCloze();
        
        document.getElementById('custom-save-btn').onclick = async () => {
            console.log("手动保存中...");
            const savedItem = await workspace.save();
            if (savedItem) {
                // [注意] V2 Item 结构变化，title 在 metadata 中
                console.log(`保存完成! Session: "${savedItem.metadata.title}"`);
                alert('保存成功!');
            } else {
                console.log("没有活动会话可供保存。");
                alert('没有需要保存的内容。');
            }
        };
    });

    // 事件监听逻辑保持不变
    workspace.on('saved', ({ item }) => {
        if (item) {
             // [注意] V2 Item 结构变化
            console.log(`内容已手动保存到会话: "${item.metadata.title}"`);
        }
    });
    
    workspace.start();
    return workspace;
}

// =========================================================================
// === [核心重构] 2. Demo 启动与导航逻辑
// =========================================================================
const demoInitializers = {
    '1': initDemo1,
    '2': initDemo2,
    '3': initDemo3,
};

const navButtons = document.querySelectorAll('nav button');
const demoContainers = document.querySelectorAll('.demo-container');

function switchDemo(demoId) {
    if (currentWorkspace) {
        currentWorkspace.destroy();
        currentWorkspace = null;
    }
    navButtons.forEach(btn => btn.classList.remove('active'));
    document.querySelector(`button[data-demo="${demoId}"]`).classList.add('active');
    demoContainers.forEach(container => container.classList.remove('active'));
    document.getElementById(`demo${demoId}-container`).classList.add('active');
    currentWorkspace = demoInitializers[demoId]();
}

navButtons.forEach(button => {
    button.addEventListener('click', () => {
        switchDemo(button.dataset.demo);
    });
});

// [重构] 等待 ConfigManager 准备就绪后再启动第一个 Demo
// 这确保了所有数据仓库在工作区启动前都已加载完毕，避免了竞态条件。
configManager.eventManager.subscribe('app:ready', () => {
    console.log("ConfigManager 已准备就绪, 启动默认 Demo...");
    // 默认启动 Demo 1
    switchDemo('1');
});