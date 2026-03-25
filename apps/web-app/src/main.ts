/**
 * @file apps/web-app/src/main.ts
 * @description Main entry point for the web application.
 */
import { MemoryManager } from '@itookit/memory-manager';
import { initVFS } from './services/vfs';
import { WORKSPACES, MENTIONABLE_MODULES } from './config/modules';
import { FileTypeDefinition } from '@itookit/vfs-ui';
import { NavigationRequest, NAVIGATION_EVENTS } from '@itookit/common';

// 模块引入
import { createSettingsModule, createSettingsFactory } from '@itookit/app-settings';
import { createLLMFactory, createAgentEditorFactory, VFSAgentService, createAIContextMenuConfig } from '@itookit/llm-ui';
// 引入 Engine 核心初始化方法和 SessionEngine
import { initializeLLMEngine, LLMSessionEngine, chatFileParser } from '@itookit/llm-engine';
// LLM 设备插件（连接配置 + MCP 管理的唯一守护者）
import { LLMDeviceDriver } from '@itookit/device-llm';
import { setKernelDeviceManager } from '@itookit/llm-kernel';

// 策略引入
import {
    StandardWorkspaceStrategy,
    SettingsWorkspaceStrategy,
    ChatWorkspaceStrategy,
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
    if (ROUTE_MAP[target]) return ROUTE_MAP[target];
    if (document.getElementById(target)) return target;
    const wsConfig = WORKSPACES.find(w => w.moduleName === target);
    if (wsConfig) return wsConfig.elementId;
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

        // --- 1.1 初始化 LLM 设备驱动（连接配置 + MCP 管理的唯一守护者） ---
        // LLMDeviceDriver 管理连接存储和 MCP 服务器配置（__config VFS 模块），
        // 同时提供 LLM 通信接口。AgentExecutor 通过 IDeviceDriver ioctl 与其通信，
        // apiKey 不离开 device 边界。
        const llmDriver = new LLMDeviceDriver(vfsCore);
        await llmDriver.init();                  // 挂载 __config 模块，加载连接和 MCP 配置
        await vfsCore.registerDevice(llmDriver); // 注册驱动 + 创建 /dev/llm 设备文件
        await llmDriver.createDeviceNodes();     // 创建 /dev/llm/connection/* 和 /dev/llm/mcp/*
        setKernelDeviceManager(vfsCore.devices);

        // --- 2. 核心服务层初始化 ---

        // 2.1 Settings 模块
        const settingsModule = await createSettingsModule(vfsCore);

        // 2.2 Agent Service（管理 Agent，连接/MCP/Skill 操作委托给 LLMDeviceDriver）
        const agentService = new VFSAgentService(vfsCore, llmDriver, llmDriver, llmDriver);

        // 2.3 Session Engine (管理 .chat 文件持久化)
        const sessionEngine = new LLMSessionEngine(vfsCore);

        // 2.4 初始化 LLM Kernel & Registry
        await initializeLLMEngine({ agentService, sessionEngine, maxConcurrent: 20 });

        // 2.5 Settings 编辑器工厂（ConnectionSettingsEditor 通过 IDeviceManager 访问连接）
        const settingsFactory = createSettingsFactory(
            settingsModule.service,
            agentService,
            llmDriver,  // IConnectionService → ConnectionSettingsEditor 直接调用
        );

        // 创建 UI Factories
        const llmFactory = createLLMFactory(agentService);
        const agentFactory = createAgentEditorFactory(agentService);

        // ✨ [修复 1] 显式声明类型 Record<string, WorkspaceStrategy>
        // 这告诉 TS：这里面的所有值都遵循 WorkspaceStrategy 接口
        // 即使 Standard 策略没写 getEngine，访问它也是安全的（返回 undefined）
        const strategies: Record<string, WorkspaceStrategy> = {
            'standard': new StandardWorkspaceStrategy(vfsCore),
            'agent': new StandardWorkspaceStrategy(vfsCore),
            'settings': new SettingsWorkspaceStrategy(settingsFactory, settingsModule.engine),
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

        const loadWorkspace = async (
            targetId: string,
            initialResourceId?: string): Promise<MemoryManager | undefined> => {
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

            // AI 右键菜单：仅在 chat 工作区且非只读时启用
            const aiContextMenu = (strategyType === 'chat' && !uiPassThrough.readOnly)
                ? createAIContextMenuConfig({ agentService, engine: sessionEngine })
                : null;

            // 构造 UI Options
            const uiOptions = {
                ...uiPassThrough, // title, readOnly 等

                // 如果 Registry 有定义，优先使用 Registry 的 label/filename/content
                createFileLabel: primaryFileDef?.label || 'File',
                defaultFileName: primaryFileDef?.defaultFileName,
                defaultExtension: primaryFileDef?.extension,
                defaultFileContent: primaryFileDef?.defaultContent,
                contextMenu: {
                    items: (item: any, defaults: any[]) => {
                        if (uiPassThrough.readOnly) return [];
                        if (aiContextMenu?.items) return aiContextMenu.items(item, defaults);
                        return defaults;
                    }
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
                    // Resolve ['*'] to the concrete list of mentionable modules so that
                    // system/internal modules (settings, agents) don't fill the search
                    // limit window and push user-content modules (chats, private) out.
                    mentionScope: mentionScope?.[0] === '*'
                        ? MENTIONABLE_MODULES
                        : mentionScope
                },

                aiConfig: { enabled: aiEnabled ?? true },

                // ✅ 统一导航处理器 — 使用新版 NavigationRequest 协议
                onNavigate: async (req: NavigationRequest) => {
                    await handleNavigationRequest(req);
                },

                onSessionChange: (sessionId) => {
                    updateBrowserHistory(targetId, sessionId, 'replace');
                }
            });

            await manager.start(initialResourceId);

            // ✨ [修复 2] 存入缓存
            managerCache.set(targetId, manager);
            return manager;
        };

        // --- 6. 导航执行器 ---

        const performNavigation = async (
            workspaceId: string,
            resourceId?: string,
        ): Promise<void> => {
            console.log(`[Router] Navigating to: ${workspaceId}`, { resourceId });

            // 1. UI Tab 切换
            document.querySelectorAll('.workspace-view').forEach(ws => {
                ws.classList.toggle('active', ws.id === workspaceId);
            });
            document.querySelectorAll('.app-nav-btn').forEach(btn => {
                const btnTarget = (btn as HTMLElement).dataset.target;
                btn.classList.toggle('active', btnTarget === workspaceId);
            });

            // 2. 加载模块
            const isFirstLoad = !managerCache.has(workspaceId);

            if (isFirstLoad) {
                await loadWorkspace(workspaceId, resourceId);
            } else {
                const manager = managerCache.get(workspaceId)!;
                if (resourceId) {
                    await manager.openFile(resourceId);
                }
            }
        };

        // --- 6.1 统一导航请求处理器 ---
        /**
         * 处理所有 NavigationRequest（新版协议）
         * 
         * 职责：
         * 1. 解析目标 workspace
         * 2. 根据 action 类型分发（open/create/reveal/focus）
         * 3. 创建时委托给 MemoryManager.createAndOpenFile（不自己做业务逻辑）
         * 4. 通过 sessionStorage 传递初始状态（跨实例中转）
         */
        const handleNavigationRequest = async (req: NavigationRequest): Promise<void> => {
            const targetWsId = resolveTarget(req.target);
            const action = req.action || 'open';

            switch (action) {
                case 'create': {
                    // 写入创建参数供目标编辑器读取（跨实例中转）
                    if (req.state || req.create) {
                        sessionStorage.setItem('app_create_params', JSON.stringify({
                            target: req.target,
                            state: req.state,
                            create: req.create,
                            // 旧版兼容字段
                            agentId: req.state?.agentId,
                            text: req.state?.inputText,
                            title: req.create?.title,
                            timestamp: Date.now(),
                        }));
                    }

                    updateBrowserHistory(targetWsId, null, 'push');

                    // 确保 workspace 已加载
                    await performNavigation(targetWsId);

                    // ✅ 关键：委托 MemoryManager 创建文件
                    const manager = managerCache.get(targetWsId);
                    if (manager) {
                        const newId = await manager.createAndOpenFile({
                            title: req.create?.title,
                            content: req.create?.content,
                            parentId: req.create?.parentId,
                        });
                        updateBrowserHistory(targetWsId, newId, 'replace');
                    }
                    break;
                }

                case 'reveal': {
                    updateBrowserHistory(targetWsId, req.resourceId || null, 'replace');
                    await performNavigation(targetWsId);
                    break;
                }

                case 'focus': {
                    updateBrowserHistory(targetWsId, null, 'replace');
                    await performNavigation(targetWsId);
                    break;
                }

                case 'open':
                default: {
                    updateBrowserHistory(targetWsId, req.resourceId || null, 'push');
                    await performNavigation(targetWsId, req.resourceId);
                    break;
                }
            }
        };

        // --- 7. 全局事件绑定 ---

        window.addEventListener('popstate', (event) => {
            const state = event.state as { workspaceId: string, resourceId?: string } | null;
            if (state) {
                performNavigation(state.workspaceId, state.resourceId);
            } else {
                const route = parseHash();
                performNavigation(route.workspace, route.resource);
            }
        });

        document.querySelectorAll('.app-nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = (e.currentTarget as HTMLElement).dataset.target;
                if (targetId) {
                    const manager = managerCache.get(targetId);
                    const lastActiveId = manager?.getActiveSessionId() || null;

                    updateBrowserHistory(targetId, lastActiveId, 'push');
                    performNavigation(targetId, lastActiveId || undefined);
                }
            });
        });

        // ✅ 全局导航事件监听器 — 统一走 handleNavigationRequest
        document.addEventListener(NAVIGATION_EVENTS.NAVIGATE, ((e: CustomEvent) => {
            const req = e.detail as NavigationRequest;
            if (req?.target) {
                handleNavigationRequest(req);
            }
        }) as EventListener);

        // --- 8. 启动 ---
        const initialRoute = parseHash();
        await performNavigation(initialRoute.workspace, initialRoute.resource);
        updateBrowserHistory(initialRoute.workspace, initialRoute.resource || null, 'replace');

    } catch (error) {
        console.error('Failed to bootstrap application:', error);
    }
}

bootstrap();