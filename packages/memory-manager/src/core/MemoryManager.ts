/**
 * @file memory-manager/core/MemoryManager.ts
 */
import { VFSModuleEngine } from '@itookit/vfs-core';
import { 
    createVFSUI, 
    connectEditorLifecycle, 
    VFSUIManager, 
    FileMentionSource, 
    DirectoryMentionSource 
} from '@itookit/vfs-ui';
import { EditorOptions, IEditor, ISessionEngine } from '@itookit/common';

// 假设 createMDxEditor 位于同级或引用的包中
import { createMDxEditor } from '@itookit/mdxeditor'; 
import { MemoryManagerConfig } from '../types';
import { BackgroundBrain } from './BackgroundBrain';
import { Layout } from './Layout';

export class MemoryManager {
    private vfsUI: VFSUIManager;
    private engine: ISessionEngine;
    private brain?: BackgroundBrain;
    private layout: Layout;
    private lifecycleUnsubscribe: () => void;
    private baseEditorFactory: any; // EditorFactory 类型

    constructor(private config: MemoryManagerConfig) {
        // 1. 初始化布局
        this.layout = new Layout(config.container);

        // 2. 确定 SessionEngine
        if (config.customEngine) {
            this.engine = config.customEngine;
        } else if ( config.moduleName) {
            this.engine = new VFSModuleEngine(config.moduleName);
        } else {
            throw new Error("[MemoryManager] You must provide either 'customEngine' or both 'vfsCore' and 'moduleName'.");
        }

        // 3. 确定基础编辑器工厂 (默认使用 MDxEditor)
        this.baseEditorFactory = config.editorFactory || createMDxEditor;

        // 4. 初始化 VFS-UI
        // 注意：我们将 this.enhancedEditorFactory 传给 VFS-UI 作为默认工厂
        this.vfsUI = createVFSUI(
            {
                ...config.uiOptions,
                // 容器挂载
                sessionListContainer: this.layout.sidebarContainer,
                initialSidebarCollapsed: false,
                
                // 默认文件逻辑
                defaultFileName: config.defaultContentConfig?.fileName,
                defaultFileContent: config.defaultContentConfig?.content,

                // [关键] 注入增强后的编辑器工厂作为兜底
                defaultEditorFactory: this.enhancedEditorFactory,
                
                // [透传] 高级文件类型支持
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
        const { editorConfig, mentionScope } = this.config; // [新增] 读取 mentionScope
        
        // 1. 准备注入给编辑器的能力 (Capabilities)
        const contextFeatures = {
            // 允许编辑器控制侧边栏
            toggleSidebarCallback: () => this.vfsUI.toggleSidebar(),
            // 允许编辑器触发保存 (虽然 Connector 会自动保存，但某些插件可能需要手动触发)
            saveCallback: async (editorInstance: any) => {
                if (runtimeOptions.nodeId && typeof editorInstance.getText === 'function') {
                    await this.engine.writeContent(runtimeOptions.nodeId, editorInstance.getText());
                }
            }
        };

        // 2. 深度合并配置
        const mergedOptions: EditorOptions = {
            ...editorConfig,       // 静态配置 (Plugins list 等)
            ...runtimeOptions,     // 运行时配置 (Content, Title, NodeId)
            
            // ✨ [修复] 显式注入 Session Engine，使插件能够访问全局数据
            sessionEngine: this.engine, 

            // 插件合并策略：连接数组
            plugins: [
                ...(editorConfig?.plugins || []),
                ...(runtimeOptions?.plugins || [])
            ],

            // 插件选项合并策略
            defaultPluginOptions: {
                ...(editorConfig?.defaultPluginOptions || {}),
                ...(runtimeOptions?.defaultPluginOptions || {}),

                // [自动注入] 提及插件的数据源 (连接到当前 Engine)
                'autocomplete:mention': {
                    // @ts-ignore
                    ...(editorConfig?.defaultPluginOptions?.['autocomplete:mention'] || {}),
                    providers: [
                        // [修改] 传递 scope
                        new FileMentionSource({ 
                            engine: this.engine, 
                            scope: mentionScope ?? ['*'] // 默认为全局
                        }),
                        new DirectoryMentionSource({ 
                            engine: this.engine, 
                            scope: mentionScope ?? ['*'] 
                        })
                    ]
                },

                // [自动注入] 标题栏能力
                'core:titlebar': {
                    // @ts-ignore
                    ...(editorConfig?.defaultPluginOptions?.['core:titlebar'] || {}),
                    ...contextFeatures
                }
            }
        };

        // 3. 调用具体的基础工厂 (MDxEditor 或 用户自定义)
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
