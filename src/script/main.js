// 文件: script/main.js

// --- 导入工厂函数 ---
import { createMDxWorkspace } from '../lib/workspace/mdx/index.js';
import { createLLMWorkspace } from '../lib/workspace/llm/index.js';
import { createSettingsWorkspace } from '../lib/workspace/settings/index.js';
import { ConfigManager } from '../lib/configManager/index.js';
import { MDX_EDITOR_GUIDE_TEMPLATE } from '../lib/common/configData.js';

// 将所有应用逻辑都包裹在 DOMContentLoaded 事件中，确保 DOM 准备就绪
document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 应用启动中...");

    // =========================================================================
    // 步骤 1: 初始化 ConfigManager
    // =========================================================================
    const configManager = ConfigManager.getInstance();
    
    try {
        await configManager.init();
        console.log("✅ ConfigManager 初始化完成");
    } catch (error) {
        console.error("❌ ConfigManager 初始化失败:", error);
        document.body.innerHTML = `
            <div class="error-message">
                应用初始化失败: ${error.message}
            </div>
        `;
        return;
    }

    // =========================================================================
    // 步骤 2: 设置 UI 和导航
    // =========================================================================
    const initializedWorkspaces = {};
    const navContainer = document.querySelector('.main-nav-list');
    const workspaceViews = document.querySelectorAll('.workspace-view');

    // 导航点击事件
    navContainer.addEventListener('click', (event) => {
        const clickedLink = event.target.closest('.app-nav-btn');
        if (!clickedLink) return;
        event.preventDefault();
        
        const targetId = clickedLink.dataset.target;

        // 更新激活状态
        navContainer.querySelectorAll('.app-nav-btn')
            .forEach(link => link.classList.remove('active'));
        clickedLink.classList.add('active');

        workspaceViews.forEach(view => {
            view.classList.toggle('active', view.id === targetId);
        });

        // 初始化工作区（如果还未初始化）
        initializeWorkspace(targetId);
    });

    // =========================================================================
    // 步骤 3: 工作区按需初始化函数
    // =========================================================================
    async function initializeWorkspace(workspaceId) {
        // 如果已初始化，直接返回
        if (initializedWorkspaces[workspaceId]) {
            console.log(`📋 工作区 "${workspaceId}" 已初始化，跳过`);
            return;
        }

        console.log(`⚙️ 正在初始化工作区: ${workspaceId}...`);
        const startTime = performance.now();

        try {
            switch (workspaceId) {
                case 'anki-workspace': {
                    // ✅ 使用工厂函数，一步到位
                    const mdxWorkspace = await createMDxWorkspace({
                        configManager,
                        namespace: 'mdx_notes',
                        sidebarContainer: document.getElementById('mdx-sidebar'),
                        editorContainer: document.getElementById('mdx-editor'),
                        outlineContainer: document.getElementById('mdx-outline'),
                        newSessionTemplate: MDX_EDITOR_GUIDE_TEMPLATE,
                        editor: { 
                            showToolbar: true, 
                            clozeControl: true 
                        }
                    });
                    initializedWorkspaces[workspaceId] = mdxWorkspace;
                    break;
                }

                case 'llm-workspace': {
                    // ✅ 使用工厂函数，一步到位（不再调用 start）
                    const llmWorkspace = await createLLMWorkspace({
                        configManager,
                        namespace: 'llm_chats',
                        sidebarContainer: document.getElementById('llm-sidebar'),
                        chatContainer: document.getElementById('llm-chat'),
                        sidebarConfig: { title: 'LLM 对话' }
                    });
                    initializedWorkspaces[workspaceId] = llmWorkspace;
                    break;
                }

                case 'settings-workspace': {
                    // ✅ 使用工厂函数，一步到位（不再调用 start）
                    const settingsWorkspace = await createSettingsWorkspace({
                        configManager,
                        namespace: 'global_settings',
                        sidebarContainer: document.getElementById('settings-sidebar'),
                        settingsContainer: document.getElementById('settings-content'),
                    });
                    initializedWorkspaces[workspaceId] = settingsWorkspace;
                    break;
                }

                default:
                    console.warn(`⚠️ 未知的工作区: ${workspaceId}`);
                    return;
            }

            const elapsed = (performance.now() - startTime).toFixed(2);
            console.log(`✅ 工作区 "${workspaceId}" 启动成功 (耗时 ${elapsed}ms)`);

        } catch (error) {
            console.error(`❌ 初始化 "${workspaceId}" 失败:`, error);
            
            // 显示友好的错误消息
            const container = document.getElementById(workspaceId);
            if (container) {
                container.innerHTML = `
                    <div class="error-message">
                        <h3>❌ 初始化失败</h3>
                        <p><strong>工作区:</strong> ${workspaceId}</p>
                        <p><strong>错误:</strong> ${error.message}</p>
                        <details>
                            <summary>详细信息</summary>
                            <pre>${error.stack || '无堆栈信息'}</pre>
                        </details>
                    </div>
                `;
            }
        }
    }

    // =========================================================================
    // 步骤 4: 启动默认工作区
    // =========================================================================
    await initializeWorkspace('anki-workspace');

    // =========================================================================
    // 步骤 5: 暴露调试接口
    // =========================================================================
    window.app = {
        configManager,
        workspaces: initializedWorkspaces,
        getWorkspace: (id) => initializedWorkspaces[id],
        getAllWorkspaceIds: () => Object.keys(initializedWorkspaces),
    };

    console.log("✅ 应用启动完成！");
    console.log("💡 提示: 使用 window.app 访问应用实例");
});
