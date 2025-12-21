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
// 引入 Engine 核心初始化方法和 SessionEngine
import { initializeLLMEngine, LLMSessionEngine, chatFileParser } from '@itookit/llm-engine';

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

        // --- 2. 核心服务层初始化 (重构关键点) ---
        
        // 2.1 初始化 Agent Service (管理 Prompt, Connection, Tools)
        const agentService = new VFSAgentService(vfsCore);
        
        // 2.2 初始化 Session Engine (管理 .chat 文件持久化)
        const sessionEngine = new LLMSessionEngine(vfsCore);

        // 2.3 !!! 初始化 LLM Kernel & Registry !!!
        // 这一步至关重要，它会启动全局 SessionRegistry 和 Kernel
        await initializeLLMEngine({
            agentService,
            sessionEngine,
            maxConcurrent: 4, // 配置最大并发任务数
            // plugins: [...] // 如果有 Kernel 插件在此传入
        });

        // 2.4 Settings 模块
        const settingsModule = await createSettingsModule(vfsCore, agentService);

        // 2. 创建 UI Factories
        // ✅ 优化：Factory 只需关注 AgentService
        const llmFactory = createLLMFactory(agentService);
        const agentFactory = createAgentEditorFactory(agentService);
        
        // ✨ [修复 1] 显式声明类型 Record<string, WorkspaceStrategy>
        // 这告诉 TS：这里面的所有值都遵循 WorkspaceStrategy 接口
        // 即使 Standard 策略没写 getEngine，访问它也是安全的（返回 undefined）
        const strategies: Record<string, WorkspaceStrategy> = {
            'standard': new StandardWorkspaceStrategy(),
            'agent':    new AgentWorkspaceStrategy(),
            'settings': new SettingsWorkspaceStrategy(settingsModule.factory, settingsModule.engine),
            'chat':     new ChatWorkspaceStrategy(llmFactory, sessionEngine)
        };

        // 获取标准编辑器工厂 (作为 fallback 或特定用途)
        const standardFactory = strategies['standard'].getFactory();

        // ✨ 建立字符串 Key 到实际 Factory 的映射表
        const editorFactoryMap: Record<EditorTypeKey, any> = {
            'standard': standardFactory,
            'agent': agentFactory,
            'chat': llmFactory
        };

        // --- 4. 辅助函数：根据 Registry ID 生成 UI 所需的 FileTypeDefinition ---
        // 注意：此函数需要在 bootstrap 内部，因为它依赖于上面创建的 runtime factories
        const getFileTypeDefinition = (typeId: string): FileTypeDefinition | null => {
            const def = FILE_REGISTRY[typeId];
            if (!def) {
                console.warn(`File type definition not found for id: ${typeId}`);
                return null;
            }

            // ✨ [核心修复逻辑] 决定使用哪个 Factory
            // 1. 如果类型是 'standard' (如 .md, .anki)：
            //    我们返回 undefined。这会告诉 vfs-ui 使用 defaultEditorFactory。
            //    而 MemoryManager 的 defaultEditorFactory 已经被 "Enhanced"，包含了当前工作区的 plugins 配置。
            // 2. 如果类型是特定的 (如 'agent', 'chat')：
            //    我们直接使用对应的专用 Factory。这些通常是定制 UI，不依赖通用插件系统。
            let factory = undefined;
            if (def.editorType !== 'standard') {
                 factory = editorFactoryMap[def.editorType];
            }
            
            // 特殊处理：Chat 文件需要 parser
            // (如果逻辑更复杂，可以在 Registry 中增加 parserType 字段，此处为简化直接判断 ID)
            const parser = (def.id === 'chat') ? chatFileParser : undefined;

            return {
                extensions: [def.extension],
                icon: def.icon,
                editorFactory: factory, // undefined for 'standard', specific for others
                contentParser: parser
            };
        };

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

            // ✨ [核心功能] 动态生成当前工作区的"文件类型白名单"
            // 只有在 supportedFileTypes 中列出的类型，才会被视为特殊文件。
            // 未列出的扩展名将回退到本模块的 Default Factory (即本模块配置的 MDxEditor)。
            const workspaceFileTypes: FileTypeDefinition[] = (supportedFileTypes || [])
                .map(typeId => getFileTypeDefinition(typeId))
                .filter((item): item is FileTypeDefinition => !!item);

            // 解析默认文件配置 (取第一个支持的类型作为新建按钮的默认行为)
            const primaryFileKey = supportedFileTypes?.[0];
            const primaryFileDef = primaryFileKey ? FILE_REGISTRY[primaryFileKey] : undefined;

            // 构造 UI Options
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
                // 4. ✅ [新增] ScopeId (多实例隔离关键)
                // 使用 targetId (如 'workspace-sidebar') 确保每个实例的 UI 状态独立存储
                scopeId: targetId,

                fileTypes: workspaceFileTypes,
                
                uiOptions: uiOptions,
                editorConfig: {
                    plugins: plugins || [],
                    readOnly: false,
                    // ✅ [新增] 将 mentionScope 放入 config，供支持它的编辑器读取
                    mentionScope: mentionScope
                },
                
                aiConfig: { enabled: aiEnabled ?? true }
            });

            await manager.start();
            
            // ✨ [修复 2] 存入缓存
            managerCache.set(targetId, manager);
        };

        // --- 6. 启动应用 ---
        
        // 1. 初始化导航监听
        // 注意：initSidebarNavigation 内部逻辑是：如果发现 DOM 中有 .active 按钮，
        // 它会立即调用回调函数 loadWorkspace(targetId)。
        initSidebarNavigation(loadWorkspace);
        
        // 2. 检查 DOM 状态：是否已经有激活的按钮？
        const hasActiveState = document.querySelector('.app-nav-btn.active');
        
        // 3. 只有在 DOM 中找不到任何激活状态时，才回退到默认加载第一个工作区
        if (!hasActiveState && WORKSPACES[0]) {
            console.log('No active state found in HTML, loading default workspace.');
            await loadWorkspace(WORKSPACES[0].elementId);
        } else {
            console.log('Restored active workspace from HTML state.');
        }

    } catch (error) {
        console.error('Failed to bootstrap application:', error);
    }
}

bootstrap();