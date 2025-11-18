/**
 * @file @mdx/demo/vfs.js
 * @description MDxEditor + VFS-UI 完整功能演示脚本
 */

// --- 类型定义，用于 JSDoc 和智能提示 ---
/** 
 * @typedef {import('@itookit/common').IEditor} IEditor
 * @typedef {import('@itookit/common').EditorOptions} EditorOptions
 * @typedef {import('@itookit/common').ISessionManager} ISessionManager
 * @typedef {import('@itookit/vfs-ui').VFSNodeUI} VFSNodeUI 
 * @typedef {import('@itookit/vfs-ui').VFSService} VFSService
 * @typedef {import('@itookit/vfs-core').VFSCore} VFSCore
 */

// --- 导入 VFS-UI 库 ---
import { createVFSUI, connectEditorLifecycle } from '@itookit/vfs-ui';
import '@itookit/vfs-ui/style.css';

// --- 导入 MDxEditor 及其插件 ---
// ✨ [最终] 应用层是唯一需要知道具体编辑器实现的地方
import { createMDxEditor } from '@itookit/mdxeditor';
import '@itookit/mdxeditor/style.css';

// --- 导入 vfs-core 的便利函数 ---
import { createVFSCore } from '@itookit/vfs-core';

//-----------------------------------------------------------------

/** @type {IEditor | null} */
let currentEditorInstance = null; // 用于响应 UI 事件，如大纲导航

/**
 * 设置与编辑器生命周期无关的应用级别 UI 交互。
 * @param {ISessionManager<any, any>} vfsUIManager 
 * @param {VFSCore} vfsCore 
 */
function setupAppUIHandlers(vfsUIManager, vfsCore) {
    const appContainer = document.getElementById('app-container');

    // 监听侧边栏折叠状态变化
    vfsUIManager.on('sidebarStateChanged', ({ isCollapsed }) => {
        appContainer.classList.toggle('sidebar-collapsed', isCollapsed);
    });

    // 监听大纲导航请求
    vfsUIManager.on('navigateToHeading', ({ elementId }) => {
        if (!currentEditorInstance) return;

        // @ts-ignore MDxEditor 特有的逻辑：确保在渲染模式下导航
        if (currentEditorInstance && typeof currentEditorInstance.switchToMode === 'function') {
            // @ts-ignore
            currentEditorInstance.switchToMode('render');
        }

        setTimeout(() => {
            currentEditorInstance.navigateTo({ elementId });

            // 添加视觉高亮效果 (可选)
            const editorContainer = document.getElementById('editor-container');
            const renderEl = editorContainer?.querySelector('.mdx-render-view');
            const targetEl = renderEl?.querySelector(`#${elementId}`);

            if (targetEl instanceof HTMLElement) {
                targetEl.style.transition = 'none';
                targetEl.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
                setTimeout(() => {
                    targetEl.style.transition = 'background-color 0.5s ease';
                    targetEl.style.backgroundColor = 'transparent';
                }, 1000);
            }
        }, 50); // 短暂延迟确保视图切换完成
    });

    // 监听文件导入请求
    vfsUIManager.on('importRequested', ({ parentId }) => {
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
                    if (e.target?.result && typeof e.target.result === 'string') {
                        const content = e.target.result;
                        const title = file.name.replace(/\.(md|txt)$/, '');
                        await vfsUIManager.sessionService.createSession({ title, content, parentId });
                    }
                };
                reader.readAsText(file);
            });
            document.body.removeChild(fileInput);
        };

        document.body.appendChild(fileInput);
        fileInput.click();
    });

    // 监听自定义菜单项点击
    vfsUIManager.on('menuItemClicked', async ({ actionId, item }) => {
        switch (actionId) {
            case 'export-as-markdown':
                if (item.type === 'file') {
                    const content = await vfsCore.getVFS().read(item.id);
                    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
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
    const vfsCore = await createVFSCore({
        dbName: 'VFS_Demo_MindOS_Connector',
        defaultModule: 'notes'
    });
    console.log('vfs-core initialized and "notes" module is ready.');

    // --- 步骤 2: 初始化 VFS-UI ---
    const vfsUIManager = createVFSUI({
        sessionListContainer: document.getElementById('sidebar-container'),
        title: "我的笔记",
        contextMenu: {
            items: (item, defaultItems) => [
                ...defaultItems,
                { type: 'separator' },
                { id: 'share-file', label: '分享...', iconHTML: '<i class="fas fa-share-alt"></i>', hidden: (it) => it.type !== 'file' },
                { id: 'export-as-markdown', label: '导出为 Markdown', iconHTML: '<i class="fas fa-file-export"></i>', hidden: (it) => it.type !== 'file' },
                { id: 'copy-id', label: '复制节点ID', iconHTML: '<i class="fas fa-fingerprint"></i>' }
            ]
        }
    }, vfsCore, 'notes');

    /**
     * ✨ [最终] 这是适配器模式的最佳实践。
     * 我们创建一个符合标准EditorFactory签名的函数，
     * 其内部将通用的options转换为mdxeditor所需的特定配置。
     * @param {HTMLElement} container
     * @param {EditorOptions} options - 来自 connectEditorLifecycle 的标准选项
     * @returns {Promise<IEditor>}
     */
    const mdxEditorFactoryAdapter = (container, options) => {
    console.log(`[vfs.js Factory] Received options. Content length: ${(options.initialContent || '').length}. Preview: "${(options.initialContent || '').substring(0, 50)}..."`);
        const mdxConfig = {
            // 1. 传递所有通用选项
            ...options,
            
            // 2. 添加或覆盖MDxEditor特定的配置
            vfsCore: vfsCore, 
            initialMode: 'render',
            plugins: [
                'core:titlebar',
                'ui:toolbar',
                'ui:formatting',
                'mathjax',
                'folder',
                'media',
                'mermaid',
                'task-list',
                'codeblock-controls',
                'interaction:source-sync'
            ],
            defaultPluginOptions: {
                'core:titlebar': {
                    // 使用从options传入的title
                    title: options.title, 
                    toggleSidebarCallback: () => vfsUIManager.toggleSidebar(),
                    enableToggleEditMode: true
                }
            }
        };
        
        // 调用具体的编辑器创建函数
        return createMDxEditor(container, mdxConfig);
    };

    // --- 步骤 4: 使用连接器将 VFS-UI 和编辑器连接起来 ---
    connectEditorLifecycle(
        vfsUIManager,
        vfsCore,
        document.getElementById('editor-container'),
        mdxEditorFactoryAdapter, // <-- 注入我们的适配器
        {
            // [新] 使用回调来追踪当前编辑器实例
            onEditorCreated: (editor) => {
                currentEditorInstance = editor;
            }
        }
    );
    
    // --- 步骤 5: 设置应用 UI 交互 ---
    setupAppUIHandlers(vfsUIManager, vfsCore);

    // --- 步骤 6: 启动 VFS-UI ---
    // 连接器会自动处理初始文件的加载和编辑器的创建
    await vfsUIManager.start();
}

// 启动应用
document.addEventListener('DOMContentLoaded', main);
