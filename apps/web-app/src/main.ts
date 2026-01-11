/**
 * @file apps/web-app/src/main.ts
 * @description Main entry point for the web application.
 */
import { MemoryManager } from '@itookit/memory-manager';
import { initVFS } from './services/vfs';
import { WORKSPACES } from './config/modules';
import { FileTypeDefinition } from '@itookit/vfs-ui';
import { NavigationRequest, NAVIGATION_EVENTS } from '@itookit/common';

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

// --- Router Definition ---

// 别名映射 (URL slug -> elementId)
const ROUTE_MAP: Record<string, string> = {
    // 核心工作区
    'chat': 'llm-workspace',
    'agents': 'agent-workspace',
    'settings': 'settings-workspace',
    
    // 标准内容工作区
    'anki': 'anki-workspace',
    'prompts': 'prompt-workspace',
    'projects': 'project-workspace',
    'emails': 'email-workspace',
    'private': 'private-workspace',
    
    // 别名支持
    'home': 'llm-workspace',  // 默认首页
};

// 反向映射 (elementId -> URL slug)
const REVERSE_ROUTE_MAP = Object.entries(ROUTE_MAP).reduce((acc, [slug, elementId]) => {
    // 只保留第一个映射（避免 'home' 覆盖 'chat'）
    if (!acc[elementId]) {
        acc[elementId] = slug;
    }
    return acc;
}, {} as Record<string, string>);

const managerCache = new Map<string, MemoryManager>();

/**
 * 解析导航目标
 * 支持多种输入格式：slug、elementId、moduleName
 */
function resolveTarget(target: string): string {
    // 1. 优先检查 slug 映射
    if (ROUTE_MAP[target]) {
        return ROUTE_MAP[target];
    }
    
    // 2. 检查是否直接是 elementId
    if (document.getElementById(target)) {
        return target;
    }
    
    // 3. 检查 moduleName 映射
    const wsConfig = WORKSPACES.find(w => w.moduleName === target);
    if (wsConfig) {
        return wsConfig.elementId;
    }
    
    // 4. 回退到默认
    console.warn(`[Router] Unknown target: ${target}, falling back to chat`);
    return 'llm-workspace';
}

/**
 * 解析 URL Hash
 */
function parseHash(): { workspace: string; resource?: string; isCreate?: boolean } {
    const parts = location.hash.slice(2).split('/'); // 去掉 #/
    const slug = parts[0] || 'chat';
    const resource = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    
    return {
        workspace: resolveTarget(slug),
        resource: resource === 'new' ? undefined : resource,
        isCreate: resource === 'new'
    };
}

/**
 * 更新浏览器历史
 */
function updateBrowserHistory(
    workspaceId: string, 
    resourceId: string | null, 
    mode: 'push' | 'replace' = 'push'
): void {
    const slug = REVERSE_ROUTE_MAP[workspaceId] || 'home';
    const hash = resourceId ? `#/${slug}/${encodeURIComponent(resourceId)}` : `#/${slug}`;
    
    if (location.hash !== hash) {
        const state = { workspaceId, resourceId };
        if (mode === 'push') {
            history.pushState(state, '', hash);
        } else {
            history.replaceState(state, '', hash);
        }
    }
}


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
            'standard': new StandardWorkspaceStrategy(vfsCore),
            'agent': new AgentWorkspaceStrategy(vfsCore),
            'settings': new SettingsWorkspaceStrategy(settingsModule.factory, settingsModule.engine),
            'chat': new ChatWorkspaceStrategy(llmFactory, sessionEngine)
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

        // --- 4. 路由状态管理 ---

        // --- 5. 通用加载逻辑 (The Loader) ---
        
        const loadWorkspace = async (targetId: string): Promise<MemoryManager | undefined> => {
            if (managerCache.has(targetId)) {
                return managerCache.get(targetId);
            }

            const container = document.getElementById(targetId);
            const wsConfig = WORKSPACES.find(w => w.elementId === targetId);
            
            if (!container || !wsConfig) return undefined;

            const strategyType = wsConfig.type || 'standard';
            const strategy = strategies[strategyType] || strategies['standard'];

            const { moduleName, plugins, mentionScope, aiEnabled, supportedFileTypes, ...uiPassThrough } = wsConfig;

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
                
                aiConfig: { enabled: aiEnabled ?? true },

                // ✅ [核心] 统一导航处理器
                onNavigate: async (req: NavigationRequest) => {
                    const targetWsId = resolveTarget(req.target);
                    
                    // 处理创建动作
                    if (req.params?.action === 'create') {
                        // 存储创建参数供目标编辑器读取
                        if (req.params.agentId || req.params.text) {
                            sessionStorage.setItem('app_create_params', JSON.stringify({
                                target: req.target,
                                agentId: req.params.agentId,
                                text: req.params.text,
                                timestamp: Date.now()
                            }));
                        }
                        updateBrowserHistory(targetWsId, null, 'push');
                    } else {
                        updateBrowserHistory(targetWsId, req.resourceId || null, 'push');
                    }
                    
                    await performNavigation(targetWsId, req.resourceId, req.params);
                },

                onSessionChange: (sessionId) => {
                    updateBrowserHistory(targetId, sessionId, 'replace');
                }
            });

            await manager.start();
            
            // ✨ [修复 2] 存入缓存
            managerCache.set(targetId, manager);
            return manager;
        };

        // --- 6. 导航执行器 ---
        const performNavigation = async (
            workspaceId: string, 
            resourceId?: string,
            params?: NavigationRequest['params']
        ): Promise<void> => {
            console.log(`[Router] Navigating to: ${workspaceId}`, { resourceId, params });

            // 1. UI Tab 切换
            document.querySelectorAll('.workspace-view').forEach(ws => {
                ws.classList.toggle('active', ws.id === workspaceId);
            });
            document.querySelectorAll('.app-nav-btn').forEach(btn => {
                const btnTarget = (btn as HTMLElement).dataset.target;
                btn.classList.toggle('active', btnTarget === workspaceId);
            });

            // 加载模块
            const manager = await loadWorkspace(workspaceId);
            if (!manager) {
                console.error(`[Router] Failed to load workspace: ${workspaceId}`);
                return;
            }

            // 打开资源
            if (resourceId) {
                setTimeout(() => {
                    manager.openFile(resourceId);
                }, 10);
            }
        };

        // --- 7. 全局事件绑定 ---

        // 浏览器历史
        window.addEventListener('popstate', (event) => {
            const state = event.state as { workspaceId: string, resourceId?: string } | null;
            if (state) {
                performNavigation(state.workspaceId, state.resourceId);
            } else {
                const route = parseHash();
                performNavigation(route.workspace, route.resource);
            }
        });

        // 侧边栏导航按钮
        document.querySelectorAll('.app-nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = (e.currentTarget as HTMLElement).dataset.target;
                if (targetId) {
                    // 获取该模块上次的状态（如果已加载）
                    const manager = managerCache.get(targetId);
                    const lastActiveId = manager?.getActiveSessionId() || null;
                    
                    updateBrowserHistory(targetId, lastActiveId, 'push');
                    performNavigation(targetId, lastActiveId || undefined);
                }
            });
        });

        // ✅ [新增] 全局导航事件监听器
        document.addEventListener(NAVIGATION_EVENTS.NAVIGATE, ((e: CustomEvent) => {
            const { target, resourceId, params } = e.detail || {};
            if (target) {
                const targetWsId = resolveTarget(target);
                updateBrowserHistory(targetWsId, resourceId || null, 'push');
                performNavigation(targetWsId, resourceId, params);
            }
        }) as EventListener);

        // --- 8. 启动 ---
        const initialRoute = parseHash();
        await performNavigation(initialRoute.workspace, initialRoute.resource);
        
        // 替换当前的空白历史记录，确保后续 Back 操作正常
        updateBrowserHistory(initialRoute.workspace, initialRoute.resource || null, 'replace');

    } catch (error) {
        console.error('Failed to bootstrap application:', error);
    }
}

bootstrap();