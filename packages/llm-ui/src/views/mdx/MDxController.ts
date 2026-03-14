// @file llm-ui/views/mdx/MDxController.ts
import { createMDxEditor, MDxEditor } from '@itookit/mdxeditor';
import type { ISessionEngine, CollapseExpandResult } from '@itookit/common';
import { TimerManager } from '../common/TimerManager';

export interface MDxControllerOptions {
    readOnly?: boolean;
    onChange?: (text: string) => void;
    streaming?: boolean;
    // ✅ 新增：编辑器上下文
    nodeId?: string;
    ownerNodeId?: string;
    sessionEngine?: ISessionEngine;
}

export class MDxController {
    // ✨ [修改] 类型定义放宽为 IEditor，以便使用通用接口
    private editor: MDxEditor | null = null;
    private container: HTMLElement;
    private currentContent: string = '';
    private isStreaming: boolean = false;
    private isReadOnly: boolean = true;
    private onChangeCallback?: (text: string) => void;

    // ✅ 新增：记录初始化时是否为流式模式
    private isStreamingInit: boolean = false;

    // ✅ 新增：保存上下文
    private options: MDxControllerOptions;

    private isInitialized: boolean = false;
    private pendingChunks: string[] = [];
    private readyPromise: Promise<void>;
    private readyResolve!: () => void;
    // ✨ [修复 6.1] 添加 reject 函数
    private readyReject!: (reason: any) => void;

    // ✅ 新增：批量缓冲
    private contentSnapshot: string = '';

    // ✅ 改动：使用 TimerManager 管理所有定时器
    private timers = new TimerManager();

    private pendingRender = false;

    constructor(
        container: HTMLElement,
        initialContent: string,
        options?: MDxControllerOptions  // ✅ 使用新的选项接口
    ) {
        this.container = container;
        this.currentContent = initialContent;
        this.options = options || {};
        this.isReadOnly = options?.readOnly ?? true;
        this.onChangeCallback = options?.onChange;

        // ✅ 获取流式状态，默认为 false
        this.isStreamingInit = options?.streaming ?? false;

        this.readyPromise = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });

        this.init();
    }

    /**
     * ✨ [新增] 等待初始化完成
     */
    async waitUntilReady(): Promise<void> {
        return this.readyPromise;
    }

    private async init() {

        try {
            this.editor = await createMDxEditor(this.container, {
                initialContent: this.currentContent,
                initialMode: this.isReadOnly ? 'render' : 'edit',

                // ✅ 关键修复：传递上下文
                nodeId: this.options.nodeId,
                ownerNodeId: this.options.ownerNodeId,
                sessionEngine: this.options.sessionEngine,

                plugins: [
                    'editor:core',
                    'ui:formatting',
                    'mathjax',
                    'mermaid',
                    'codeblock-controls',
                    'task-list',
                    'media',
                    'svg',
                    'ui:toolbar'
                ],
                defaultPluginOptions: {
                    // ✅ 动态控制 defaultCollapsed
                    // 如果是正在输出的流(isStreamingInit=true)，则折叠(true)
                    // 否则(历史记录/编辑)，则展开(false)
                    'codeblock-controls': {
                        defaultCollapsed: !this.isStreamingInit,
                        streamingMode: this.isStreamingInit
                    }
                }
            }) as MDxEditor;

            this.editor.on('change', () => {
                if (!this.isStreaming) {
                    const text = this.editor!.getText();
                    this.currentContent = text;
                    this.onChangeCallback?.(text);
                }
            });

            this.isInitialized = true;
            console.log('[MDxController] init() completed');

            // 处理待处理的 chunks
            if (this.pendingChunks.length > 0) {
                console.log('[MDxController] Applying pending chunks, count:', this.pendingChunks.length);
                this.pendingChunks = [];
                await this.editor.setStreamingText(this.currentContent);
            }

            // ✨ [优化] 解析 ready Promise
            this.readyResolve();

        } catch (e) {
            console.error('[MDxController] init() failed:', e);
            // ✨ [修复 6.1] 使用 reject 通知失败
            this.readyReject(e);
            // 不再 throw，让外部通过 promise 处理
        }
    }

    // ✨ ==================== 新增：代码块折叠/展开接口 ====================

    /**
     * 折叠编辑器内所有代码块
     * @returns 操作结果
     */
    async collapseBlocks(): Promise<CollapseExpandResult> {
        if (!this.editor || !this.isInitialized) {
            return { affectedCount: 0, allCollapsed: true };
        }

        // 确保在 render 模式下才能操作代码块
        if (this.editor.getMode() !== 'render') {
            return { affectedCount: 0, allCollapsed: true };
        }

        return await this.editor.collapseBlocks();
    }

    /**
     * 展开编辑器内所有代码块
     * @returns 操作结果
     */
    async expandBlocks(): Promise<CollapseExpandResult> {
        if (!this.editor || !this.isInitialized) {
            return { affectedCount: 0, allCollapsed: false };
        }

        if (this.editor.getMode() !== 'render') {
            return { affectedCount: 0, allCollapsed: false };
        }

        return await this.editor.expandBlocks();
    }

    /**
     * 切换所有代码块的折叠状态
     * @returns 操作结果
     */
    async toggleBlocks(): Promise<CollapseExpandResult> {
        if (!this.editor || !this.isInitialized) {
            return { affectedCount: 0, allCollapsed: false };
        }

        if (this.editor.getMode() !== 'render') {
            return { affectedCount: 0, allCollapsed: false };
        }

        return await this.editor.toggleBlocks();
    }

    /**
     * ✅ 优化：追加流式内容
     */
    appendStream(delta: string): void {
        this.isStreaming = true;
        this.currentContent += delta;

        if (!this.isInitialized || !this.editor) {
            this.pendingChunks.push(delta);
            return;
        }

        this.pendingRender = true;
    }

    /**
     * ✅ 新增：由 Pipeline 调用，执行实际渲染
     * 将积累的内容一次性推送给编辑器
     */
    async flushStream(): Promise<void> {
        if (!this.pendingRender || !this.editor || !this.isInitialized) return;
        if (this.currentContent === this.contentSnapshot) return;

        this.pendingRender = false;

        // ✅ 记录渲染前的容器滚动位置
        const container = this.container.closest('.llm-ui-history') as HTMLElement;
        const scrollTopBefore = container?.scrollTop ?? 0;
        const scrollHeightBefore = container?.scrollHeight ?? 0;
        try {
            await this.editor.setStreamingText(this.currentContent);
            this.contentSnapshot = this.currentContent;
            // ✅ 渲染后补偿滚动位置（防止高度变化导致跳变）
            if (container) {
                const scrollHeightAfter = container.scrollHeight;
                const delta = scrollHeightAfter - scrollHeightBefore;
                if (delta !== 0 && container.scrollTop === scrollTopBefore) {
                    // 内容在视口上方增加/减少了高度，补偿滚动位置
                    container.scrollTop = scrollTopBefore + delta;
                }
            }
        } catch (e) {
            console.error('[MDxController] Render failed:', e);
        }
    }

    /**
     * ✅ 查询是否有待渲染内容
     */
    hasPendingRender(): boolean {
        return this.pendingRender;
    }

    /**
     * ✅ 简化：结束流式
     */
    finishStream(emitChange: boolean = false): void {
        this.isStreaming = false;
        this.pendingRender = false;

        // 最终渲染
        if (this.editor && this.isInitialized
            && this.currentContent !== this.contentSnapshot) {
            queueMicrotask(async () => {
                try {
                    await this.editor!.setStreamingText(this.currentContent);
                    this.contentSnapshot = this.currentContent;
                } catch (e) {
                    console.error('[MDxController] Final render failed:', e);
                }
            });
        }

        if (emitChange) {
            this.onChangeCallback?.(this.currentContent);
        }
    }

    async toggleEdit() {
        if (!this.editor) return;

        this.isReadOnly = !this.isReadOnly;
        const targetMode = this.isReadOnly ? 'render' : 'edit';
        await this.editor.switchToMode(targetMode);

        if (!this.isReadOnly) {
            this.editor.focus();
        }
    }

    get content() { return this.currentContent; }

    /**
     * ✨ [新增] 设置内容（用于编辑取消时恢复）
     */
    setContent(content: string) {
        this.currentContent = content;
        this.contentSnapshot = content;
        if (this.isInitialized && this.editor) {
            this.editor.setText(content);
        }
    }

    /**
     * ✨ [新增] 获取当前是否处于编辑模式
     */
    isEditing(): boolean {
        return !this.isReadOnly;
    }

    /**
     * ✨ [新增] 强制进入指定模式
     */
    async setMode(mode: 'edit' | 'render') {
        if (!this.editor) return;

        const shouldBeReadOnly = mode === 'render';
        if (this.isReadOnly !== shouldBeReadOnly) {
            this.isReadOnly = shouldBeReadOnly;
            await this.editor.switchToMode(mode);
        }
    }

    destroy() {
        this.timers.destroy();
        this.editor?.destroy();
        this.editor = null;
        this.isInitialized = false;
        this.pendingChunks = [];
    }
}
