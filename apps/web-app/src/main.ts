/**
 * @file apps/web-app/src/main.ts
 */
import { MemoryManager } from '@itookit/memory-manager';
import { initVFS } from './services/vfs';
import { defaultEditorFactory } from './factories/editorFactory';
import { initSidebarNavigation } from './utils/layout';
import { WORKSPACES } from './config/modules';

// 引入样式
import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/memory-manager/style.css'; 
import './styles/index.css'; 

// 状态缓存：记录已经初始化的 Manager，防止重复创建
const managerCache = new Map<string, MemoryManager>();

async function bootstrap() {
    try {
        // 1. 核心初始化 (VFS 必须先就绪)
        const vfsCore = await initVFS();
        
        // 2. 定义单个工作区的加载函数
        const loadWorkspace = async (targetId: string) => {
            // 2.1 如果是设置页，单独处理（因为它不在 WORKSPACES 列表里）
            if (targetId === 'settings-workspace') {
                initSettingsWorkspace();
                return;
            }

            // 2.2 检查是否已经加载过
            if (managerCache.has(targetId)) {
                // console.log(`Workspace ${targetId} already loaded.`);
                return;
            }

            // 2.3 查找配置
            const wsConfig = WORKSPACES.find(w => w.elementId === targetId);
            if (!wsConfig) {
                console.warn(`No configuration found for workspace: ${targetId}`);
                return;
            }

            const container = document.getElementById(wsConfig.elementId);
            if (!container) return;

            console.log(`Lazy loading workspace: ${wsConfig.title}...`);

            // ✅ 关键修改：确保容器在初始化时可见
            const wasActive = container.classList.contains('active');
            if (!wasActive) {
                container.classList.add('active');
            }

            // 2.4 创建实例
            const manager = new MemoryManager({
                container: container,
                vfsCore: vfsCore,
                moduleName: wsConfig.moduleName,
                editorFactory: defaultEditorFactory,
                uiOptions: {
                    title: wsConfig.title,
                    initialSidebarCollapsed: false,
                    searchPlaceholder: `Search inside ${wsConfig.title}...`,
        },

        // 2. [核心] 编辑器静态配置 (插件配置在此传递)
        editorConfig: {
            plugins: wsConfig.plugins, // 数组: ['cloze:cloze', ...]
            // 如果有其他静态配置，例如 readonly:
            // readOnly: false
        },

        // 3. [架构修正] 默认内容策略
        defaultContentConfig: wsConfig.defaultFileName ? {
            fileName: wsConfig.defaultFileName,
            content: wsConfig.defaultFileContent || ''
        } : undefined,

        aiConfig: {
            enabled: true,
            activeRules: ['user', 'tag', 'file']
        }
    });

            // 2.5 启动并缓存
            await manager.start();
            managerCache.set(targetId, manager);

            // ✅ 如果原本不是 active，在渲染完成后检查是否需要移除 active 类
            if (!wasActive) {
                requestAnimationFrame(() => {
                    const currentActiveBtn = document.querySelector('.app-nav-btn.active');
                    const currentTarget = currentActiveBtn?.getAttribute('data-target');
                    
                    // 只有当前激活的不是这个工作区时，才移除 active
                    if (currentTarget !== targetId) {
                        container.classList.remove('active');
                    }
                });
            }
        };

        // 3. 先加载第一个工作区
        const firstWorkspace = WORKSPACES[0];
        if (firstWorkspace) {
            await loadWorkspace(firstWorkspace.elementId);
        }

        // 4. 然后初始化导航系统
        initSidebarNavigation(async (targetId) => {
            await loadWorkspace(targetId);
        });

        console.log('Application bootstrapped. Waiting for user interaction...');

        // 5. 初始化 Settings 工作区
        initSettingsWorkspace();

    } catch (error) {
        console.error('Failed to bootstrap application:', error);
    }
}

// 设置页面逻辑保持不变，或者加一个 flag 防止重复渲染
let settingsInitialized = false;
function initSettingsWorkspace() {
    if (settingsInitialized) return;
    
    const container = document.getElementById('settings-content');
    if (container) {
        container.innerHTML = `
            <div style="padding: 2rem;">
                <h2>Settings</h2>
                <p>Application version: 1.0.0</p>
            </div>
        `;
        settingsInitialized = true;
    }
}

bootstrap();