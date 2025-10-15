// script/main.js

// --- 1. 从 lib 目录导入所有必需的模块 ---
//    (请确保这些路径与您的项目结构相匹配)

// 工作区工厂函数
import { MDxWorkspace } from '../lib/workspace/mdx/MDxWorkspace.js';
import { createLLMWorkspace } from '../lib/workspace/llm/index.js';
import { createSettingsWorkspace } from '../lib/workspace/settings/index.js';

// SettingsWorkspace 依赖
// ISettingsWidget 接口通常在运行时不需要，但在开发时用于类型提示和规范
// import { ISettingsWidget } from '../lib/common/interfaces/ISettingsWidget.js';
//import { LLMSettingsWidget } from '../lib/llm-kit/settingsUI/index.js';

// [核心重构] 导入 ConfigManager
import { ConfigManager } from '../lib/config/ConfigManager.js';


// --- 2. 主应用逻辑 ---
document.addEventListener('DOMContentLoaded', () => {

    // =========================================================================
    // === [核心重构] 应用级数据管理器初始化
    // =========================================================================
    // 在整个应用的生命周期中，只创建一个 ConfigManager 实例。
    // 所有工作区都将共享这个管理器，以实现数据服务的统一管理和跨模块通信。
    console.log("正在初始化应用级 ConfigManager...");
    const configManager = ConfigManager.getInstance({
        // 为 ConfigManager 内部的 LocalStorageAdapter 提供一个统一的前缀
        adapterOptions: { prefix: 'my_unified_app_' }
    });

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
                        configManager: configManager,
                        namespace: 'mdx_documents', // 数据隔离的命名空间
                        sidebarContainer: document.getElementById('mdx-sidebar'),
                        editorContainer: document.getElementById('mdx-editor'),
                    });
                    await mdxWorkspace.start();
                    initializedWorkspaces[workspaceId] = mdxWorkspace; // 保存实例
                    break;

                case 'llm-workspace':
                    // [修正] 使用新的工厂函数签名，不再需要 chatUIConfig.connections/agents
                    const llmWorkspace = createLLMWorkspace({
                        configManager: configManager,
                        namespace: 'llm_chats', // 数据隔离的命名空间
                        sidebarContainer: document.getElementById('llm-sidebar'),
                        chatContainer: document.getElementById('llm-chat'),
                        // chatUIConfig 和 sidebarConfig 仍然可以用于传递 UI 特定的配置
                        sidebarConfig: {
                            title: 'LLM 对话'
                        }
                    });
                    await llmWorkspace.start();
                    initializedWorkspaces[workspaceId] = llmWorkspace; // 保存实例
                    break;

                case 'settings-workspace':
                    // [修正] 使用新的工厂函数签名，并注入 configManager
                    const settingsWorkspace = createSettingsWorkspace({
                        configManager: configManager, // 注入 ConfigManager
                        namespace: 'global_settings', // 数据隔离的命名空间
                        sidebarContainer: document.getElementById('settings-sidebar'),
                        settingsContainer: document.getElementById('settings-content'),
                        widgets: [
                            //LLMSettingsWidget,
                        ]
                    });
                    await settingsWorkspace.start();
                    initializedWorkspaces[workspaceId] = settingsWorkspace; // 保存实例
                    break;
            }

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
    // [改进] 等待 ConfigManager 准备就绪后再启动第一个工作区
    // 这确保了在工作区尝试访问数据之前，所有全局配置都已加载完毕。
    configManager.eventManager.subscribe('app:ready', () => {
        console.log("ConfigManager is ready. Initializing default workspace...");
        // 默认启动 MDxWorkspace
        initializeWorkspace('mdx-workspace');
    });

    // [新增] 将核心实例暴露到 window 以方便调试
    window.app = {
        configManager,
        getWorkspaces: () => initializedWorkspaces
    };
});
