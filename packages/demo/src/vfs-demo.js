/**
 * @file @mdx/demo/vfs-demo.js
 * @description MDxEditor + VFS-UI 完整功能演示脚本
 * @description 这个演示展示了如何初始化和使用基于 vfs-core 的 VFS-UI 库。
 */

// --- 导入 VFS-UI 库 ---
import { createVFSUI } from '@itookit/vfs-ui';
import '@itookit/vfs-ui/style.css';

// --- 导入 MDxEditor 及其插件 ---
import { MDxEditor, defaultPlugins } from '@itookit/mdxeditor';
import '@itookit/mdxeditor/style.css';

// --- 导入 vfs-core ---
import { getVFSManager } from '@itookit/vfs-core';

//-----------------------------------------------------------------

/** @type {MDxEditor | null} */
let editorInstance = null;
/** @type {import('@itookit/vfs-ui').IVSUIManager | null} */
let vfsUIManager = null;

const appContainer = document.getElementById('app-container');
const sidebarContainer = document.getElementById('sidebar-container');
const editorContainer = document.getElementById('editor-container');
const vfsCore = getVFSManager();

// [新增] 用于防抖保存的控制器
const saveControllers = new Map();

/**
 * [重构] 为指定的 VFS 节点创建一个新的 MDxEditor 实例
 * @param {string | null} nodeId - VFS 节点的 ID
 * @param {string} initialContent - 初始 Markdown 内容
 * @param {string} title - 初始标题
 */
function createEditorForNode(nodeId, initialContent, title) {
    // 1. 如果已存在编辑器实例，先销毁它
    if (editorInstance) {
        editorInstance.destroy();
        editorInstance = null;
    }
    // 清空编辑器容器
    editorContainer.innerHTML = '';

    // 2. 如果没有 nodeId（例如，没有文件被选中），显示提示信息
    if (!nodeId) {
        editorContainer.innerHTML = `<div class="editor-placeholder">请在左侧选择或创建一个文件...</div>`;
        return;
    }

    // 3. 创建新的 MDxEditor 实例，并传入 vfsCore 和 nodeId
    editorInstance = new MDxEditor(editorContainer, {
        // --- 核心修复 ---
        vfsCore: vfsCore,
        nodeId: nodeId,
        // -----------------
        plugins: defaultPlugins,
        initialText: initialContent,
        initialMode: 'render',
        showToolbar: true,
        showTitleBar: true,
        titleBar: {
            title: title,
            toggleSidebarCallback: () => vfsUIManager.toggleSidebar(),
            enableToggleEditMode: true
        }
    });

    // 4. 为新实例设置事件监听
    // 每次内容改变时，通过防抖函数自动保存回 vfs-core
    const debouncedSave = (() => {
        let timeout;
        return () => {
            clearTimeout(timeout);
            timeout = setTimeout(async () => {
                const activeFile = vfsUIManager.getActiveSession();
                // 确保我们仍在编辑同一个文件
                if (activeFile && activeFile.id === nodeId) {
                    const newContent = editorInstance.getText();
                    await vfsCore.write(activeFile.id, newContent);
                    console.log(`[Demo] Content saved for ${nodeId}`);
                }
            }, 500); // 500ms 延迟
        };
    })();

    editorInstance.on('change', debouncedSave);

    // 清理旧的防抖控制器（如果存在）
    if (saveControllers.has(nodeId)) {
        clearTimeout(saveControllers.get(nodeId));
    }
    saveControllers.set(nodeId, debouncedSave);
}


/**
 * 连接 VFS-UI 库与 MDxEditor 的事件流
 */
function connectLibraries() {
    if (!vfsUIManager) return;

    // 1. 当用户在侧边栏选择一个文件时，销毁旧编辑器，创建新编辑器
    vfsUIManager.on('sessionSelected', async ({ item }) => {
        if (item && item.type === 'file') {
            try {
                const result = await vfsCore.read(item.id);
                const content = result.content || '';
                // 触发编辑器重建
                createEditorForNode(item.id, content, item.metadata.title);
            } catch (error) {
                console.error(`Failed to read content for item ${item.id}`, error);
                const errorContent = `# 加载文件内容失败\n\n错误: ${error.message}`;
                // 即使加载失败，也创建一个带有错误信息的编辑器实例
                createEditorForNode(item.id, errorContent, '加载失败');
            }
        } else {
            // 没有文件被选中，销毁编辑器并显示占位符
            createEditorForNode(null, '', '');
        }
    });

    // 2. 监听大纲导航请求
    vfsUIManager.on('navigateToHeading', ({ elementId }) => {
        if (!editorInstance) return;
        
        editorInstance.switchTo('render');
        setTimeout(() => {
            const renderEl = editorContainer.querySelector('.mdx-render-view');
            const targetEl = renderEl?.querySelector(`#${elementId}`);
            if (targetEl instanceof HTMLElement) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                targetEl.style.transition = 'none';
                targetEl.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
                setTimeout(() => {
                    if (targetEl instanceof HTMLElement) {
                        targetEl.style.transition = 'background-color 0.5s ease';
                        targetEl.style.backgroundColor = 'transparent';
                    }
                }, 500);
            }
        }, 50);
    });
}

/**
 * 处理来自 VFS-UI 的文件导入请求
 * @param {{ parentId: string | null }} payload
 */
function handleImportRequest({ parentId }) {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.md,.txt';
    fileInput.multiple = true;
    fileInput.style.display = 'none';

    fileInput.onchange = () => {
        if (!fileInput.files) return;
        Array.from(fileInput.files).forEach(file => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                // [MODIFIED] 添加类型检查，增强代码健壮性
                if (e.target && typeof e.target.result === 'string') {
                    const content = e.target.result;
                    const title = file.name.replace(/\.(md|txt)$/, '');
                    // [JSDOC FIX] 使用公共接口中定义的 `createSession` 方法，而不是 `createFile`
                    await vfsUIManager.sessionService.createSession({ title, content, parentId });
                }
            };
            reader.readAsText(file);
        });
        document.body.removeChild(fileInput);
    };

    document.body.appendChild(fileInput);
    fileInput.click();
}

/**
 * 设置应用级别的 UI 交互
 */
function setupAppUIHandlers() {
    vfsUIManager.on('sidebarStateChanged', ({ isCollapsed }) => {
        appContainer.classList.toggle('sidebar-collapsed', isCollapsed);
    });

    vfsUIManager.on('importRequested', handleImportRequest);
    
    vfsUIManager.on('menuItemClicked', ({ actionId, item }) => {
        switch (actionId) {
            case 'copy-id':
                navigator.clipboard.writeText(item.id)
                    .then(() => alert(`ID "${item.id}" 已复制。`))
                    .catch(err => console.error('复制失败:', err));
                break;
            case 'share-file':
                alert(`正在分享文件: "${item.metadata.title}" (自定义操作)`);
                break;
            case 'export-as-markdown':
                if (item.type === 'file') {
                    // [API FIX] 直接使用 vfsCore 变量
                    vfsCore.read(item.id).then(result => {
                        const blob = new Blob([result.content], { type: 'text/markdown;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${item.metadata.title.replace(/[^\w\s.-]/g, '') || 'untitled'}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                    });
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
    // --- 步骤 1: 初始化 vfs-core ---
    try {
        // [修改] 在 init 调用中传入 storage 配置，指定数据库名称
        await vfsCore.init({
            storage: { dbName: 'VFS_Demo_MindOS' }
        });
        
        // 确保我们的演示模块已挂载
        if (!vfsCore.getModule('notes')) {
            await vfsCore.mount('notes', { description: '我的笔记' });
        }
        console.log('vfs-core initialized and "notes" module is ready.');
    } catch (err) {
        alert('应用核心存储加载失败！请检查控制台。');
        console.error(err);
        return;
    }

    // --- 步骤 2: 初始化 VFS-UI ---
    vfsUIManager = createVFSUI({
        sessionListContainer: sidebarContainer,
        title: "我的笔记",
        contextMenu: {
            // [MENU ITEM FIX] Add required properties to separator
            items: (item, defaultItems) => [
                ...defaultItems,
                { type: 'separator', id: 'sep1', label: '' }, // Add id and label
                { 
                    id: 'share-file', 
                    label: '分享...', 
                    iconHTML: '<i class="fas fa-share-alt"></i>', 
                    hidden: (it) => it.type !== 'file' 
                },
                { 
                    id: 'export-as-markdown', 
                    label: '导出为 Markdown', 
                    iconHTML: '<i class="fas fa-file-export"></i>', 
                    hidden: (it) => it.type !== 'file' 
                },
                { 
                    id: 'copy-id', 
                    label: '复制节点ID', 
                    iconHTML: '<i class="fas fa-fingerprint"></i>' 
                }
            ]
        }
    }, vfsCore, 'notes');

    // --- 步骤 3: 初始化 MDxEditor ---
    // [修改] 编辑器初始化被移至 createEditorForNode 函数中，这里不再需要
    // editorInstance = new MDxEditor(...) // <--- 删除这一整块

    // 步骤 4: 连接两个库的事件
    connectLibraries();

    // 步骤 5: 设置应用级别的 UI 交互
    setupAppUIHandlers();

    // 步骤 6: 启动 VFS-UI
    const initialFile = await vfsUIManager.start();

    // [LISTDIRECTORY FIX] Use correct API
    console.log('[Demo] VFS initialized, checking for existing files...');
    const notesModule = vfsCore.getModule('notes');
    if (notesModule && notesModule.rootId) {
        try {
            const files = await vfsCore.readdir(notesModule.rootId);
            console.log('[Demo] Files in notes root:', files);
        } catch (error) {
            console.error('[Demo] Error listing files in root:', error);
        }
    } else {
        console.warn('[Demo] "notes" module or its rootId not found.');
    }
    
    // [修改] 根据 initialFile 的存在与否，手动触发一次编辑器的创建
    if (initialFile) {
        // [VFSCORE FIX] Use the top-level vfsCore instance
        const result = await vfsCore.read(initialFile.id);
        createEditorForNode(initialFile.id, result.content || '', initialFile.metadata.title);
    } else {
        createEditorForNode(null, '', ''); // 如果没有初始文件，则显示占位符
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', main);
