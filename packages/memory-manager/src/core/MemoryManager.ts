/**
 * @file memory-manager/core/MemoryManager.ts
 */
import { VFSModuleEngine } from '@itookit/vfs-core';
import { createVFSUI, connectEditorLifecycle, VFSUIManager } from '@itookit/vfs-ui';
import { createMDxEditor } from '@itookit/mdxeditor'; 
import { MemoryManagerConfig } from '../types';
import { BackgroundBrain } from './BackgroundBrain';
import { Layout } from './Layout';
import { EditorHostContext, EditorOptions, IEditor, ISessionEngine } from '@itookit/common';

export class MemoryManager {
    private vfsUI: VFSUIManager;
    private engine: ISessionEngine;
    private brain?: BackgroundBrain;
    private layout: Layout;
    private lifecycleUnsubscribe: () => void;
    private baseEditorFactory: any; // EditorFactory 类型

    constructor(private config: MemoryManagerConfig) {
        this.layout = new Layout(config.container);

        // 1. Engine 解析
        if (config.customEngine) {
            this.engine = config.customEngine;
        } else if (config.moduleName) {
            this.engine = new VFSModuleEngine(config.moduleName);
        } else {
            throw new Error("Missing engine configuration");
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
                defaultEditorFactory: this.enhancedEditorFactory, // 注入拦截器
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

        // 6. 连接编辑器生命周期 (自动化管理创建、保存、销毁)
        // 这里的 factory 参数主要用于 connector 内部直接调用，或作为 fallback
        this.lifecycleUnsubscribe = connectEditorLifecycle(
            this.vfsUI,
            this.engine,
            this.layout.editorContainer,
            this.enhancedEditorFactory // 传递增强版工厂
        );

        // 7. 绑定布局响应事件
        this.bindLayoutEvents();
    }

    /**
     * [核心架构] 增强型编辑器工厂
     * 作用：拦截创建过程，注入 MemoryManager 的上下文能力和配置。
     * 此时 this.vfsUI 可能还在初始化中，但当此函数被实际调用时(打开文件时)，它一定已经可用。
     */
    private enhancedEditorFactory = async (container: HTMLElement, runtimeOptions: EditorOptions): Promise<IEditor> => {
        const { editorConfig } = this.config;

        // 1. 准备宿主能力 (生产)
        // 这些函数封装了 MemoryManager 内部的 Layout 和 VFSUI 操作
        const hostContext: EditorHostContext = {
            toggleSidebar: (_collapsed?: boolean) => {
                // 调用 VFSUI 或 Layout 的方法
                this.vfsUI.toggleSidebar(); 
            },
            saveContent: async (nodeId: string, content: string) => {
                await this.engine.writeContent(nodeId, content);
            }
        };

        // 2. 基础配置合并
        const mergedOptions: EditorOptions = {
            ...editorConfig,
            ...runtimeOptions,
            plugins: [ ...(editorConfig?.plugins || []), ...(runtimeOptions?.plugins || []) ],
            defaultPluginOptions: {
                ...(editorConfig?.defaultPluginOptions || {}),
                ...(runtimeOptions?.defaultPluginOptions || {}),
            },

            // ✅ [关键] 强制注入当前环境的依赖 (Dependency Injection)
            // 这让编辑器可以无感知地使用 engine 和 UI 控制能力
            sessionEngine: this.engine,
            hostContext: hostContext
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
        const originalDestroy = this.destroy;
        this.destroy = () => {
            unsubscribe();
            originalDestroy.call(this);
        };
    }

    public async start() {
        await this.engine.init();
        await this.vfsUI.start(); 
    }

    public destroy() {
        this.lifecycleUnsubscribe(); // 断开编辑器连接
        this.vfsUI.destroy();        // 销毁 UI
        this.brain?.stop();          // 停止 AI
        this.layout.destroy();       // 清理 DOM
    }
}
