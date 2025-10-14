/**
 * @file @mdx/demo/session.js
 * @description MDxEditor + SessionUI 完整功能演示脚本
 */

// --- 导入重构后的 SessionUI 库 ---
import { createSessionUI } from '../sidebar/index.js';

// --- 导入重构后的 MDxEditor 及其插件 ---
import { MDxEditor, defaultPlugins } from '../mdx/editor/index.js';

// --- 导入新的持久化层模块 ---
import { DatabaseService } from '../sidebar/services/DatabaseService.js';
import {IndexedDBAdapter} from './demo-indexdbadapter.js';

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
 * 将 SessionUI 库与 MDxEditor 连接起来
 */
function connectLibraries() {
    if (!editorInstance || !sessionUIManager) return;

    // [REFACTORED] 1. 使用新的、更简洁的公共 API `manager.on()` 来监听事件
    sessionUIManager.on('sessionSelected', ({ session }) => {
        if (session?.type === 'session') {
            // 只有当内容不同时才更新，避免不必要的重渲染和光标丢失
            if (editorInstance.getText() !== session.content) {
                editorInstance.setText(session.content);
            }
            
            // [核心修改] 使用新 API 更新编辑器标题
            editorInstance.setTitle(session.title);

            // 切换到渲染模式
            editorInstance.switchTo('render');
        } else {
            // Handle case where selection is cleared
            editorInstance.setText('# 无会话被选中');
            // [核心修改] 恢复默认标题
            editorInstance.setTitle('无标题');
            editorInstance.switchTo('render');
        }
    });

    // 2. [架构优化] 使用 MDxEditor 新增的 'change' 事件 API 来实现自动保存
    editorInstance.on('change', () => {
        // 创建一个防抖函数来处理自动保存逻辑
        const debouncedSave = (() => {
            let timeout;
            return () => {
                clearTimeout(timeout);
                timeout = setTimeout(async () => {
                    const activeSession = sessionUIManager.getActiveSession();
                    if (activeSession?.type === 'session') {
                        const newContent = editorInstance.getText();
                        if (activeSession.content !== newContent) {
                            await sessionUIManager.updateSessionContent(activeSession.id, newContent);
                        }
                    }
                }, 500); // 500ms 延迟
            };
        })();
        
        debouncedSave();
    });

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
                setTimeout(() => targetEl.classList.add('highlight-heading'), 10);
            }
        }, 50);
    });
}

/**
 * [NEW] Handles the file import request from the SessionUI library.
 */
function handleImportRequest() {
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
                // sessionUIManager 没有 createSession 方法，但其内部 service 有
                // 更好的做法是在 UIManager 上暴露一个 createSession 接口
                // 暂时直接访问 service
                await sessionUIManager.sessionService.createSession({ title, content });
            };
            reader.readAsText(file);
        });
        document.body.removeChild(fileInput);
    };

    document.body.appendChild(fileInput);
    fileInput.click();
}

/**
 * 处理应用级别的 UI 逻辑，如侧边栏折叠
 */
function setupAppUIHandlers() {
    // 1. Listen for sidebar state changes from the library
    sessionUIManager.on('sidebarStateChanged', ({ isCollapsed }) => {
        // Apply the change to the main container's class
        appContainer.classList.toggle('sidebar-collapsed', isCollapsed);
    });

    // [REMOVED] The floating button event listener is no longer needed.
    // floatingToggleBtn.addEventListener('click', () => {
    //     sessionUIManager.toggleSidebar();
    // });
    
    // [REFACTORED] 监听导入请求
    sessionUIManager.on('importRequested', handleImportRequest);
    
    // --- [新增] 监听自定义菜单点击事件 ---
    sessionUIManager.on('menuItemClicked', ({ actionId, item }) => {
        switch (actionId) {
            case 'copy-id':
                navigator.clipboard.writeText(item.id)
                    .then(() => alert(`ID "${item.id}" 已复制到剪贴板。`))
                    .catch(err => console.error('复制失败:', err));
                break;
            case 'share-session':
                alert(`正在分享会话: "${item.title}"... (这是一个自定义操作)`);
                break;
            case 'export-as-markdown':
                if (item.type === 'session' && typeof item.content === 'string') {
                    const blob = new Blob([item.content], { type: 'text/markdown;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${item.title.replace(/[^\w\s.-]/g, '').replace(/[\s_]+/g, '_')}.md`;
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
    // --- 步骤 1: 配置并实例化持久化层 ---
    // 你可以在这里轻松切换 LocalStorage 和 IndexedDB
    // const persistenceAdapter = new LocalStorageAdapter({ prefix: 'mdx-demo' });
    const persistenceAdapter = new IndexedDBAdapter({ dbName: 'mdx-demo-db', storeName: 'app-data' });
    const dbService = new DatabaseService({ adapter: persistenceAdapter });

    // --- 步骤 2: 初始化 SessionUI ---
    // 必须先初始化 sidebar，以便在初始化 editor 时可以引用它的 manager
    sessionUIManager = createSessionUI({
        sessionListContainer: sidebarContainer,
        databaseService: dbService,
        contextMenu: {
            items: (item, defaultItems) => {
                const copyIdAction = { id: 'copy-id', label: '复制 ID', iconHTML: '<i class="fas fa-clipboard"></i>' };
                const shareAction = { id: 'share-session', label: '分享...', iconHTML: '<i class="fas fa-share-alt"></i>', hidden: (it) => it.type !== 'session' };
                const exportAction = { id: 'export-as-markdown', label: '导出为 Markdown', iconHTML: '<i class="fas fa-file-export"></i>', hidden: (it) => it.type !== 'session' };
                const renameItem = defaultItems.find(d => d.id === 'rename');
                const moveToItem = defaultItems.find(d => d.id === 'moveTo');
                const deleteItem = defaultItems.find(d => d.id === 'delete');
                const createItems = defaultItems.filter(d => d.id && d.id.startsWith('create-in-folder-'));
                let finalMenu = [];
                if (item.type === 'folder' && createItems.length > 0) finalMenu.push(...createItems, { type: 'separator' });
                if (renameItem) finalMenu.push(renameItem);
                if (moveToItem) finalMenu.push(moveToItem);
                finalMenu.push({ type: 'separator' }, shareAction, exportAction, copyIdAction);
                if (deleteItem) finalMenu.push({ type: 'separator' }, deleteItem);
                return finalMenu;
            }
        }
    });

    // --- 步骤 3: 初始化 MDxEditor，并传入连接回调 ---
    editorInstance = new MDxEditor(editorContainer, {
        plugins: defaultPlugins,
        initialText: '请在左侧选择或创建一个会话...',
        initialMode: 'edit', // Start in edit mode to see the button immediately
        showToolbar: true,
        // [MODIFIED] 这里是连接两个库的关键
        titleBar: {
            // [修改] 设置一个初始的默认标题
            title: '编辑器', 
            toggleSidebarCallback: () => sessionUIManager.toggleSidebar(),
            enableToggleEditMode: true
        }
    });

    // 步骤 4: 连接库的事件监听
    connectLibraries();

    // 步骤 5: 设置应用级别的 UI 交互
    setupAppUIHandlers();

    // 步骤 6: 启动 SessionUI (它将从 IndexedDB 加载数据)
    await sessionUIManager.start();

    // 启动后，根据 store 的初始状态同步 UI
    const initialState = sessionUIManager.store.getState();
    appContainer.classList.toggle('sidebar-collapsed', initialState.isSidebarCollapsed);
    
    const initialSession = sessionUIManager.getActiveSession();
    if (initialSession) {
        if (editorInstance.getText() !== initialSession.content) {
            editorInstance.setText(initialSession.content);
        }
        // [新增] 在应用启动时，也根据初始会话设置标题
        editorInstance.setTitle(initialSession.title);
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', main);