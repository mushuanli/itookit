// @file llm-ui/views/mdx/MDxController.ts
import { createMDxEditor, MDxEditor } from '@itookit/mdxeditor';
import type { CollapseExpandResult } from '@itookit/ui-common';
import type { IModuleFS } from '@itookit/vfs-core';
import type { IStreamableEditor } from '../../domain/ports/IStreamableEditor';

export interface MDxControllerOptions {
    readOnly?: boolean;
    onChange?: (text: string) => void;
    streaming?: boolean;
    nodeId?: string;
    ownerNodeId?: string;
    moduleFS?: IModuleFS;
}

/**
 * MDxController — 实现 IStreamableEditor
 *
 * 核心改动：
 * - 移除所有滚动相关代码（不是它的职责）
 * - appendDelta() 仅内存追加
 * - flush() 执行渲染并返回高度变化
 * - 不查找父容器，不操作 scrollTop
 */
export class MDxController implements IStreamableEditor {
    private editor: MDxEditor | null = null;
    private container: HTMLElement;
    private currentContent: string = '';
    private pendingDelta: string = '';
    /** 串行化渲染任务链：并发 setStreamingText 会互相覆盖并误清 pendingDelta。 */
    private flushChain: Promise<void> = Promise.resolve();
    private isStreaming: boolean = false;
    private isReadOnly: boolean = true;
    private onChangeCallback?: (text: string) => void;
    private isStreamingInit: boolean = false;
    private options: MDxControllerOptions;
    private isInitialized: boolean = false;
    private readyPromise: Promise<void>;
    private readyResolve!: () => void;
    private readyReject!: (reason: any) => void;

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

    private async init(): Promise<void> {
        try {
            this.editor = await createMDxEditor(this.container, {
                initialContent: this.currentContent,
                initialMode: this.isReadOnly ? 'render' : 'edit',
                nodeId: this.options.nodeId,
                ownerNodeId: this.options.ownerNodeId,
                moduleFS: this.options.moduleFS,
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
            this.readyResolve();

            // Render any content that arrived before the editor was ready.
            // finishStream() clears pendingDelta before isInitialized is true, so
            // check currentContent (never cleared until reset) instead of pendingDelta.
            if (this.currentContent) {
                void this.finalize();
            }
        } catch (e) {
            console.error('[MDxController] init() failed:', e);
            this.readyReject(e);
        }
    }

    // ================================================================
    // IStreamableEditor 实现
    // ================================================================

    /**
     * 追加增量内容（仅内存操作）
     * 不触发渲染，不操作 DOM
     */
    appendDelta(chunk: string): void {
        this.isStreaming = true;
        this.currentContent += chunk;
        this.pendingDelta += chunk;
    }

    /**
     * 执行渲染，返回高度变化量
     * 由 StreamController 调用
     * 不操作滚动，不查找父容器
     */
    async flush(): Promise<number> {
        if (!this.editor || !this.isInitialized) {
            return 0;
        }
        const editor = this.editor;
        // 串行化渲染：并发 setStreamingText 会互相覆盖，且 pendingDelta 会被误清。
        const run = this.flushChain.then(async (): Promise<number> => {
            if (!this.pendingDelta) return 0;
            const snapshot = this.currentContent;
            const renderedLen = this.pendingDelta.length;
            const heightBefore = this.container.offsetHeight;
            try {
                await editor.setStreamingText(snapshot);
            } catch (e) {
                console.error('[MDxController] flush failed:', e);
                return 0;
            }
            // 只清除本次已渲染的增量；await 期间新 appendDelta 的增量保留。
            this.pendingDelta = this.pendingDelta.slice(renderedLen);
            return this.container.offsetHeight - heightBefore;
        });
        this.flushChain = run.then(() => {}, () => {});
        return run;
    }

    /**
     * 结束流式，执行最终完整渲染
     */
    async finalize(): Promise<void> {
        this.isStreaming = false;
        this.pendingDelta = '';

        if (!this.editor || !this.isInitialized) return;
        const editor = this.editor;

        // 排在未完成的 flush 之后做最终完整渲染，避免与流式渲染竞争。
        const run = this.flushChain.then(async () => {
            try {
                // 使用 finishStreamingText 做最终完整渲染
                if (typeof (editor as any).finishStreamingText === 'function') {
                    await (editor as any).finishStreamingText(this.currentContent);
                } else {
                    await editor.setStreamingText(this.currentContent);
                }
            } catch (e) {
                console.error('[MDxController] finalize failed:', e);
            }
        });
        this.flushChain = run.then(() => {}, () => {});
        await run;
    }

    get content(): string {
        return this.currentContent;
    }

    get hasPending(): boolean {
        return this.pendingDelta.length > 0;
    }

    // ================================================================
    // 代码块折叠/展开接口
    // ================================================================

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

    // ================================================================
    // 编辑模式
    // ================================================================

    async toggleEdit(): Promise<void> {
        if (!this.editor) return;

        this.isReadOnly = !this.isReadOnly;
        const targetMode = this.isReadOnly ? 'render' : 'edit';
        await this.editor.switchToMode(targetMode);

        if (!this.isReadOnly) {
            this.editor.focus();
        }
    }

    setContent(content: string): void {
        this.currentContent = content;
        this.pendingDelta = '';
        if (this.isInitialized && this.editor) {
            this.editor.setText(content);
        }
    }

    isEditing(): boolean {
        return !this.isReadOnly;
    }

    async setMode(mode: 'edit' | 'render'): Promise<void> {
        if (!this.editor) return;

        const shouldBeReadOnly = mode === 'render';
        if (this.isReadOnly !== shouldBeReadOnly) {
            this.isReadOnly = shouldBeReadOnly;
            await this.editor.switchToMode(mode);
        }
    }

    // ================================================================
    // 兼容旧 API（逐步废弃）
    // ================================================================

    // ================================================================
    // 销毁
    // ================================================================

    destroy(): void {
        this.editor?.destroy();
        this.editor = null;
        this.isInitialized = false;
        this.pendingDelta = '';
        this.currentContent = '';
    }
}
