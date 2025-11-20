/**
 * @file apps/web-app/src/main.ts
 */
import { MemoryManager } from '@itookit/memory-manager';
import { initVFS } from './services/vfs';
import { defaultEditorFactory } from './factories/editorFactory';
import { initSidebarNavigation } from './utils/layout';
import { WORKSPACES } from './config/modules';

// 引入样式 (假设构建工具支持 CSS 导入)
import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
// 如果 memory-manager 的样式未在 HTML 中引入，也需在此引入
// import '@itookit/memory-manager/style.css'; 

async function bootstrap() {
    try {
        // 1. 初始化布局交互 (Tab 切换)
        initSidebarNavigation();

        // 2. 初始化文件系统核心
        const vfsCore = await initVFS();

        // 3. 为每个工作区初始化 MemoryManager
        // MemoryManager 会接管 DOM 容器 (e.g., #prompt-workspace)
        // 并创建侧边栏(VFS-UI) + 编辑器区域(MDxEditor)
        const managers: MemoryManager[] = [];

        for (const ws of WORKSPACES) {
            const container = document.getElementById(ws.elementId);

            if (!container) {
                console.warn(`Container #${ws.elementId} not found.`);
                continue;
            }

            // 创建管理器实例
            const manager = new MemoryManager({
                container: container,
                vfsCore: vfsCore,
                moduleName: ws.moduleName,
                editorFactory: defaultEditorFactory,

                // UI 配置
                uiOptions: {
                    title: ws.title, // 侧边栏顶部标题
                    initialSidebarCollapsed: false,
                    searchPlaceholder: `Search inside ${ws.title}...`
                },

                // 可选：启用后台 AI 分析
                aiConfig: {
                    enabled: true,
                    activeRules: ['user', 'tag', 'file'] // 分析 mentions
                }
            });

            // 启动管理器 (加载文件列表，恢复会话)
            await manager.start();
            managers.push(manager);
        }

        console.log('Application started successfully.');

        // 4. (可选) 处理 Settings 工作区
        // Settings 通常是自定义 UI，不是文件管理器，所以单独处理
        initSettingsWorkspace();

    } catch (error) {
        console.error('Failed to bootstrap application:', error);
    }
}

/**
 * 设置页面的简单初始化逻辑
 */
function initSettingsWorkspace() {
    const container = document.getElementById('settings-content');
    if (container) {
        container.innerHTML = `
            <div style="padding: 2rem;">
                <h2>Settings</h2>
                <p>Application version: 1.0.0</p>
                <!-- 这里可以挂载具体的 React/Vue 设置组件 -->
            </div>
        `;
    }
}

// 启动应用
bootstrap();
