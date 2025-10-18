/**
 * @file @mdx/demo/session.js
 * @description MDxEditor + SessionUI 完整功能演示脚本 (V2)
 * @description 这个演示现在展示了如何正确地初始化和使用新的、基于 ConfigManager 的架构。
 */

// --- 导入重构后的 SessionUI 库 ---
import { createSessionUI } from '../sidebar/index.js';

// --- 导入重构后的 MDxEditor 及其插件 ---
import { MDxEditor, defaultPlugins } from '../mdx/editor/index.js';

// --- [V2] 导入新的全局配置管理器 ---
import { ConfigManager } from '../config/ConfigManager.js';

//-----------------------------------------------------------------

// --- 全局 MDxEditor 和 DocumentOutline 实例 (暂时在 demo 中管理) ---
let editorInstance = null;
let sessionUIManager = null;

// --- DOM 元素获取 ---
const appContainer = document.getElementById('app-container');
const sidebarContainer = document.getElementById('sidebar-container');
const editorContainer = document.getElementById('editor-container');
// [REMOVED] const floatingToggleBtn = document.getElementById('floating-sidebar-toggle');


/**
 * 将 SessionUI 库与 MDxEditor 连接起来 (事件监听)
 */
function connectLibraries() {
    if (!editorInstance || !sessionUIManager) return;

    // 1. 当用户在侧边栏选择一个会话时，更新编辑器内容和标题
    sessionUIManager.on('sessionSelected', ({ item }) => {
        if (item && item.type === 'item') {
            const currentContent = editorInstance.getText();
            const newContent = item.content?.data || '';

            if (currentContent !== newContent) {
                editorInstance.setText(newContent);
            }
            editorInstance.setTitle(item.metadata.title);
            editorInstance.switchTo('render'); // 切换到预览模式
        } else {
            // Handle case where selection is cleared
            editorInstance.setText('# 无会话被选中');
            // [核心修改] 恢复默认标题
            editorInstance.setTitle('无标题');
            editorInstance.switchTo('render');
        }
    });

    // 2. 当编辑器内容改变时，通过防抖函数自动保存回 SessionUI
    const debouncedSave = (() => {
        let timeout;
        return () => {
            clearTimeout(timeout);
            timeout = setTimeout(async () => {
                const activeSession = sessionUIManager.getActiveSession();
                if (activeSession) {
                    const newContent = editorInstance.getText();
                    const oldContent = activeSession.content?.data || '';
                    if (newContent !== oldContent) {
                        // 使用公共API更新会话内容
                        await sessionUIManager.updateSessionContent(activeSession.id, newContent);
                    }
                }
            }, 500); // 500ms 延迟
        };
    })();
    editorInstance.on('change', debouncedSave);

    // [REFACTORED] 3. 使用 manager.on() 监听大纲导航请求
    sessionUIManager.on('navigateToHeading', ({ elementId }) => {
        editorInstance.switchTo('render');
        setTimeout(() => {
            // 注意：editor 实例内部已不再暴露 renderEl，但我们可以通过 container 找到它
            const renderEl = editorContainer.querySelector('.mdx-render-view');
            const targetEl = renderEl?.querySelector(`#${elementId}`);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // 添加视觉反馈
                targetEl.classList.remove('highlight-heading');
                void targetEl.offsetWidth; // 触发重绘
                targetEl.classList.add('highlight-heading');
            }
        }, 50);
    });
}

/**
 * [V2] 处理来自 SessionUI 的文件导入请求。
 * @param {{ parentId: string | null }} payload - 包含目标父文件夹ID的对象。
 */
function handleImportRequest({ parentId }) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.md,.txt'; // Accept markdown and text files
    fileInput.multiple = true;
    fileInput.style.display = 'none';

    fileInput.onchange = () => {
        if (!fileInput.files) return;
        Array.from(fileInput.files).forEach(file => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const content = e.target.result;
                const title = file.name.replace(/\.(md|txt)$/, '');
                // 使用 sessionUIManager 暴露的 service 来创建会话
                await sessionUIManager.sessionService.createSession({ title, content, parentId });
            };
            reader.readAsText(file);
        });
        document.body.removeChild(fileInput);
    };

    document.body.appendChild(fileInput);
    fileInput.click();
}

/**
 * 设置应用级别的 UI 交互，如侧边栏折叠和自定义菜单。
 */
function setupAppUIHandlers() {
    // 1. 监听来自库的侧边栏状态变化，并更新应用主容器的 class
    sessionUIManager.on('sidebarStateChanged', ({ isCollapsed }) => {
        // Apply the change to the main container's class
        appContainer.classList.toggle('sidebar-collapsed', isCollapsed);
    });

    // 2. 监听导入请求
    sessionUIManager.on('importRequested', handleImportRequest);
    
    // 3. 监听自定义菜单项的点击事件
    sessionUIManager.on('menuItemClicked', ({ actionId, item }) => {
        switch (actionId) {
            case 'copy-id':
                navigator.clipboard.writeText(item.id)
                    .then(() => alert(`ID "${item.id}" 已复制到剪贴板。`))
                    .catch(err => console.error('复制失败:', err));
                break;
            case 'share-session':
                alert(`正在分享会话: "${item.metadata.title}"... (这是一个自定义操作)`);
                break;
            case 'export-as-markdown':
                if (item.type === 'item' && item.content?.data) {
                    const blob = new Blob([item.content.data], { type: 'text/markdown;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${item.metadata.title.replace(/[^\w\s.-]/g, '') || 'untitled'}.md`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }
                break;
            default:
                console.warn(`未处理的自定义菜单动作: "${actionId}"`);
        }
    });
}

/**
 * 应用主入口函数
 */
async function main() {
    // --- [V2] 步骤 1: 初始化全局 ConfigManager ---
    // 这是整个应用生命周期中应该只执行一次的操作。
    // 我们在这里选择默认的 LocalStorageAdapter。
    const configManager = ConfigManager.getInstance({
        adapterOptions: { prefix: 'mdx_demo_app_' }
    });

    try {
        // [核心修复] 显式调用 bootstrap() 来启动应用。
        // 这个方法会负责加载所有急切（eager）的服务，并最终发布 'app:ready' 事件。
        // 我们只需要等待它完成即可。
        await configManager.bootstrap();
    } catch (err) {
        alert('应用核心配置加载失败！请检查控制台。');
        console.error(err);
        return; // 启动失败，终止后续操作
    }

    // --- [V2] 步骤 2: 初始化 SessionUI，并显式注入 ConfigManager ---
    // 每个 SessionUI 实例都需要一个唯一的 storageKey，它将作为 ModuleRepository 的 namespace。
    sessionUIManager = createSessionUI({
        sessionListContainer: sidebarContainer,
        storageKey: 'main-workspace', // 这个 key 用于隔离不同 sidebar 实例的数据
        contextMenu: {
            // 自定义右键菜单
            items: (item, defaultItems) => {
                const copyIdAction = { id: 'copy-id', label: '复制稳定ID', iconHTML: '<i class="fas fa-fingerprint"></i>' };
                const shareAction = { id: 'share-session', label: '分享...', iconHTML: '<i class="fas fa-share-alt"></i>', hidden: (it) => it.type !== 'item' };
                const exportAction = { id: 'export-as-markdown', label: '导出为 Markdown', iconHTML: '<i class="fas fa-file-export"></i>', hidden: (it) => it.type !== 'item' };
                
                // 返回一个全新的菜单结构
                return [
                    ...defaultItems,
                    { type: 'separator' },
                    shareAction,
                    exportAction,
                    copyIdAction
                ];
            }
        }
    }, configManager, 'main-workspace'); // [修复] V3 架构需要传入 namespace

    // --- 步骤 3: 初始化 MDxEditor ---
    editorInstance = new MDxEditor(editorContainer, {
        plugins: defaultPlugins,
        initialText: '请在左侧选择或创建一个会话...',
        initialMode: 'render',
        showToolbar: true,
        // [MODIFIED] 这里是连接两个库的关键
        titleBar: {
            // [修改] 设置一个初始的默认标题
            title: '编辑器', 
            toggleSidebarCallback: () => sessionUIManager.toggleSidebar(),
            enableToggleEditMode: true
        }
    });

    // 步骤 4: 连接两个库的事件监听
    connectLibraries();

    // 步骤 5: 设置应用级别的 UI 交互
    setupAppUIHandlers();

    // 步骤 6: 启动 SessionUI (它现在会通过 ConfigManager 加载数据)
    const initialSession = await sessionUIManager.start();

    // 步骤 7: 在启动后，根据初始状态同步UI
    // 同步侧边栏折叠状态
    const initialState = sessionUIManager.store.getState();
    appContainer.classList.toggle('sidebar-collapsed', initialState.isSidebarCollapsed);
    
    // 如果有初始激活的会话，加载其内容
    if (initialSession) {
        editorInstance.setText(initialSession.content?.data || '');
        editorInstance.setTitle(initialSession.metadata.title);
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', main);