/**
 * @file apps/web-app/src/main.ts
 * @description Main entry point for the web application.
 */
import { MemoryManager } from '@itookit/memory-manager';
import { initVFS } from './services/vfs';
import { initSidebarNavigation } from './utils/layout';
import { WORKSPACES } from './config/modules';
import { FileTypeDefinition } from '@itookit/vfs-ui';

// 模块引入
import { createSettingsModule } from '@itookit/app-settings';
import { createLLMFactory, createAgentEditorFactory, VFSAgentService } from '@itookit/llm-ui';
import { initializeLLMModule, chatFileParser } from '@itookit/llm-engine';

// 策略引入
import { 
    StandardWorkspaceStrategy, 
    SettingsWorkspaceStrategy, 
    ChatWorkspaceStrategy,
    AgentWorkspaceStrategy 
} from './strategies';
// ✨ [修复 1] 引入接口用于显式类型声明
import { WorkspaceStrategy } from './strategies/types'; 

import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/memory-manager/style.css'; 
import '@itookit/llm-ui/style.css'; 
import '@itookit/app-settings/style.css'; 
import './styles/index.css'; 

const managerCache = new Map<string, MemoryManager>();

async function bootstrap() {
    try {
        // --- 1. 基础设施初始化 ---
        const vfsCore = await initVFS();

        // --- 2. 核心服务层初始化 ---
        // 2.1 Agent & LLM Services
        const agentService = new VFSAgentService(vfsCore);
        await agentService.init();
        
        // LLM Engine 初始化
        const { engine: llmEngine } = await initializeLLMModule(agentService, undefined, { maxConcurrent: 8 });

        // 2.2 Settings 模块 (Facade 一键初始化)
        const settingsModule = await createSettingsModule(vfsCore, agentService);

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
        const llmFactory = createLLMFactory(agentService, llmEngine);
        
        // ✨ [修复 1] 显式声明类型 Record<string, WorkspaceStrategy>
        // 这告诉 TS：这里面的所有值都遵循 WorkspaceStrategy 接口
        // 即使 Standard 策略没写 getEngine，访问它也是安全的（返回 undefined）
        const strategies: Record<string, WorkspaceStrategy> = {
            'standard': new StandardWorkspaceStrategy(),
            'agent':    new AgentWorkspaceStrategy(),
            'settings': new SettingsWorkspaceStrategy(settingsModule.factory, settingsModule.engine),
            'chat':     new ChatWorkspaceStrategy(llmFactory)
        };

        // --- 4. 全局文件能力 (Global Capabilities) ---
        // 定义跨工作区的文件打开行为 (如在 Projects 里双击 .agent 文件)
        const globalFileTypes: FileTypeDefinition[] = [
            {
                extensions: ['.agent'],
                icon: '🤖',
                editorFactory: createAgentEditorFactory(agentService)
            },
            {
                extensions: ['.chat', '.session'], 
                icon: '💬',
                editorFactory: llmFactory,
                contentParser: chatFileParser
            }
        ];

        // --- 5. 通用加载逻辑 (The Loader) ---
        const loadWorkspace = async (targetId: string) => {
            // ✨ [修复 2] 缓存检查：如果已经初始化过，直接返回
            // initSidebarNavigation 负责处理 DOM 的 classList 切换，
            // 这里只需要确保逻辑对象存在即可。
            if (managerCache.has(targetId)) {
                return;
            }

            const container = document.getElementById(targetId);
            const wsConfig = WORKSPACES.find(w => w.elementId === targetId);
            
            if (!container || !wsConfig) return;

            // UI Tab 激活状态处理
            const wasActive = container.classList.contains('active');
            if (!wasActive) container.classList.add('active');

            // 获取策略
            // 如果 wsConfig.type 没有对应策略，回退到 standard
            const strategyType = wsConfig.type || 'standard';
            const strategy = strategies[strategyType] || strategies['standard'];

            // 提取非 UI 参数
            const { 
                elementId, moduleName, type, plugins, mentionScope, aiEnabled, 
                ...uiPassThrough // 剩余的都是 title, defaultFileName 等 UI 字段
            } = wsConfig;

            // [核心] 初始化 MemoryManager
            // 此时 main.ts 不再需要知道如何注入 contextFeatures，
            // 也不需要知道哪个类型对应哪个 Factory，全权交给 Strategy 处理。
            const manager = new MemoryManager({
                container,
                
                // 1. Engine 注入: 策略提供(如Settings) 或 自动创建(如Standard)
                customEngine: strategy.getEngine?.(moduleName),
                moduleName: moduleName, // 作为 fallback 或 key

                // 2. Factory 注入
                editorFactory: strategy.getFactory(),
                
                // 3. 配置增强 (解耦关键): 注入 HostContext, Mentions 等
                configEnhancer: strategy.getConfigEnhancer?.(mentionScope),

                // 4. 全局能力
                fileTypes: globalFileTypes,
                
                // 5. 选项透传
                uiOptions: {
                    ...uiPassThrough,
                    contextMenu: { 
                        // Settings 等只读视图禁用右键菜单
                        items: (_item, defaults) => uiPassThrough.readOnly ? [] : defaults 
                    }
                },
                
                editorConfig: {
                    plugins: plugins || [],
                    readOnly: false // 编辑器本身不仅读 (由上层 UI 控制)
                },
                
                aiConfig: { enabled: aiEnabled ?? true }
            });

            await manager.start();
            
            // ✨ [修复 2] 存入缓存
            managerCache.set(targetId, manager);
        };

        // --- 6. 启动应用 ---
        initSidebarNavigation(loadWorkspace);
        
        // 加载默认工作区
        if (WORKSPACES[0]) {
            await loadWorkspace(WORKSPACES[0].elementId);
        }

    } catch (error) {
        console.error('Failed to bootstrap application:', error);
    }
}

bootstrap();