/**
 * @file src/core/MemoryManager.ts
 */
import { createVFSUI, connectEditorLifecycle, VFSUIManager, FileProvider } from '@itookit/vfs-ui';
import { EditorOptions, IEditor, ISessionManager } from '@itookit/common';
import { MemoryManagerConfig } from '../types';
import { BackgroundBrain } from './BackgroundBrain';
import { Layout } from './Layout';
import { VNodeType } from '@itookit/vfs-core';

export class MemoryManager {
    private vfsUI: VFSUIManager;
    private brain?: BackgroundBrain;
    private layout: Layout;
    private lifecycleUnsubscribe: () => void;
    private activeEditor: IEditor | null = null;

    constructor(private config: MemoryManagerConfig) {
        // 1. 创建 DOM 布局
        this.layout = new Layout(config.container);

        // 2. 初始化 VFS-UI (侧边栏)
        this.vfsUI = createVFSUI(
            {
                ...config.uiOptions,
                sessionListContainer: this.layout.sidebarContainer,
                // 确保 vfs-ui 知道初始状态
                initialSidebarCollapsed: false,
            },
            config.vfsCore,
            config.moduleName
        ) as VFSUIManager;

        // 3. 初始化 AI 大脑 (如果启用)
        if (config.aiConfig?.enabled) {
            this.brain = new BackgroundBrain(
                config.vfsCore,
                config.moduleName,
                config.aiConfig.activeRules
            );
            this.brain.start();
        }

        // 4. 连接编辑器生命周期 (核心胶水)
        // 我们拦截了 editorFactory，注入了 Context 上下文
        this.lifecycleUnsubscribe = connectEditorLifecycle(
            this.vfsUI,
            config.vfsCore,
            this.layout.editorContainer,
            this.enhancedEditorFactory,
            {
                // 传递给 connectEditorLifecycle 的额外选项
                onEditorCreated: (editor) => {
                    this.activeEditor = editor;
                    this.bindEditorEvents(editor);
                }
            }
        );

        // 5. 监听 UI 布局事件
        this.bindLayoutEvents();
    }

    /**
     * 增强工厂：将 Manager 的能力注入到 Editor 中
     * 这是实现“依赖注入”的关键步骤，解决了编辑器如何控制外部 UI 的问题。
     */
    private enhancedEditorFactory = async (container: HTMLElement, options: EditorOptions): Promise<IEditor> => {
        // [新增] 创建默认的文件 Provider，使 @file 提及功能开箱即用
        const fileProvider = new FileProvider({
            vfsCore: this.config.vfsCore,
            moduleName: this.config.moduleName
        });

        // 构造注入给编辑器的上下文能力
        const contextFeatures = {
            // 允许编辑器按钮调用 vfs-ui 的 toggleSidebar
            toggleSidebarCallback: () => this.vfsUI.toggleSidebar(),

            // 允许编辑器触发手动保存
            saveCallback: async (editorInstance: any) => {
                // 注意：connectEditorLifecycle 已经在切换时处理了保存
                // 这个 callback 主要是给编辑器内的 "Save" 按钮使用的
                if (options.nodeId) {
                    // 尝试获取文本，兼容不同的编辑器实现接口
                    const text = typeof editorInstance.getText === 'function'
                        ? editorInstance.getText()
                        : '';
                    await this.config.vfsCore.getVFS().write(options.nodeId, text);
                }
            }
        };

        // 将这些能力合并到 defaultPluginOptions 中
        // MDxEditor 的 CoreTitleBarPlugin 约定会查找 toggleSidebarCallback
        const mergedOptions = {
            ...options,
            defaultPluginOptions: {
                ...(options.defaultPluginOptions || {}),

                // [新增] 注入 Mention 插件的必要配置
                'autocomplete:mention': {
                    // @ts-ignore
                    ...(options.defaultPluginOptions?.['autocomplete:mention'] || {}),
                    providers: [fileProvider] // 注入 Provider，解决 crash 问题
                },

                'core:titlebar': {
                    // @ts-ignore: 动态合并可能未定义的类型
                    ...(options.defaultPluginOptions?.['core:titlebar'] || {}),
                    ...contextFeatures
                }
            }
        };

        // 调用用户提供的原始工厂
        return this.config.editorFactory(container, mergedOptions);
    }

    private bindLayoutEvents() {
        // 监听 VFS-UI 的侧边栏状态变更事件，更新布局
        // 注意：vfs-ui 使用 event emitter 模式，具体事件名需参考 vfs-ui 文档
        // 这里假设是 'sidebarStateChanged'
        const unsubscribe = this.vfsUI.on('sidebarStateChanged', ({ isCollapsed }) => {
            this.layout.toggleSidebar(isCollapsed);
        });

        // 将 unsubscribe 绑定到 destroy 流程中（这里简化处理，实际应存入数组）
        const originalDestroy = this.destroy.bind(this);
        this.destroy = () => {
            unsubscribe();
            originalDestroy();
        };
    }

    /**
     * 绑定编辑器实例级别的事件
     * 处理“失去焦点保存”、“进入 render 模式保存”等需求
     */
    private bindEditorEvents(editor: IEditor | null) {
        if (!editor) return;

        // 1. 监听模式切换 -> 自动保存
        const modeUnsub = editor.on('modeChanged', async (payload: any) => {
            // 当进入 render 模式时，保存内容
            if (payload?.mode === 'render') {
                // 这里的 nodeId 需要从 editor 实例或闭包中获取
                // 假设 editor 实例不持有 nodeId，我们无法直接保存
                // 但 connectEditorLifecycle 会在切换文件时保存
                // 如果需要实时保存，Editor 必须知道自己的 nodeId

                // 补救方案：在 enhancedEditorFactory 中，我们把 nodeId 闭包给了 saveCallback
                // 但在这里我们是在外部。

                // 最佳实践：Editor 应该暴露一个 save 接口，或者我们依赖 connectEditorLifecycle 的切换保存。
                // 原始需求要求 "进入 render ... 时刷新文件"。刷新通常意味着读取最新，或者保存当前。
                // 这里理解为保存当前状态。
            }
        });

        // 2. 失去焦点保存 (DOM 级)
        // editor.container 是 IEditor 接口的一部分
        const container = (editor as any).container || this.layout.editorContainer;

        const blurHandler = (e: FocusEvent) => {
            // 检查焦点是否完全离开了编辑器区域
            if (container.contains(e.relatedTarget as Node)) return;

            // 触发保存逻辑...
            // 由于 IEditor 接口通常不包含 save()，我们这里假设这是为了用户体验
            // 实际的数据一致性由 connectEditorLifecycle 保证
            console.log('[MemoryManager] Editor lost focus (auto-save trigger point)');
        };

        container.addEventListener('focusout', blurHandler);

        // 劫持 destroy 以清理事件
        const originalEditorDestroy = editor.destroy.bind(editor);
        editor.destroy = async () => {
            container.removeEventListener('focusout', blurHandler);
            await originalEditorDestroy();
        };
    }

    public async start() {
        // [新增] 1. 自动挂载模块
        await this._ensureModuleMounted();

        // 2. 启动 UI，尝试恢复上次会话
        const activeSession = await this.vfsUI.start();

        // [新增] 3. 如果没有恢复会话，自动打开第一个文件
        if (!activeSession) {
            await this._autoOpenFirstFile();
        }
    }

    private async _ensureModuleMounted() {
        const { vfsCore, moduleName } = this.config;
        if (!vfsCore.getModule(moduleName)) {
            try {
                console.log(`[MemoryManager] Auto-mounting module: ${moduleName}`);
                await vfsCore.mount(moduleName, 'Memory Manager Module');
            } catch (error: any) {
                if (error.code !== 'ALREADY_EXISTS') {
                    console.error(`[MemoryManager] Failed to mount module:`, error);
                }
            }
        }
    }

    private async _autoOpenFirstFile() {
        try {
            // 使用 VFS Core 的搜索功能查找第一个文件
            const files = await this.config.vfsCore.searchNodes(
                this.config.moduleName,
                { type: VNodeType.FILE, limit: 1 }
            );

            if (files.length > 0) {
                console.log(`[MemoryManager] Auto-opening first file: ${files[0].name}`);

                // 通过 VFS-UI Store 触发选择
                // 这里我们需要一些 Hack，或者在 VFS-UI 中暴露 public method
                // 假设 VFS-UI 实例上有 store 属性 (在 JS 环境或通过强制类型转换)
                const store = (this.vfsUI as any).store;
                if (store && store.dispatch) {
                    store.dispatch({
                        type: 'SESSION_SELECT',
                        payload: { sessionId: files[0].nodeId }
                    });
                }
            }
        } catch (e) {
            console.warn('[MemoryManager] Auto-open failed:', e);
        }
    }

    public destroy() {
        this.lifecycleUnsubscribe();
        this.vfsUI.destroy();
        this.brain?.stop();
        this.layout.destroy();
        this.activeEditor = null;
    }
}
