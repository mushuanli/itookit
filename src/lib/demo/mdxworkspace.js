// 文件: #demo/mdxworkspace.js (已重构)

import { getConfigManager } from '../configManager/index.js';
import { createMDxWorkspace } from '../workspace/mdx/index.js';

// --- 全局变量 ---
let currentWorkspace = null;
let configManager = null;

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

/**
 * 初始化 Demo 1: Cloze 学习模式
 * @returns {Promise<MDxWorkspace>}
 */
async function initDemo1() {
    console.log("⚙️ 初始化 Demo 1: Cloze 学习模式");
    
    // ✅ 使用工厂函数，一步到位
    const workspace = await createMDxWorkspace({
        configManager: configManager,
        namespace: 'demo1-cloze-learning',
        
        sidebarContainer: document.getElementById('demo1-sidebar'),
        editorContainer: document.getElementById('demo1-editor'),
        
        newSessionTemplate: demo1InitialText,
        
        editor: {
            clozeControl: true,
            mentionProviders: [
                (dependencies) => ({
                    key: 'user',
                    triggerChar: '@',
                    async getSuggestions(query) {
                        const users = [
                            { id: 'john', name: 'John Doe' },
                            { id: 'jane', name: 'Jane Smith' }
                        ];
                        return users
                            .filter(u => u.name.toLowerCase().includes(query.toLowerCase()))
                            .map(u => ({ id: u.id, label: `🧑 ${u.name}` }));
                    }
                })
            ]
        }
    });
    
    workspace.on('ready', () => console.log('✅ Demo 1 Ready!'));
    
    return workspace;
}

/**
 * 初始化 Demo 2: 外部标题栏和自定义侧边栏
 * @returns {Promise<MDxWorkspace>}
 */
async function initDemo2() {
    console.log("⚙️ 初始化 Demo 2: 外部标题栏 & 自定义侧边栏");
    
    const workspace = await createMDxWorkspace({
        configManager: configManager,
        namespace: 'demo2-knowledge-base',
        
        sidebarContainer: document.getElementById('demo2-sidebar'),
        editorContainer: document.getElementById('demo2-editor'),
        
        sidebar: {
            title: '我的知识库',
            contextMenu: {
                items: (item, defaultItems) => [
                    {
                        id: 'alert-id',
                        label: '显示ID',
                        iconHTML: '<i class="fas fa-info-circle"></i>'
                    },
                    { type: 'separator' },
                    ...defaultItems
                ]
            }
        },
        
        editor: {
            titleBar: {
                title: null,
                toggleSidebarCallback: null,
                enableToggleEditMode: false
            }
        }
    });

    // 外部标题显示
    const titleDisplay = document.getElementById('session-title-display');
    workspace.on('sessionSelect', ({ item }) => {
        titleDisplay.textContent = item ? item.metadata.title : '无活动会话';
    });

    // 自定义菜单项处理
    workspace.on('menuItemClicked', ({ actionId, item }) => {
        if (actionId === 'alert-id') {
            alert(`项目 "${item.metadata.title}" 的 ID 是: ${item.id}`);
        }
    });
    
    console.log('✅ Demo 2 Ready!');
    return workspace;
}

/**
 * 初始化 Demo 3: 自定义工具栏和手动保存
 * @returns {Promise<MDxWorkspace>}
 */
async function initDemo3() {
    console.log("⚙️ 初始化 Demo 3: 自定义工具栏 & 手动保存");
    
    const workspace = await createMDxWorkspace({
        configManager: configManager,
        namespace: 'demo3-manual-save',
        
        sidebarContainer: document.getElementById('demo3-sidebar'),
        editorContainer: document.getElementById('demo3-editor'),
        
        editor: {
            showToolbar: false,
            showSaveButton: false 
        }
    });

    // 连接自定义工具栏按钮
    document.getElementById('custom-bold-btn').onclick = () => 
        workspace.commands.applyBold();
    document.getElementById('custom-strikethrough-btn').onclick = () => 
        workspace.commands.applyStrikethrough();
    document.getElementById('custom-cloze-btn').onclick = () => 
        workspace.commands.applyCloze();
    
    document.getElementById('custom-save-btn').onclick = async () => {
        const savedItem = await workspace.save();
        alert(savedItem ? '保存成功!' : '没有需要保存的内容。');
    };

    // 事件监听逻辑保持不变
    workspace.on('saved', ({ item }) => {
        if (item) {
             // [注意] V2 Item 结构变化
            console.log(`内容已手动保存到会话: "${item.metadata.title}"`);
        }
    });
    
    console.log('✅ Demo 3 Ready!');
    return workspace;
}

// --- Demo 初始化映射 ---
const demoInitializers = {
    '1': initDemo1,
    '2': initDemo2,
    '3': initDemo3,
};

/**
 * 切换 Demo
 * @param {string} demoId 
 */
async function switchDemo(demoId) {
    // 销毁当前工作区
    if (currentWorkspace) {
        currentWorkspace.destroy();
        currentWorkspace = null;
    }
    
    // 更新导航状态
    const navButtons = document.querySelectorAll('nav button');
    const demoContainers = document.querySelectorAll('.demo-container');
    
    navButtons.forEach(btn => btn.classList.remove('active'));
    document.querySelector(`button[data-demo="${demoId}"]`).classList.add('active');
    
    demoContainers.forEach(container => container.classList.remove('active'));
    document.getElementById(`demo${demoId}-container`).classList.add('active');
    
    // 初始化新工作区
    try {
        currentWorkspace = await demoInitializers[demoId]();
    } catch (error) {
        console.error(`❌ 初始化 Demo ${demoId} 失败:`, error);
        alert(`初始化 Demo 失败: ${error.message}`);
    }
}

// --- 应用启动逻辑 ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 正在初始化应用...");
    
    try {
        // 1. 获取并初始化 ConfigManager
        configManager = getConfigManager();
        await configManager.init();
        console.log("✅ ConfigManager 已就绪");
        
        // 设置导航按钮
        const navButtons = document.querySelectorAll('nav button');
        navButtons.forEach(button => {
            button.addEventListener('click', () => {
                switchDemo(button.dataset.demo);
            });
        });
        
        // 默认启动 Demo 1
        await switchDemo('1');
        
    } catch (error) {
        console.error("❌ 应用启动失败:", error);
        document.body.innerHTML = `
            <div class="error-message">应用启动失败: ${error.message}</div>
        `;
    }
});