/**
 * @file src/core/MemoryManager.ts
 */
import { createVFSUI, connectEditorLifecycle, VFSUIManager, FileProvider } from '@itookit/vfs-ui';
import { EditorOptions, IEditor } from '@itookit/common';
import { MemoryManagerConfig } from '../types';
import { BackgroundBrain } from './BackgroundBrain';
import { Layout } from './Layout';

export class MemoryManager {
    private vfsUI: VFSUIManager;
    private brain?: BackgroundBrain;
    private layout: Layout;
    private lifecycleUnsubscribe: () => void;

    constructor(private config: MemoryManagerConfig) {
        // 1. 创建布局
        this.layout = new Layout(config.container);

        // 2. 初始化 VFS-UI
        this.vfsUI = createVFSUI(
            {
                ...config.uiOptions,
                sessionListContainer: this.layout.sidebarContainer,
                initialSidebarCollapsed: false,
            },
            config.vfsCore,
            config.moduleName
        ) as VFSUIManager;

        // 3. 初始化 AI 大脑
        if (config.aiConfig?.enabled) {
            this.brain = new BackgroundBrain(
                config.vfsCore,
                config.moduleName,
                config.aiConfig.activeRules
            );
            this.brain.start();
        }

        // 4. 连接编辑器生命周期
        // [简化] 不再需要 onEditorCreated 回调去绑定额外事件
        // connectEditorLifecycle 现在全权负责保存和销毁
        this.lifecycleUnsubscribe = connectEditorLifecycle(
            this.vfsUI,
            config.vfsCore,
            this.layout.editorContainer,
            this.enhancedEditorFactory
        );

        // 5. 绑定布局响应
        this.bindLayoutEvents();
    }

    /**
     * 增强工厂：依赖注入层
     * 负责将 "Manager 级别的能力" (如切换侧边栏) 注入到 "Editor 级别的插件" 中
     */
    private enhancedEditorFactory = async (container: HTMLElement, options: EditorOptions): Promise<IEditor> => {
        // 1. 准备上下文能力
        const contextFeatures = {
            toggleSidebarCallback: () => this.vfsUI.toggleSidebar(),
            // 手动保存回调 (供 Ctrl+S 或保存按钮使用)
            // 自动保存已由 Connector 处理，但显式保存按钮仍需要此回调
            saveCallback: async (editorInstance: any) => {
                if (options.nodeId && typeof editorInstance.getText === 'function') {
                    await this.config.vfsCore.getVFS().write(options.nodeId, editorInstance.getText());
                }
            }
        };

        // 2. 注入配置
        const mergedOptions = {
            ...options,
            defaultPluginOptions: {
                ...(options.defaultPluginOptions || {}),
                
                // 注入 FileProvider 以支持 @file 补全
                'autocomplete:mention': {
                    // @ts-ignore
                    ...(options.defaultPluginOptions?.['autocomplete:mention'] || {}),
                    providers: [
                        new FileProvider({ vfsCore: this.config.vfsCore, moduleName: this.config.moduleName })
                    ]
                },

                // 注入 UI 控制能力
                'core:titlebar': {
                    // @ts-ignore
                    ...(options.defaultPluginOptions?.['core:titlebar'] || {}),
                    ...contextFeatures
                }
            }
        };

        return this.config.editorFactory(container, mergedOptions);
    }

    private bindLayoutEvents() {
        // 监听 VFS-UI 状态以响应式更新布局
        const unsubscribe = this.vfsUI.on('sidebarStateChanged', ({ isCollapsed }) => {
            this.layout.toggleSidebar(isCollapsed);
        });

        // 简单的销毁链
        const originalDestroy = this.destroy;
        this.destroy = () => {
            unsubscribe();
            originalDestroy.call(this);
        };
    }

    public async start() {
        await this._ensureModuleMounted();
        
        // [简化] VFSUIManager.start() 内部已包含"若无活动会话则打开第一个文件"的逻辑
        await this.vfsUI.start();
    }

    private async _ensureModuleMounted() {
        const { vfsCore, moduleName } = this.config;
        if (!vfsCore.getModule(moduleName)) {
            try {
                await vfsCore.mount(moduleName, 'Memory Manager Module');
            } catch (error: any) {
                if (error.code !== 'ALREADY_EXISTS') console.error(`[MemoryManager] Mount failed:`, error);
            }
        }
    }

    public destroy() {
        this.lifecycleUnsubscribe();
        this.vfsUI.destroy();
        this.brain?.stop();
        this.layout.destroy();
    }
}
