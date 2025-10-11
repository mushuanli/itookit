// script/main.js

// --- 1. 从 lib 目录导入所有必需的模块 ---
//    (请确保这些路径与您的项目结构相匹配)

// 工作区工厂函数
import { MDxWorkspace } from '../lib/workspace/mdx/MDxWorkspace.js';
import { createLLMWorkspace } from '../lib/workspace/llm/index.js';
import { createSettingsWorkspace } from '../lib/workspace/settings/index.js';

// SettingsWorkspace 依赖
import { ISettingsWidget } from '../lib/common/interfaces/ISettingsWidget.js';
import { LLMSettingsWidget } from '../lib/llm-kit/settingsUI/index.js';

// 通用数据存储适配器
import { LocalStorageAdapter } from '../lib/common/store/default/LocalStorageAdapter.js';


// --- 3. 主应用逻辑 ---
document.addEventListener('DOMContentLoaded', () => {

    // --- 共享资源 ---
    // 为整个应用创建一个共享的数据库适配器实例
    const sharedDatabaseAdapter = new LocalStorageAdapter({ prefix: 'my-app' });
    // 跟踪已初始化的工作区，避免重复创建
    const initializedWorkspaces = {};


    // --- 导航与视图切换 ---
    const navContainer = document.querySelector('.main-nav-list');
    const workspaceViews = document.querySelectorAll('.workspace-view');

    navContainer.addEventListener('click', (event) => {
        const clickedLink = event.target.closest('.app-nav-btn');
        if (!clickedLink) return;
        event.preventDefault();

        const targetId = clickedLink.dataset.target;

        // 切换导航链接的 active 状态
        navContainer.querySelectorAll('.app-nav-btn').forEach(link => link.classList.remove('active'));
        clickedLink.classList.add('active');

        // 切换工作区视图的 active 状态
        workspaceViews.forEach(view => {
            view.classList.toggle('active', view.id === targetId);
        });

        // 按需初始化工作区
        initializeWorkspace(targetId);
    });

    // --- 按需初始化函数 ---
    async function initializeWorkspace(workspaceId) {
        // 如果已经初始化，则直接返回
        if (initializedWorkspaces[workspaceId]) {
            return;
        }

        console.log(`Initializing ${workspaceId}...`);

        try {
            switch (workspaceId) {
                case 'mdx-workspace':
                    const mdxWorkspace = new MDxWorkspace({
                        sidebarContainer: document.getElementById('mdx-sidebar'),
                        editorContainer: document.getElementById('mdx-editor'),
                        storage: {
                            adapter: sharedDatabaseAdapter,
                            namespace: 'mdx_documents' // 数据库前缀
                        }
                    });
                    await mdxWorkspace.start();
                    break;

                case 'llm-workspace':
                    const llmWorkspace = createLLMWorkspace({
                        sidebarContainer: document.getElementById('llm-sidebar'),
                        chatContainer: document.getElementById('llm-chat'),
                        storage: {
                            adapter: sharedDatabaseAdapter,
                            namespace: 'llm_chats' // 数据库前缀
                        },
                        // LLM Workspace 需要一些最小化的配置
                        chatUIConfig: {
                            connections: [],
                            agents: []
                        }
                    });
                    await llmWorkspace.start();
                    break;

                case 'settings-workspace':
                    const settingsWorkspace = createSettingsWorkspace({
                        sidebarContainer: document.getElementById('settings-sidebar'),
                        settingsContainer: document.getElementById('settings-content'),
                        storage: {
                            adapter: sharedDatabaseAdapter,
                            namespace: 'global_settings' // 数据库前缀
                        },
                        // **关键修复**:
                        // 显式传入一个包含默认组件和自定义组件的数组。
                        // 这会覆盖构造函数中的默认值，但确保了 LLMSettingsWidget 存在。
                        widgets: [
                            LLMSettingsWidget,
                        ]
                    });
                    await settingsWorkspace.start();
                    break;
            }

            // 标记为已初始化
            initializedWorkspaces[workspaceId] = true;
            console.log(`${workspaceId} started successfully!`);

        } catch (error) {
            console.error(`Failed to initialize ${workspaceId}:`, error);
            const container = document.getElementById(workspaceId);
            if (container) {
                container.innerHTML = `<div style="color: red; padding: 20px;">Error initializing ${workspaceId}. See console for details.</div>`;
            }
        }
    }

    // --- 首次加载 ---
    // 初始化默认显示的 MDxWorkspace
    initializeWorkspace('mdx-workspace');
});
