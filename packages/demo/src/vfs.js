/**
 * @file @mdx/demo/vfs.js
 * @description MDxEditor + VFS-UI 完整功能演示脚本
 */

// --- 类型定义，用于 JSDoc 和智能提示 ---
/** 
 * @typedef {import('@itookit/common').ISessionManager} ISessionManager
 * @typedef {import('@itookit/vfs-ui').VFSNodeUI} VFSNodeUI 
 * @typedef {import('@itookit/vfs-ui').VFSService} VFSService
 * @typedef {import('@itookit/mdxeditor').MDxEditor} MDxEditor
 * @typedef {import('@itookit/vfs-core').VFSCore} VFSCore
 */

// --- 导入 VFS-UI 库 ---
import { createVFSUI } from '@itookit/vfs-ui';
import '@itookit/vfs-ui/style.css';

// --- 导入 MDxEditor 及其插件 ---
// [修正] 不再导入内部变量 defaultPlugins，而是导入 createMDxEditor 工厂函数
import { createMDxEditor } from '@itookit/mdxeditor';
import '@itookit/mdxeditor/style.css';

// --- 导入 vfs-core 的便利函数 ---
// [更新] 导入新的 createVFSCore 便利函数
import { createVFSCore } from '@itookit/vfs-core';

//-----------------------------------------------------------------

/** @type {MDxEditor | null} */
let editorInstance = null;
/** @type {ISessionManager | null} */
let vfsUIManager = null;
/** @type {VFSCore | null} */
let vfsCore = null;

const appContainer = document.getElementById('app-container');
const sidebarContainer = document.getElementById('sidebar-container');
const editorContainer = document.getElementById('editor-container');

// [新增] 用于防抖保存的控制器
const saveControllers = new Map();

/**
 * [新增] 辅助函数：安全地读取 VFS 节点内容并确保其为字符串格式。
 * @param {string} nodeId - The ID of the VFS node to read.
 * @returns {Promise<string>} The content as a string.
 */
async function readNodeContentAsString(nodeId) {
    const rawContent = await vfsCore.getVFS().read(nodeId);

    if (typeof rawContent === 'string') {
        return rawContent;
    }
    
    if (rawContent instanceof ArrayBuffer) {
        // 如果是二进制数据，尝试使用 UTF-8 解码。
        console.warn(`[Demo] Decoding ArrayBuffer from node ${nodeId} as UTF-8.`);
        const decoder = new TextDecoder('utf-8');
        return decoder.decode(rawContent);
    }

    // 对于 null, undefined 或其他意外类型，返回空字符串。
    return '';
}

/**
 * 为指定的 VFS 节点创建一个新的 MDxEditor 实例
 * @param {string | null} nodeId - VFS 节点的 ID
 * @param {string} initialContent - 初始 Markdown 内容 (现在确保是 string)
 * @param {string} title - 初始标题
 */
async function createEditorForNode(nodeId, initialContent, title) {
    if (editorInstance) {
        editorInstance.destroy();
        editorInstance = null;
    }
    editorContainer.innerHTML = '';

    if (!nodeId) {
        editorContainer.innerHTML = `<div class="editor-placeholder">请在左侧选择或创建一个文件...</div>`;
        return;
    }

    // [修正] 使用 createMDxEditor 工厂函数来异步创建和初始化编辑器实例
    // 这解决了 'defaultPlugins' 未导出 和 构造函数参数数量错误 的问题
    editorInstance = await createMDxEditor(editorContainer, {
        vfsCore: vfsCore,
        nodeId: nodeId,
        // plugins: defaultPlugins, // -> 工厂函数会自动加载默认插件
        initialContent: initialContent, // -> 属性名从 initialText 变为 initialContent
        initialMode: 'render',
        // showToolbar, showTitleBar 等选项现在由插件（如 ui:toolbar, core:titlebar）自动处理
        // 但我们可以通过 defaultPluginOptions 传递配置
        defaultPluginOptions: {
            'core:titlebar': {
                title: title,
                toggleSidebarCallback: () => vfsUIManager.toggleSidebar(),
                enableToggleEditMode: true
            }
        }
    });

    // 4. 为新实例设置事件监听：内容改变时通过防抖函数自动保存
    const debouncedSave = (() => {
        let timeout;
        return () => {
            clearTimeout(timeout);
            timeout = setTimeout(async () => {
                const activeFile = vfsUIManager.getActiveSession();
                // 确保我们仍在编辑同一个文件且编辑器实例存在
                if (activeFile && activeFile.id === nodeId && editorInstance) {
                    const newContent = editorInstance.getText();
                    // [API 修正] UI 层面通常使用 Node ID 操作，应通过 getVFS() 获取底层 VFS 实例来执行
                    await vfsCore.getVFS().write(activeFile.id, newContent);
                    console.log(`[Demo] Content saved for node ${nodeId}`);
                }
            }, 500); // 500ms 延迟
        };
    })();

    editorInstance.on('change', debouncedSave);

    // 清理并设置新的防抖控制器
    if (saveControllers.has(nodeId)) {
        clearTimeout(saveControllers.get(nodeId));
    }
    saveControllers.set(nodeId, debouncedSave);
}


/**
 * 连接 VFS-UI 库与 MDxEditor 的事件流
 */
function connectLibraries() {
    if (!vfsUIManager || !vfsCore) return;

    // 1. 当用户在侧边栏选择一个文件时，销毁旧编辑器，创建新编辑器
    vfsUIManager.on('sessionSelected', async ({ item }) => {
        console.log('[DemoApp] Event "sessionSelected" received with item:', item);
        if (item && item.type === 'file') {
            try {
                // [修正] 使用辅助函数确保获取到的是字符串
                const content = await readNodeContentAsString(item.id);
                await createEditorForNode(item.id, content, item.metadata.title);
            } catch (error) {
                console.error(`[DemoApp] Failed to read content for item ${item.id}`, error);
                const errorContent = `# 加载文件内容失败\n\n错误: ${error.message}`;
                await createEditorForNode(item.id, errorContent, '加载失败');
            }
        } else {
            console.log('[DemoApp] No item or item is not a file. Clearing editor.');
            await createEditorForNode(null, '', '');
        }
    });

    // 监听大纲导航请求
    vfsUIManager.on('navigateToHeading', ({ elementId }) => {
        if (!editorInstance) return;
        
        // [修正] 方法名从 switchTo 改为 switchToMode
        editorInstance.switchToMode('render');

        setTimeout(() => {
            // ... (剩余逻辑不变)
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
                if (e.target && typeof e.target.result === 'string') {
                    const content = e.target.result;
                    const title = file.name.replace(/\.(md|txt)$/, '');
                    // 使用 VFS-UI 提供的服务创建新文件
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
            case 'export-as-markdown':
                if (item.type === 'file') {
                    vfsCore.getVFS().read(item.id).then(content => {
                        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${item.metadata.title.replace(/[^\w\s.-]/g, '') || 'untitled'}.md`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    });
                }
                break;
            case 'copy-id':
                navigator.clipboard.writeText(item.id)
                    .then(() => alert(`ID "${item.id}" 已复制。`))
                    .catch(err => console.error('复制失败:', err));
                break;
            case 'share-file':
                alert(`正在分享文件: "${item.metadata.title}" (自定义操作)`);
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
        // [核心更新] 使用新的 createVFSCore 便利函数进行初始化
        // 传入 dbName 和 defaultModule，函数会自动处理实例创建和默认模块的挂载
        vfsCore = await createVFSCore({
            dbName: 'VFS_Demo_MindOS',
            defaultModule: 'notes'
        });
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
            items: (item, defaultItems) => [
                ...defaultItems,
                { type: 'separator' },
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
    }, vfsCore, 'notes'); // 传递已初始化的 vfsCore 实例和模块名

    // 步骤 3: 连接库事件 (编辑器初始化已移入事件回调)
    connectLibraries();

    // 步骤 4: 设置应用 UI 交互
    setupAppUIHandlers();

    // 步骤 5: 启动 VFS-UI，它会加载并显示文件列表，并返回上次会话或第一个文件
    const initialFile = await vfsUIManager.start();
    
    // 步骤 6: 根据 VFS-UI 的启动结果，创建初始编辑器
    if (initialFile) {
        // [修正] 使用辅助函数确保获取到的是字符串
        const content = await readNodeContentAsString(initialFile.id);
        await createEditorForNode(initialFile.id, content, initialFile.metadata.title);
    } else {
        await createEditorForNode(null, '', '');
    }
}

// 启动应用
document.addEventListener('DOMContentLoaded', main);
