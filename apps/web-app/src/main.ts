/**
 * @file apps/web-app/src/main.ts
 * @description Main entry point for the web application.
 */
import { MemoryManager } from '@itookit/memory-manager';
import { initVFS } from './services/vfs';
import { defaultEditorFactory } from '@itookit/mdxeditor';
import { initSidebarNavigation } from './utils/layout';
import { WORKSPACES, WorkspaceConfig } from './config/modules';
import { SettingsEngine } from './workspace/settings/engines/SettingsEngine';
import { SettingsService } from './workspace/settings/services/SettingsService';
import { createSettingsFactory } from './factories/settingsFactory';
import { FileTypeDefinition } from '@itookit/vfs-ui';
import { chatFileParser,createLLMFactory, createAgentEditorFactory, VFSAgentService,initializeLLMModule } from '@itookit/llm-ui';
import { ISessionEngine,EditorFactory } from '@itookit/common';

import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/memory-manager/style.css'; 
import '@itookit/llm-ui/style.css'; 
import './styles/index.css'; 

const managerCache = new Map<string, MemoryManager>();

// Service Singletons
let sharedSettingsService: SettingsService | null = null;
let sharedAgentService: VFSAgentService | null = null;

async function bootstrap() {
    try {
        // 1. 初始化核心 VFS
        const vfsCore = await initVFS();
        
        // 2. 初始化 SettingsService (Tags, Contacts)
        sharedSettingsService = new SettingsService(vfsCore);
        await sharedSettingsService.init();

        // 3. 初始化 VFSAgentService (LLM, Connections, Agents)
        sharedAgentService = new VFSAgentService(vfsCore);
        await sharedAgentService.init();

    const { registry, engine } = await initializeLLMModule(sharedAgentService, undefined, {
        maxConcurrent: 3  // 最多同时运行 6 个会话
    });
/*
    // 6. 监听全局事件（可选）
    registry.onGlobalEvent((event) => {
        switch (event.type) {
            case 'pool_status_changed':
                updateGlobalStatusBar(event.payload);
                break;
            case 'session_unread_updated':
                updateSidebarBadge(event.payload.sessionId, event.payload.count);
                break;
        }
    });
    */
        // 4. 创建专用 Factory
        const llmEditorFactory = createLLMFactory(sharedAgentService,engine);
        const agentEditorFactory = createAgentEditorFactory(sharedAgentService); 
        const settingsFactory = createSettingsFactory(sharedSettingsService, sharedAgentService);

        // 5. 注册全局文件类型 (允许跨工作区识别特殊文件)
        const globalFileTypes: FileTypeDefinition[] = [
            {
                extensions: ['.agent'],
                icon: '🤖',
                editorFactory: agentEditorFactory
            },
            {
                extensions: ['.chat', '.session'], 
                icon: '💬',
                editorFactory: llmEditorFactory,
                // [高亮] 注入自定义解析器
                contentParser: chatFileParser
            }
        ];

        // 策略模式：根据配置类型解析所需的 Factory 和 Engine
        const resolveWorkspaceComponents = (config: WorkspaceConfig) => {
            let factory: EditorFactory = defaultEditorFactory;
            let customEngine: ISessionEngine | undefined = undefined;

            switch (config.type) {
                case 'settings':
                    factory = settingsFactory;
                    customEngine = new SettingsEngine(sharedSettingsService!);
                    break;
                case 'chat':
                    factory = llmEditorFactory;
                    break;
                case 'agent':
                    // Agent 工作区依然使用 defaultEditorFactory 来渲染列表，
                    // 但具体的 .agent 文件编辑由 fileTypes 控制
                    factory = defaultEditorFactory; 
                    break;
                case 'standard':
                default:
                    factory = defaultEditorFactory;
                    break;
            }
            return { factory, customEngine };
        };

        const loadWorkspace = async (targetId: string) => {
            if (managerCache.has(targetId)) return;
            
            const wsConfig = WORKSPACES.find(w => w.elementId === targetId);
            const container = document.getElementById(targetId);
            
            if (!container || !wsConfig) return;

            // UI 处理：激活 Tab 样式
            const wasActive = container.classList.contains('active');
            if (!wasActive) container.classList.add('active');

            // 获取组件策略
            const { factory, customEngine } = resolveWorkspaceComponents(wsConfig);

            // [核心优化] 解构赋值与剩余参数分离
            // 提取 "系统逻辑参数"，剩下的 "uiPassThrough" 将包含所有 UI 字段
            // (title, createFileLabel, defaultFileName, readOnly 等)
            const { 
                elementId, 
                moduleName, 
                type, 
                plugins, 
                mentionScope, 
                aiEnabled, 
                ...uiPassThrough 
            } = wsConfig;

            const manager = new MemoryManager({
                container: container,
                moduleName: wsConfig.moduleName, // 系统参数显式传递

                // 核心组件注入
                editorFactory: factory,
                customEngine: customEngine,
                fileTypes: globalFileTypes, // 注入全局文件支持

                // 逻辑参数显式传递
                mentionScope: wsConfig.mentionScope,

                // UI 参数自动透传 (同构映射)
                // 任何 modules.ts 里定义的非系统字段，都会自动 spread 到这里
                uiOptions: {
                    ...uiPassThrough,

                    // 动态计算的默认值 (如果配置里未指定)
                    searchPlaceholder: uiPassThrough.searchPlaceholder ?? `Search ${uiPassThrough.title.toLowerCase()}...`,
                    
                    // 复杂逻辑无法 JSON 化，需在此处理
                    contextMenu: { 
                        items: (_item, defaults) => uiPassThrough.readOnly ? [] : defaults 
                    }
                },

                editorConfig: {
                    plugins: wsConfig.plugins || [],
                    readOnly: false // 编辑器自身是否只读 (不同于列表只读)
                },

                aiConfig: {
                    enabled: wsConfig.aiEnabled ?? true, // 默认为 true
                    activeRules: ['user', 'tag', 'file']
                }
            });

            await manager.start();
            managerCache.set(targetId, manager);

            // 恢复 Tab 状态
            if (!wasActive) {
                requestAnimationFrame(() => {
                    const currentActiveBtn = document.querySelector('.app-nav-btn.active');
                    const currentTarget = currentActiveBtn?.getAttribute('data-target');
                    if (currentTarget !== targetId) container.classList.remove('active');
                });
            }
        };

        // 启动逻辑
        const initialWorkspace = WORKSPACES[0]; // 默认取第一个配置
        if (initialWorkspace) await loadWorkspace(initialWorkspace.elementId);
        
        initSidebarNavigation(async (targetId) => {
            await loadWorkspace(targetId);
        });

    } catch (error) {
        console.error('Failed to bootstrap application:', error);
    }
}

bootstrap();