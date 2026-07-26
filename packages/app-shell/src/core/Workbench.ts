/**
 * @file app-shell/core/Workbench.ts
 *
 * 工作区装配器 — 粘合 VFS-UI (侧边栏) + Editor (编辑器)。
 * 不创建 DOM，不拥有布局。消费方负责创建 sidebar/editor 容器并传入。
 */
import { createVFSUI, connectEditorLifecycle, VFSUIShell, createVFSMentionProviders } from '@itookit/vfs-ui';
import { createMDxEditor, MentionPlugin } from '@itookit/mdxeditor';
import type { WorkbenchConfig } from '../types';
import { EditorOptions, IEditor, IModuleFS, EditorHostContext, NavigationRequest } from '@itookit/common';

export class Workbench {
    private vfsUI: VFSUIShell;
    private engine: IModuleFS;
    private lifecycleUnsubscribe: () => void;
    private baseEditorFactory: (container: HTMLElement, options: EditorOptions) => Promise<IEditor>;
    private hasStarted = false;

    constructor(private config: WorkbenchConfig) {
        if (config.customEngine) {
            this.engine = config.customEngine;
        } else if (config.vfs && config.moduleName) {
            this.engine = config.vfs.getEngine(config.moduleName);
        } else {
            throw new Error(
                "Workbench requires either 'customEngine' or both 'vfs' and 'moduleName' in config"
            );
        }

        this.baseEditorFactory = config.editorFactory || createMDxEditor;

        const scopeId = config.scopeId || config.moduleName || 'default';

        this.vfsUI = createVFSUI(
            {
                ...config.uiOptions,
                scopeId,
                sessionListContainer: config.sidebarContainer,
                fileCreation: {
                    ...config.uiOptions?.fileCreation,
                    instant: true,
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

        const sharedHostContext: EditorHostContext = {
            toggleSidebar: (_collapsed?: boolean) => {
                this.vfsUI.toggleSidebar();
            },
            saveContent: async (nodeId: string, content: string) => {
                await this.engine.driver.writeContent(nodeId, content);
            },
            navigate: async (req: NavigationRequest) => {
                if (this.config.onNavigate) {
                    await this.config.onNavigate(req);
                } else {
                    console.warn('[Workbench] onNavigate callback is missing in config.');
                }
            }
        };

        this.lifecycleUnsubscribe = connectEditorLifecycle(
            this.vfsUI,
            this.engine,
            config.editorContainer,
            this.enhancedEditorFactory,
            {
                hostContext: sharedHostContext,
                sessionEngine: this.config.sessionEngine,
                ...config.editorConfig
            }
        );

        this.bindEvents();
    }

    private enhancedEditorFactory = async (
        container: HTMLElement,
        runtimeOptions: EditorOptions
    ): Promise<IEditor> => {
        const { editorConfig } = this.config;

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
            sessionEngine: this.config.sessionEngine
        };

        return this.baseEditorFactory(container, mergedOptions);
    }

    private bindEvents() {
        const unsubSidebar = this.vfsUI.on('sidebarStateChanged', ({ isCollapsed }) => {
            this.config.onSidebarToggle?.(isCollapsed);
        });

        this.vfsUI.on('sessionSelected', (payload: { item?: { id: string } }) => {
            const sessionId = payload.item?.id ?? null;
            if (this.config.onSessionChange) {
                this.config.onSessionChange(sessionId);
            }
        });

        const originalDestroy = this.destroy.bind(this);
        this.destroy = () => {
            unsubSidebar();
            originalDestroy();
        };
    }

    public async start(initialResourceId?: string): Promise<void> {
        await this.engine.init();
        await this.vfsUI.start();

        if (initialResourceId) {
            const currentId = this.getActiveSessionId();
            if (currentId !== initialResourceId) {
                await this.openFileInternal(initialResourceId);
            }
        }

        this.hasStarted = true;
    }

    public async openFile(nodeId: string): Promise<void> {
        if (!this.hasStarted) {
            console.warn('[Workbench] openFile called before start, ignoring');
            return;
        }

        const currentId = this.getActiveSessionId();
        if (currentId === nodeId) {
            return;
        }

        await this.openFileInternal(nodeId);
    }

    public async createAndOpenFile(options: {
        title?: string;
        parentPath?: string | null;
        content?: string;
    } = {}): Promise<string> {
        if (!this.hasStarted) {
            console.warn('[Workbench] createAndOpenFile called before start');
            throw new Error('Workbench not started');
        }

        const title = options.title || 'Untitled';
        const newNode = await this.vfsUI.sessionService.createFile({
            title,
            parentPath: options.parentPath ?? null,
            content: options.content,
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        const currentId = this.getActiveSessionId();
        if (currentId !== newNode.path) {
            await this.openFileInternal(newNode.path);
        }

        return newNode.path;
    }

    private async openFileInternal(nodeId: string): Promise<void> {
        await this.vfsUI.store.dispatch({
            type: 'SESSION_SELECT',
            payload: { sessionId: nodeId }
        });
    }

    public setNodeWaitingInput(nodeId: string, waiting: boolean): void {
        this.vfsUI.setNodeWaitingInput(nodeId, waiting);
    }

    public getActiveSessionId(): string | null {
        const session = this.vfsUI.getActiveSession();
        return session?.id ?? null;
    }

    public destroy() {
        this.lifecycleUnsubscribe();
        this.vfsUI.destroy();
    }
}
