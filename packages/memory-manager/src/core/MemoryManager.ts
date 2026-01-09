/**
 * @file memory-manager/core/MemoryManager.ts
 */
import { VFSModuleEngine } from '@itookit/vfs';
import { createVFSUI, connectEditorLifecycle, VFSUIManager } from '@itookit/vfs-ui';
import { createMDxEditor } from '@itookit/mdxeditor'; 
import { MemoryManagerConfig } from '../types';
import { BackgroundBrain } from './BackgroundBrain';
import { Layout } from './Layout';
import { EditorOptions, IEditor, ISessionEngine, EditorHostContext, NavigationRequest } from '@itookit/common';

export class MemoryManager {
    private vfsUI: VFSUIManager;
    private engine: ISessionEngine;
    private brain?: BackgroundBrain;
    private layout: Layout;
    private lifecycleUnsubscribe: () => void;
    private baseEditorFactory: (container: HTMLElement, options: EditorOptions) => Promise<IEditor>;

    constructor(private config: MemoryManagerConfig) {
        this.layout = new Layout(config.container);

        // 1. Engine 解析
        if (config.customEngine) {
            this.engine = config.customEngine;
        } else if (config.vfs && config.moduleName) {
            // ✅ 使用 VFS + moduleName 创建 VFSModuleEngine
            this.engine = new VFSModuleEngine(config.moduleName, config.vfs);
        } else {
            throw new Error(
                "MemoryManager requires either 'customEngine' or both 'vfs' and 'moduleName' in config"
            );
        }

        // 2. Factory 解析
        this.baseEditorFactory = config.editorFactory || createMDxEditor;

        // 3. 计算 Scope ID (用于多实例隔离)
        // 优先使用传入的 scopeId，否则回退到 moduleName，最后 default
        const scopeId = config.scopeId || config.moduleName || 'default';

        // 4. 初始化 UI
        this.vfsUI = createVFSUI(
            {
                ...config.uiOptions,
                // ✅ [关键] 传递 scopeId 确保 UI 状态 (LocalStorage) 隔离
                scopeId: scopeId,
                sessionListContainer: this.layout.sidebarContainer,
                defaultFileName: config.defaultContentConfig?.fileName,
                defaultFileContent: config.defaultContentConfig?.content,
                defaultEditorFactory: this.enhancedEditorFactory,
                fileTypes: config.fileTypes,
                customEditorResolver: config.customEditorResolver,
            },
            this.engine
        ) as VFSUIManager;

        // 5. 初始化 AI Brain (可选)
        if (config.aiConfig?.enabled) {
            this.brain = new BackgroundBrain(
                this.engine,
                config.aiConfig.activeRules
            );
            this.brain.start();
        }

        // ✅ [Fix] 5. Create Host Context Explicitly
        // 创建通用的宿主上下文，供所有编辑器使用
        const sharedHostContext: EditorHostContext = {
            toggleSidebar: (collapsed?: boolean) => {
                this.vfsUI.toggleSidebar(); 
            },
            saveContent: async (nodeId: string, content: string) => {
                await this.engine.writeContent(nodeId, content);
            },
            navigate: async (req: NavigationRequest) => {
                console.log(`[MemoryManager:${this.config.scopeId}] Handling navigation:`, req);
                if (this.config.onNavigate) {
                    await this.config.onNavigate(req);
                } else {
                    console.warn('[MemoryManager] onNavigate callback is missing in config.');
                }
            }
        };

        // 6. Connect Editor Lifecycle
        // 关键：将 hostContext 作为 options 传入，确保 EditorConnector 能接收到它
        this.lifecycleUnsubscribe = connectEditorLifecycle(
            this.vfsUI,
            this.engine,
            this.layout.editorContainer,
            this.enhancedEditorFactory,
            {
                // ✅ 传递 HostContext
                hostContext: sharedHostContext,
                
                // 传递其他编辑器配置
                ...config.editorConfig
            }
        );

        this.bindLayoutEvents();
        this.bindInternalEvents();
    }

    /**
     * [核心架构] 增强型编辑器工厂
     * 作用：拦截创建过程，注入 MemoryManager 的上下文能力和配置。
     * 此时 this.vfsUI 可能还在初始化中，但当此函数被实际调用时(打开文件时)，它一定已经可用。
     */
    private enhancedEditorFactory = async (
        container: HTMLElement, 
        runtimeOptions: EditorOptions
    ): Promise<IEditor> => {
        const { editorConfig } = this.config;

        const mergedOptions: EditorOptions = {
            ...editorConfig,
            ...runtimeOptions,
            plugins: [ 
                ...(editorConfig?.plugins || []), 
                ...(runtimeOptions?.plugins || []) 
            ],
            defaultPluginOptions: {
                ...(editorConfig?.defaultPluginOptions || {}),
                ...(runtimeOptions?.defaultPluginOptions || {}),
            },
            sessionEngine: this.engine
        };

        // 3. 直接调用原始工厂
        return this.baseEditorFactory(container, mergedOptions);
    }

    private bindLayoutEvents() {
        // 响应 UI 侧边栏折叠事件 -> 更新 Layout 样式
        const unsubscribe = this.vfsUI.on('sidebarStateChanged', ({ isCollapsed }) => {
            this.layout.toggleSidebar(isCollapsed);
        });

        // 劫持 destroy 确保清理
        const originalDestroy = this.destroy.bind(this);
        this.destroy = () => {
            unsubscribe();
            originalDestroy();
        };
    }

    /**
     * ✅ [新增] 监听内部事件，通知上层 (Main) 更新 URL
     */
    private bindInternalEvents() {
        this.vfsUI.on('sessionSelected', (payload: { item?: { id: string } }) => {
            const sessionId = payload.item?.id ?? null;
            if (this.config.onSessionChange) {
                this.config.onSessionChange(sessionId);
            }
        });
    }

    public async start() {
        await this.engine.init();
        await this.vfsUI.start(); 
        
        // Settings 模块的特殊逻辑：监听来自 Main 的 Tab 切换请求
        if (this.config.moduleName === 'settings_root') {
            // 注意：这里需要配合 Main.ts 中的逻辑，如果是通过 openFile 方法调用则不需要这个监听器
            // 但为了兼容旧的 window dispatch 方式，保留也无妨
        }
    }

    public async openFile(nodeId: string) {
        await this.vfsUI.store.dispatch({ 
            type: 'SESSION_SELECT', 
            payload: { sessionId: nodeId }
        });
    }

    /**
     * ✅ [新增] 获取当前激活的节点 ID (用于同步 URL)
     */
    public getActiveSessionId(): string | null {
        const session = this.vfsUI.getActiveSession();
        return session?.id ?? null;
    }

    public destroy() {
        this.lifecycleUnsubscribe();
        this.vfsUI.destroy();
        this.brain?.stop();
        this.layout.destroy();
    }
}
