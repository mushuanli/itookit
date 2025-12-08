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

// ✨ 引入新文件
import { FILE_REGISTRY, EditorTypeKey } from './config/file-registry';

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
        const agentFactory = createAgentEditorFactory(agentService);
        
        // ✨ [修复 1] 显式声明类型 Record<string, WorkspaceStrategy>
        // 这告诉 TS：这里面的所有值都遵循 WorkspaceStrategy 接口
        // 即使 Standard 策略没写 getEngine，访问它也是安全的（返回 undefined）
        const strategies: Record<string, WorkspaceStrategy> = {
            'standard': new StandardWorkspaceStrategy(),
            'agent':    new AgentWorkspaceStrategy(),
            'settings': new SettingsWorkspaceStrategy(settingsModule.factory, settingsModule.engine),
            'chat':     new ChatWorkspaceStrategy(llmFactory)
        };

        // 获取标准编辑器工厂 (作为 fallback)
        const standardFactory = strategies['standard'].getFactory();

        // ✨ 建立字符串 Key 到实际 Factory 的映射表
        const editorFactoryMap: Record<EditorTypeKey, any> = {
            'standard': standardFactory,
            'agent': agentFactory,
            'chat': llmFactory
        };

        // --- 4. 动态生成全局文件能力 (Global Capabilities) ---
        // 将 Config 中的纯数据转换为 UI 组件需要的对象，无需手动维护 globalFileTypes 数组
        const globalFileTypes: FileTypeDefinition[] = Object.values(FILE_REGISTRY).map(def => {
            // 根据注册表的 editorType 找到对应的 Factory
            const factory = editorFactoryMap[def.editorType] || standardFactory;
            
            // 特殊处理：Chat 文件需要 parser
            // (如果逻辑更复杂，可以在 Registry 中增加 parserType 字段，此处为简化直接判断 ID)
            const parser = (def.id === 'chat') ? chatFileParser : undefined;

            return {
                extensions: [def.extension],
                icon: def.icon, // 如果 registry 没配，UI 组件会有默认值
                editorFactory: factory,
                contentParser: parser
                // 注意：这里定义的是“如何打开已存在的文件”，
                // 默认内容 (defaultContent) 仅在创建新文件时使用，稍后传递给 MemoryManager
            };
        });

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
            if (!container.classList.contains('active')) container.classList.add('active');

            // 获取策略
            // 如果 wsConfig.type 没有对应策略，回退到 standard
            const strategyType = wsConfig.type || 'standard';
            const strategy = strategies[strategyType] || strategies['standard'];

            // 提取非 UI 参数
            const { 
                moduleName, plugins, mentionScope, aiEnabled, supportedFileTypes, 
                ...uiPassThrough 
            } = wsConfig;

            // ✨ 解析默认文件配置
            // 取 supportedFileTypes 的第一个作为默认创建类型
            const primaryFileKey = supportedFileTypes[0];
            const primaryFileDef = primaryFileKey ? FILE_REGISTRY[primaryFileKey] : undefined;

            // 构造 UI Options，合并 Config 与 Registry 信息
            const uiOptions = {
                ...uiPassThrough, // title, readOnly 等
                
                // 如果 Registry 有定义，优先使用 Registry 的 label/filename/content
                createFileLabel: primaryFileDef?.label || 'File', 
                defaultFileName: primaryFileDef?.defaultFileName,
                defaultExtension: primaryFileDef?.extension,
                defaultFileContent: primaryFileDef?.defaultContent,
                
                contextMenu: { 
                    items: (_item: any, defaults: any[]) => uiPassThrough.readOnly ? [] : defaults 
                }
            };

            // 初始化 MemoryManager
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
                
                uiOptions: uiOptions,
                editorConfig: {
                    plugins: plugins || [],
                    readOnly: false
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