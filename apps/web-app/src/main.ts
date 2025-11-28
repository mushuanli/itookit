/**
 * @file apps/web-app/src/main.ts
 */
import { MemoryManager } from '@itookit/memory-manager';
import { initVFS } from './services/vfs';
import { defaultEditorFactory, createSmartEditorFactory } from './factories/editorFactory';
import { initSidebarNavigation } from './utils/layout';
import { WORKSPACES } from './config/modules';
import { SettingsEngine } from './workspace/settings/engines/SettingsEngine';
import { SettingsService } from './workspace/settings/services/SettingsService';
import { createSettingsFactory } from './factories/settingsFactory';
// [Removed] AgentEngine 移除
// import { AgentEngine } from './workspace/agents/AgentEngine'; 

import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/memory-manager/style.css'; 
import './styles/index.css'; 

const managerCache = new Map<string, MemoryManager>();

// 全局单例 SettingsService
let sharedSettingsService: SettingsService | null = null;

async function bootstrap() {
    try {
        // 1. 初始化核心层
        const vfsCore = await initVFS();
        
        // 2. 优先初始化全局设置服务 (Connection 数据源)
        sharedSettingsService = new SettingsService(vfsCore);
        await sharedSettingsService.init();

        const loadWorkspace = async (targetId: string) => {
            if (managerCache.has(targetId)) return;
            const container = document.getElementById(targetId);
            if (!container) return;

            // 样式处理
            const wasActive = container.classList.contains('active');
            if (!wasActive) container.classList.add('active');

            let manager: MemoryManager;

            // 3. 特殊处理：Settings Workspace
            if (targetId === 'settings-workspace') {
                const settingsEngine = new SettingsEngine(sharedSettingsService!);
                const settingsFactory = createSettingsFactory(sharedSettingsService!);
                container.innerHTML = '';
                
                manager = new MemoryManager({
                    container: container,
                    customEngine: settingsEngine,
                    editorFactory: settingsFactory,
                    uiOptions: {
                        title: 'Settings',
                        // 设置页面不需要上下文菜单
                        contextMenu: { items: () => [] }, 
                        searchPlaceholder: 'Search settings...',
                        
                        // ✨ [修改] 设为 true。
                        // 这将隐藏左侧列表的新建按钮、底部栏，并禁用列表排序，
                        // 因为设置项列表是固定的（Connections, Tags...）。
                        readOnly: true, 
                    },
                    editorConfig: { plugins: ['core:titlebar'] },
                    aiConfig: { enabled: false }
                });

            // 4. Agent Workspace - 架构简化
            // 不再使用 AgentEngine，直接使用标准 MemoryManager + SmartEditorFactory
            } else if (targetId === 'agent-workspace') {
                const agentFactory = createSmartEditorFactory(sharedSettingsService!);
                container.innerHTML = '';

                // 获取配置 (确保 defaultFileContent 存在)
                const agentConfig = WORKSPACES.find(w => w.elementId === 'agent-workspace')!;

                manager = new MemoryManager({
                    container: container,
                    // [修改] 使用标准的 vfsCore + moduleName 模式
                    // MemoryManager 内部会自动创建 VFSCoreAdapter
                    vfsCore: vfsCore,
                    moduleName: 'agents', 
                    
                    editorFactory: agentFactory,
                    uiOptions: {
                        title: 'Agents',
                        // 使用 config 中定义的 .agent 文件名和 JSON 模板
                        defaultFileName: agentConfig.defaultFileName, 
                        defaultFileContent: agentConfig.defaultFileContent,
                        
                        searchPlaceholder: 'Search agents...',
                        initialSidebarCollapsed: false,
                        readOnly: false,
                        // 可选：定制上下文菜单，只保留文件操作，移除文件夹操作
                        contextMenu: {
                            items: (_item, defaults) => {
                                // Agent 列表通常是扁平的，或者我们不希望用户建立深层目录
                                return defaults; 
                            }
                        }
                    },
                    editorConfig: {
                        plugins: ['core:titlebar'], 
                        readOnly: false
                    },
                    aiConfig: { enabled: false }
                });

            // 5. 通用 Workspace
            } else {
                const wsConfig = WORKSPACES.find(w => w.elementId === targetId);
                if (!wsConfig) return;

                manager = new MemoryManager({
                    container: container,
                    vfsCore: vfsCore,
                    moduleName: wsConfig.moduleName,
                    editorFactory: defaultEditorFactory,
                    uiOptions: {
                        title: wsConfig.title,
                        defaultFileName: wsConfig.defaultFileName,
                        defaultFileContent: wsConfig.defaultFileContent,
                        initialSidebarCollapsed: false,
                        readOnly: false
                    },
                    editorConfig: {
                        plugins: wsConfig.plugins, 
                        readOnly: false
                    },
                    aiConfig: {
                        enabled: true,
                        activeRules: ['user', 'tag', 'file']
                    }
                });
            }

            await manager.start();
            managerCache.set(targetId, manager);

            if (!wasActive) {
                requestAnimationFrame(() => {
                    const currentActiveBtn = document.querySelector('.app-nav-btn.active');
                    const currentTarget = currentActiveBtn?.getAttribute('data-target');
                    if (currentTarget !== targetId) container.classList.remove('active');
                });
            }
        };

        // 启动
        if (WORKSPACES[0]) await loadWorkspace(WORKSPACES[0].elementId);
        
        initSidebarNavigation(async (targetId) => {
            await loadWorkspace(targetId);
        });

    } catch (error) {
        console.error('Failed to bootstrap application:', error);
    }
}

bootstrap();