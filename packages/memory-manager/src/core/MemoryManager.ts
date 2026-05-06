/**
 * @file memory-manager/core/MemoryManager.ts
 */
import { VFSModuleEngine } from '@itookit/vfslib';
import { createVFSUI, connectEditorLifecycle, VFSUIShell, createVFSMentionProviders } from '@itookit/vfs-ui';
import { createMDxEditor, MentionPlugin } from '@itookit/mdxeditor';
import { MemoryManagerConfig } from '../types';
import { BackgroundBrain } from './BackgroundBrain';
import { Layout } from './Layout';
import { EditorOptions, IEditor, IFSEngine, EditorHostContext, NavigationRequest } from '@itookit/common';

export class MemoryManager {
    private vfsUI: VFSUIShell;
    private engine: IFSEngine;
    private brain?: BackgroundBrain;
    private layout: Layout;
    private lifecycleUnsubscribe: () => void;
    private baseEditorFactory: (container: HTMLElement, options: EditorOptions) => Promise<IEditor>;
    private hasStarted = false;

    constructor(private config: MemoryManagerConfig) {
        this.layout = new Layout(config.container);

        // 1. Engine 解析
        if (config.customEngine) {
            this.engine = config.customEngine;
        } else if (config.vfs && config.moduleName) {
            this.engine = new VFSModuleEngine(config.moduleName, config.vfs) as unknown as IFSEngine;
        } else {
            throw new Error(
                "MemoryManager requires either 'customEngine' or both 'vfs' and 'moduleName' in config"
            );
        }

        // 2. Factory 解析
        this.baseEditorFactory = config.editorFactory || createMDxEditor;

        // 3. 计算 Scope ID
        const scopeId = config.scopeId || config.moduleName || 'default';

        // 4. 初始化 UI
        this.vfsUI = createVFSUI(
            {
                ...config.uiOptions,
                scopeId: scopeId,
                sessionListContainer: this.layout.sidebarContainer,
                fileCreation: {
                    ...config.uiOptions?.fileCreation,
                    startupFileName: config.uiOptions?.fileCreation?.startupFileName ?? config.defaultContentConfig?.fileName,
                    startupContent:  config.uiOptions?.fileCreation?.startupContent  ?? config.defaultContentConfig?.content,
                },
                defaultEditorFactory: this.enhancedEditorFactory,
                fileTypes: config.fileTypes,
                customEditorResolver: config.customEditorResolver,
                showFileExtensions: config.showFileExtensions,
            },
            this.engine
        ) as VFSUIShell;

        // 5. 初始化 AI Brain (可选)
        if (config.aiConfig?.enabled) {
            this.brain = new BackgroundBrain(
                this.engine,
                config.aiConfig.activeRules
            );
            this.brain.start();
        }

        // 6. Create Host Context
        const sharedHostContext: EditorHostContext = {
            toggleSidebar: (_collapsed?: boolean) => {
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

        // 7. Connect Editor Lifecycle
        this.lifecycleUnsubscribe = connectEditorLifecycle(
            this.vfsUI,
            this.engine,
            this.layout.editorContainer,
            this.enhancedEditorFactory,
            {
                hostContext: sharedHostContext,
                ...config.editorConfig
            }
        );

        this.bindLayoutEvents();
        this.bindInternalEvents();
    }

    /**
     * 增强型编辑器工厂
     */
    private enhancedEditorFactory = async (
        container: HTMLElement,
        runtimeOptions: EditorOptions
    ): Promise<IEditor> => {
        const { editorConfig } = this.config;

        // Wire VFS mention providers when mentionScope is configured.
        // Replaces the 'autocomplete:mention' string entry with a fully configured
        // MentionPlugin instance so the factory uses VFS providers instead of the
        // zero-provider default from the registry.
        const mentionScope = editorConfig?.mentionScope as string[] | undefined;
        const mentionPlugin = mentionScope !== undefined
            ? new MentionPlugin({
                providers: createVFSMentionProviders(this.engine, mentionScope) as any,
                onMentionClick: (_providerKey: string, nodeId: string) => {
                    this.config.onNavigate?.({ target: 'self', action: 'open', resourceId: nodeId });
                },
            })
            : undefined;

        const basePlugins = [
            ...(editorConfig?.plugins || []),
            ...(runtimeOptions?.plugins || []),
        ];
        const plugins = mentionPlugin
            ? [...basePlugins.filter((p: any) => p !== 'autocomplete:mention'), mentionPlugin]
            : basePlugins;

        const mergedOptions: EditorOptions = {
            ...editorConfig,
            ...runtimeOptions,
            plugins,
            defaultPluginOptions: {
                ...(editorConfig?.defaultPluginOptions || {}),
                ...(runtimeOptions?.defaultPluginOptions || {}),
            },
            sessionEngine: this.engine
        };

        return this.baseEditorFactory(container, mergedOptions);
    }

    private bindLayoutEvents() {
        const unsubscribe = this.vfsUI.on('sidebarStateChanged', ({ isCollapsed }) => {
            this.layout.toggleSidebar(isCollapsed);
        });

        const originalDestroy = this.destroy.bind(this);
        this.destroy = () => {
            unsubscribe();
            originalDestroy();
        };
    }

    private bindInternalEvents() {
        this.vfsUI.on('sessionSelected', (payload: { item?: { id: string } }) => {
            const sessionId = payload.item?.id ?? null;
            if (this.config.onSessionChange) {
                this.config.onSessionChange(sessionId);
            }
        });
    }

    /**
     * 启动并可选地导航到指定资源
     * 
     * 这是统一的启动入口。将"初始化"和"打开初始文件"合为一个原子操作，
     * 避免 start() + openFile() 分开调用时产生的竞态条件。
     * 
     * @param initialResourceId 启动后要打开的资源 ID
     *   - 提供时：start 完成后，如果当前活跃文件不是目标，则切换到目标
     *   - 不提供时：恢复上次离开时的会话状态（VFSUIShell 默认行为）
     */
    public async start(initialResourceId?: string): Promise<void> {
        await this.engine.init();
        await this.vfsUI.start();

        // start() 完成后，检查是否需要导航到指定文件
        // VFSUIShell.start() 内部已经恢复了上次的 activeId，
        // 只有当目标与当前不同时才需要额外的 SESSION_SELECT
        if (initialResourceId) {
            const currentId = this.getActiveSessionId();
            if (currentId !== initialResourceId) {
                await this.openFileInternal(initialResourceId);
            }
        }

        this.hasStarted = true;
    }

    /**
     * 运行时打开文件（幂等）
     * 
     * 仅用于已启动后的导航操作（用户点击侧边栏、路由变化等）。
     * 启动时的初始导航应使用 start(resourceId)。
     */
    public async openFile(nodeId: string): Promise<void> {
        if (!this.hasStarted) {
            console.warn('[MemoryManager] openFile called before start, ignoring');
            return;
        }

        // 幂等：已经是当前文件则不重复打开
        const currentId = this.getActiveSessionId();
        if (currentId === nodeId) {
            return;
        }

        await this.openFileInternal(nodeId);
    }

    /**
     * 创建新文件并打开
     * 
     * 公共 API — 供路由层调用，封装内部创建逻辑。
     * 复用 VFSUIShell 的 sessionService（即 VFSService），
     * 走与侧边栏 "+" 按钮相同的路径。
     * 
     * @param title    文件标题
     * @param parentId 父目录 ID（可选）
     * @param content  初始内容（可选）
     * @returns 新创建的文件 ID
     */
    public async createAndOpenFile(options: {
        title?: string;
        parentId?: string | null;
        content?: string;
    } = {}): Promise<string> {
        if (!this.hasStarted) {
            console.warn('[MemoryManager] createAndOpenFile called before start');
            throw new Error('MemoryManager not started');
        }

        const title = options.title || 'Untitled';
        const newNode = await this.vfsUI.sessionService.createFile({
            title,
            parentId: options.parentId ?? null,
            content: options.content,
        });

        console.log(`[MemoryManager] Created new file: ${newNode.id}, title: ${title}`);

        // VFSService.createFile 内部已触发 engine 事件 → EngineAdapter 自动更新侧边栏
        // SESSION_CREATE_SUCCESS 会自动选中新文件
        // 但为确保 editor-connector 正确响应，等一帧
        await new Promise(resolve => setTimeout(resolve, 50));

        // 如果自动选中未生效，手动选中
        const currentId = this.getActiveSessionId();
        if (currentId !== newNode.id) {
            await this.openFileInternal(newNode.id);
        }

        return newNode.id;
    }


    /**
     * 内部文件打开（绕过 hasStarted 和幂等检查）
     */
    private async openFileInternal(nodeId: string): Promise<void> {
        await this.vfsUI.store.dispatch({
            type: 'SESSION_SELECT',
            payload: { sessionId: nodeId }
        });
    }

    /**
     * 设置节点的等待输入状态。
     * 由 bootstrap 在后台会话触发 human_input 时调用，
     * 让 session 列表中的对应文件项显示橙色脉冲指示器。
     */
    public setNodeWaitingInput(nodeId: string, waiting: boolean): void {
        this.vfsUI.setNodeWaitingInput(nodeId, waiting);
    }

    /**
     * 获取当前激活的节点 ID
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
