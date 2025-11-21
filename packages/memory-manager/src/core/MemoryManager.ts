/**
 * @file src/core/MemoryManager.ts
 */
import {FileMentionSource,DirectoryMentionSource} from '@itookit/vfs-core';
import { createVFSUI, connectEditorLifecycle, VFSUIManager } from '@itookit/vfs-ui';
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
     * [架构核心] 增强工厂：配置聚合与依赖注入层
     * 解决了参数跨越 vfs-ui 传递困难的问题。
     */
    private enhancedEditorFactory = async (container: HTMLElement, runtimeOptions: EditorOptions): Promise<IEditor> => {
        const { editorConfig } = this.config;
        
        // 准备上下文能力 (Capabilities)
        const contextFeatures = {
            toggleSidebarCallback: () => this.vfsUI.toggleSidebar(),
            saveCallback: async (editorInstance: any) => {
                if (runtimeOptions.nodeId && typeof editorInstance.getText === 'function') {
                    await this.config.vfsCore.getVFS().write(runtimeOptions.nodeId, editorInstance.getText());
                }
            }
        };

        // 智能合并策略：
        // 1. 静态配置 (来自 Main/Config)
        // 2. 运行时配置 (来自 VFS-UI，如 nodeId, content) - 优先级高于静态
        // 3. 注入能力 (Context Features) - 强制注入
        const mergedOptions: EditorOptions = {
            ...editorConfig,       // 1. 基础静态配置
            ...runtimeOptions,     // 2. 运行时覆盖 (nodeId, initialContent, title)

            // 数组合并：确保 workspace 定义的插件 + 运行时可能的插件都被包含
            plugins: [
                ...(editorConfig?.plugins || []),
                ...(runtimeOptions?.plugins || [])
            ],

            // 深度合并 defaultPluginOptions
            defaultPluginOptions: {
                ...(editorConfig?.defaultPluginOptions || {}),
                ...(runtimeOptions?.defaultPluginOptions || {}),

                // [注入] 提及插件的数据源
                'autocomplete:mention': {
                    // @ts-ignore
                    ...(editorConfig?.defaultPluginOptions?.['autocomplete:mention'] || {}),
                    providers: [
                        new FileMentionSource({ vfsCore: this.config.vfsCore, moduleName: this.config.moduleName }),
                        new DirectoryMentionSource({ vfsCore: this.config.vfsCore, moduleName: this.config.moduleName })
                    ]
                },

                // [注入] 标题栏控制能力
                'core:titlebar': {
                    // @ts-ignore
                    ...(editorConfig?.defaultPluginOptions?.['core:titlebar'] || {}),
                    ...contextFeatures
                }
            }
        };

        // 调用原始工厂
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
        await this.vfsUI.start(); // vfsUI 启动

        // [架构修正] 将业务逻辑移至此处：检查空状态并创建默认文件
        // 这比在 VFSUIManager 内部做更好，因为这属于“应用策略”
        const { defaultContentConfig } = this.config;
        if (defaultContentConfig) {
            const state = this.vfsUI.store?.getState(); // 假设暴露了 store 或有 getter
            // 或者通过 getSessionService 获取列表检查
            const files = await this.vfsUI.sessionService.getAllFiles();
            
            if (files.length === 0) {
                console.log(`[MemoryManager] Empty module, creating default file: ${defaultContentConfig.fileName}`);
                try {
                    const newFile = await this.vfsUI.sessionService.createFile({
                        title: defaultContentConfig.fileName,
                        content: defaultContentConfig.content,
                        parentId: null
                    });
                    // 自动选中新建的文件
                    this.vfsUI.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: newFile.nodeId }});
                } catch (e) {
                    console.error("Failed to create default file", e);
                }
            }
        }
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
