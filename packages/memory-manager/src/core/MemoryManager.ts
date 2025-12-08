/**
 * @file memory-manager/core/MemoryManager.ts
 */
import { VFSModuleEngine } from '@itookit/vfs-core';
import { createVFSUI, connectEditorLifecycle, VFSUIManager } from '@itookit/vfs-ui';
import { createMDxEditor } from '@itookit/mdxeditor'; 
import { MemoryManagerConfig, EditorHostContext,EditorConfigEnhancer } from '../types';
import { createMDxEnhancer } from '../enhancers/mdx'; // 默认回退
import { BackgroundBrain } from './BackgroundBrain';
import { Layout } from './Layout';
import { EditorOptions, IEditor, ISessionEngine } from '@itookit/common';

export class MemoryManager {
    private vfsUI: VFSUIManager;
    private engine: ISessionEngine;
    private brain?: BackgroundBrain;
    private layout: Layout;
    private configEnhancer: EditorConfigEnhancer;
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

        // 3. [关键] Enhancer 解析
        // 如果未提供 enhancer 且使用的是默认 MDxEditor，则使用默认 MDx 增强器（保持向后兼容）
        // 否则使用空增强器 (不做任何注入)
        if (config.configEnhancer) {
            this.configEnhancer = config.configEnhancer;
        } else if (!config.editorFactory) {
             // 默认情况：使用 MDx 且注入 Mentions (默认全局范围)
            this.configEnhancer = createMDxEnhancer(['*']);
        } else {
            // 自定义 Factory 但没给 Enhancer，默认不做处理
            this.configEnhancer = (opts) => opts;
        }

        // 4. 初始化 UI (注入 enhancedEditorFactory)
        this.vfsUI = createVFSUI(
            {
                ...config.uiOptions,
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
            toggleSidebar: (collapsed?: boolean) => {
                // 调用 VFSUI 或 Layout 的方法
                this.vfsUI.toggleSidebar(); 
            },
            saveContent: async (nodeId: string, content: string) => {
                await this.engine.writeContent(nodeId, content);
            }
        };

        // 2. 基础配置合并
        let mergedOptions: EditorOptions = {
            ...editorConfig,
            ...runtimeOptions,
            plugins: [ ...(editorConfig?.plugins || []), ...(runtimeOptions?.plugins || []) ],
            defaultPluginOptions: {
                ...(editorConfig?.defaultPluginOptions || {}),
                ...(runtimeOptions?.defaultPluginOptions || {}),
            }
        };

        // 3. 执行增强策略 (分发)
        // 将标准化的 hostContext 传递给 Enhancer，由 Enhancer 决定怎么塞给编辑器
        mergedOptions = this.configEnhancer(mergedOptions, {
            engine: this.engine,
            host: hostContext // ✅ 注入
        });

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
