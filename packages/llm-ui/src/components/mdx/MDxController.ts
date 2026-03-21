// @file llm-ui/views/mdx/MDxController.ts
import { createMDxEditor, MDxEditor } from '@itookit/mdxeditor';
import type { ISessionEngine, CollapseExpandResult } from '@itookit/common';
import { TimerManager } from '../common/TimerManager';

export interface MDxControllerOptions {
    readOnly?: boolean;
    onChange?: (text: string) => void;
    streaming?: boolean;
    nodeId?: string;
    ownerNodeId?: string;
    sessionEngine?: ISessionEngine;
}

/**
 * MDx 编辑器控制器
 *
 * 关键改动（抖动修复）：
 * - flushStream() 不再做滚动补偿
 * - 渲染职责纯粹：只负责将内容推送给编辑器
 * - 滚动由 StreamRenderPipeline → ScrollController 在下一帧统一处理
 *
 * 违反 SRP 的旧代码已移除：
 * - 不再 querySelector('.llm-ui-history') 获取滚动容器
 * - 不再读写 scrollTop/scrollHeight
 */
export class MDxController {
    private editor: MDxEditor | null = null;
    private container: HTMLElement;
    private currentContent: string = '';
    private isStreaming: boolean = false;
    private isReadOnly: boolean = true;
    private onChangeCallback?: (text: string) => void;

    private isStreamingInit: boolean = false;
    private options: MDxControllerOptions;

    private isInitialized: boolean = false;
    private pendingChunks: string[] = [];
    private readyPromise: Promise<void>;
    private readyResolve!: () => void;
    private readyReject!: (reason: any) => void;

    // 批量缓冲
    private contentSnapshot: string = '';

    private timers = new TimerManager();
    private pendingRender = false;

    constructor(
        container: HTMLElement,
        initialContent: string,
        options?: MDxControllerOptions
    ) {
        this.container = container;
        this.currentContent = initialContent;
        this.options = options || {};
        this.isReadOnly = options?.readOnly ?? true;
        this.onChangeCallback = options?.onChange;
        this.isStreamingInit = options?.streaming ?? false;

        this.readyPromise = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });

        this.init();
    }

    async waitUntilReady(): Promise<void> {
        return this.readyPromise;
    }

    private async init() {
        try {
            this.editor = await createMDxEditor(this.container, {
                initialContent: this.currentContent,
                initialMode: this.isReadOnly ? 'render' : 'edit',
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

            this.readyResolve();

        } catch (e) {
            console.error('[MDxController] init() failed:', e);
            this.readyReject(e);
        }
    }

    // ==================== 代码块折叠/展开接口 ====================

    async collapseBlocks(): Promise<CollapseExpandResult> {
        if (!this.editor || !this.isInitialized) {
            return { affectedCount: 0, allCollapsed: true };
        }
        if (this.editor.getMode() !== 'render') {
            return { affectedCount: 0, allCollapsed: true };
        }
        return await this.editor.collapseBlocks();
    }

    async expandBlocks(): Promise<CollapseExpandResult> {
        if (!this.editor || !this.isInitialized) {
            return { affectedCount: 0, allCollapsed: false };
        }
        if (this.editor.getMode() !== 'render') {
            return { affectedCount: 0, allCollapsed: false };
        }
        return await this.editor.expandBlocks();
    }

    async toggleBlocks(): Promise<CollapseExpandResult> {
        if (!this.editor || !this.isInitialized) {
            return { affectedCount: 0, allCollapsed: false };
        }
        if (this.editor.getMode() !== 'render') {
            return { affectedCount: 0, allCollapsed: false };
        }
        return await this.editor.toggleBlocks();
    }

    // ==================== 流式内容管理 ====================

    /**
     * 追加流式内容 — 只积累，不渲染
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
     * 由 Pipeline 调用，执行增量渲染
     *
     * 委托给 MDxEditor.setStreamingText()，
     * 内部通过 MDxRenderer.renderStreaming() 实现增量更新：
     * - 只重新渲染变化的尾部块
     * - 已渲染的 DOM 节点保持稳定（代码块 fold、copy 按钮不受影响）
     *
     * 不做任何滚动操作 — 滚动由 ScrollController 在下一帧处理。
     */
    async flushStream(): Promise<void> {
        if (!this.pendingRender || !this.editor || !this.isInitialized) return;
        if (this.currentContent === this.contentSnapshot) return;

        this.pendingRender = false;

        try {
            await this.editor.setStreamingText(this.currentContent);
            this.contentSnapshot = this.currentContent;
        } catch (e) {
            console.error('[MDxController] Render failed:', e);
        }
    }

    /**
     * 查询是否有待渲染内容
     */
    hasPendingRender(): boolean {
        return this.pendingRender;
    }

    /**
     * 结束流式模式
     *
     * 调用 MDxEditor.finishStreamingText() 执行最终完整渲染，
     * 确保所有插件效果（语法高亮、Mermaid、MathJax 等）正确应用。
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

    // ==================== 编辑模式 ====================

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

    setContent(content: string) {
        this.currentContent = content;
        this.contentSnapshot = content;
        if (this.isInitialized && this.editor) {
            this.editor.setText(content);
        }
    }

    isEditing(): boolean {
        return !this.isReadOnly;
    }

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
