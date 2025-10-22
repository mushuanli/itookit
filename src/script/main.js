// 文件: script/main.js

// --- 1. 从 lib 目录导入所有必需的模块 ---
//    (请确保这些路径与您的项目结构相匹配)

// 工作区工厂函数
import { MDxWorkspace } from '../lib/workspace/mdx/MDxWorkspace.js';
import { createLLMWorkspace } from '../lib/workspace/llm/index.js';
import { createSettingsWorkspace } from '../lib/workspace/settings/index.js';
import { ConfigManager } from '../lib/config/ConfigManager.js';
import {MDX_EDITOR_GUIDE_TEMPLATE} from '../lib/common/configData.js';

// 将所有应用逻辑都包裹在 DOMContentLoaded 事件中，确保 DOM 准备就绪
document.addEventListener('DOMContentLoaded', () => {

    // =========================================================================
    // === [核心重构] 应用级数据管理器初始化
    // =========================================================================
    // 在整个应用的生命周期中，只创建一个 ConfigManager 实例。
    // 所有工作区都将共享这个管理器，以实现数据服务的统一管理和跨模块通信。
    console.log("正在初始化应用级 ConfigManager...");
    const configManager = ConfigManager.getInstance({
        // 为 ConfigManager 内部的 LocalStorageAdapter 提供一个统一的前缀
        adapterOptions: { prefix: 'metaMind_' }
    });

    // --- 步骤 2: [关键修复] 先订阅，后启动 ---
    // 立即订阅 'app:ready' 事件。将所有依赖核心服务的 UI 初始化逻辑都放在这个回调中。
    // 这样可以保证，无论 bootstrap 过程多快完成，我们都不会错过 'app:ready' 事件。
    configManager.eventManager.subscribe('app:ready', () => {
        console.log("ConfigManager 已就绪，开始初始化 UI...");

        const initializedWorkspaces = {};
        const navContainer = document.querySelector('.main-nav-list');
        const workspaceViews = document.querySelectorAll('.workspace-view');

        // --- 导航与视图切换 ---
        navContainer.addEventListener('click', (event) => {
            const clickedLink = event.target.closest('.app-nav-btn');
            if (!clickedLink) return;
            event.preventDefault();
            const targetId = clickedLink.dataset.target;

            navContainer.querySelectorAll('.app-nav-btn').forEach(link => link.classList.remove('active'));
            clickedLink.classList.add('active');

            workspaceViews.forEach(view => {
                view.classList.toggle('active', view.id === targetId);
            });

            initializeWorkspace(targetId);
        });

        // --- 按需初始化工作区函数 ---
        async function initializeWorkspace(workspaceId) {
            if (initializedWorkspaces[workspaceId]) return;
            console.log(`正在初始化工作区: ${workspaceId}...`);

            try {
                // 获取全局单例的 configManager，此时它必定已存在
                const cm = ConfigManager.getInstance();

                switch (workspaceId) {
                    case 'anki-workspace':
                        const mdxWorkspace = new MDxWorkspace({
                            configManager: cm,
                            namespace: 'mdx_notes',
                            sidebarContainer: document.getElementById('mdx-sidebar'),
                            editorContainer: document.getElementById('mdx-editor'),
                            outlineContainer: document.getElementById('mdx-outline'),
                            newSessionTemplate: MDX_EDITOR_GUIDE_TEMPLATE, // <--- 在这里传入
                            editor: {showToolbar:true,clozeControl:true}
                        });
                        await mdxWorkspace.start();
                        initializedWorkspaces[workspaceId] = mdxWorkspace;
                        break;

                    case 'llm-workspace':
                        // [修正] 使用新的工厂函数签名，不再需要 chatUIConfig.connections/agents
                        const llmWorkspace = createLLMWorkspace({
                            configManager: cm,          // [必需] 注入全局管理器
                            namespace: 'llm_chats',     // [必需] 提供唯一的命名空间
                            sidebarContainer: document.getElementById('llm-sidebar'),
                            chatContainer: document.getElementById('llm-chat'),
                            sidebarConfig: { title: 'LLM 对话' }
                        });
                        await llmWorkspace.start();
                        initializedWorkspaces[workspaceId] = llmWorkspace; // 保存实例
                        break;

                    case 'settings-workspace':
                        // [修正] 使用新的工厂函数签名，并注入 configManager
                        const settingsWorkspace = createSettingsWorkspace({
                            configManager: cm,              // [必需] 注入全局管理器
                            namespace: 'global_settings',   // [必需] 提供唯一的命名空间
                            sidebarContainer: document.getElementById('settings-sidebar'),
                            settingsContainer: document.getElementById('settings-content'),
                            // widgets 将由 SettingsWorkspace 内部智能合并
                        });
                        await settingsWorkspace.start();
                        initializedWorkspaces[workspaceId] = settingsWorkspace;
                        break;
                }
                console.log(`工作区 ${workspaceId} 启动成功!`);
            } catch (error) {
                console.error(`初始化 ${workspaceId} 失败:`, error);
                const container = document.getElementById(workspaceId);
                if (container) {
                    container.innerHTML = `<div class="error-message">错误: 初始化 ${workspaceId} 失败。详情请查看控制台。</div>`;
                }
            }
        }

        // --- 首次加载 ---
        // 默认启动第一个工作区
        initializeWorkspace('anki-workspace');

        // 将核心实例暴露到 window 以方便调试
        window.app = {
            configManager: ConfigManager.getInstance(),
            getWorkspaces: () => initializedWorkspaces
        };
    });

    // --- 步骤 3: 触发启动流程 ---
    // 在监听器设置好之后，调用 bootstrap()。
    // 这个异步方法会执行数据加载，并在完成后发布 'app:ready' 事件，
    // 从而触发上面我们刚刚设置好的回调函数。
    configManager.bootstrap().catch(error => {
        // 捕获 bootstrap 过程本身可能抛出的致命错误
        console.error("ConfigManager 启动失败:", error);
        document.body.innerHTML = `<div class="error-message">应用核心服务启动失败，请检查控制台获取更多信息。</div>`;
    });

});
