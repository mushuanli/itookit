// @file llm-ui/components/mdx/MDxController.ts
import { createMDxEditor, MDxEditor } from '@itookit/mdxeditor';
import type { ISessionEngine } from '@itookit/common';

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

    // ✅ 优化：增加节流间隔和批量阈值
    private readonly RENDER_INTERVAL = 300;
    private readonly BATCH_SIZE_THRESHOLD = 800;
    private lastRenderTime: number = 0;
    private rafId: number | null = null;
    private renderScheduled: boolean = false;
    
    // ✅ 新增：批量缓冲
    private contentSnapshot: string = '';
    private pendingContentLength: number = 0;

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
                defaultPluginOptions:{
                    // ✅ 动态控制 defaultCollapsed
                    // 如果是正在输出的流(isStreamingInit=true)，则折叠(true)
                    // 否则(历史记录/编辑)，则展开(false)
                    'codeblock-controls': { 
                        defaultCollapsed: !this.isStreamingInit ,
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

    /**
     * ✅ 优化：追加流式内容
     */
    appendStream(delta: string): void {
        this.isStreaming = true;
        this.currentContent += delta;
        this.pendingContentLength += delta.length;
        
        if (!this.isInitialized || !this.editor) {
            this.pendingChunks.push(delta);
            return;
        }
        
        // 更智能的渲染触发条件
        const now = Date.now();
        const timeSinceLastRender = now - this.lastRenderTime;
        
        // 条件1：累积足够多的内容
        const shouldRenderBySize = this.pendingContentLength >= this.BATCH_SIZE_THRESHOLD;
        
        // 条件2：距离上次渲染超过间隔
        const shouldRenderByTime = timeSinceLastRender >= this.RENDER_INTERVAL;
        
        // 条件3：内容以完整句子结束
        const endsWithSentence = /[.!?。！？\n]$/.test(delta);
        const shouldRenderBySentence = endsWithSentence && timeSinceLastRender >= 100;
        
        if (shouldRenderBySize || shouldRenderByTime || shouldRenderBySentence) {
            this.scheduleRender();
        }
    }

    /**
     * ✅ 优化：智能渲染调度
     */
    private scheduleRender(): void {
        if (this.renderScheduled) return;
        this.renderScheduled = true;

        // 取消之前的 RAF
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
        }

        // 使用 requestIdleCallback 如果可用
        if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(
                () => this.doRender(),
                { timeout: this.RENDER_INTERVAL }
            );
        } else {
            this.rafId = requestAnimationFrame(() => {
                this.rafId = null;
                this.doRender();
            });
        }
    }

    /**
     * ✅ 优化：执行渲染
     */
    private async doRender(): Promise<void> {
        this.renderScheduled = false;
        
        if (!this.editor || !this.isInitialized) return;
        
        // 检查内容是否有变化（避免无谓渲染）
        if (this.currentContent === this.contentSnapshot) return;

        try {
            await this.editor.setStreamingText(this.currentContent);
            
            this.contentSnapshot = this.currentContent;
            this.lastRenderTime = Date.now();
            this.pendingContentLength = 0;
            
        } catch (e) {
            console.error('[MDxController] Render failed:', e);
        }
    }

    /**
     * ✅ 优化：结束流式输出
     */
    finishStream(emitChange: boolean = false): void {
        this.isStreaming = false;
        
        // 取消所有挂起的渲染
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.renderScheduled = false;
        this.pendingContentLength = 0;
        
        // 最终渲染
        if (this.editor && this.isInitialized && this.currentContent !== this.contentSnapshot) {
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
        // 清理定时器
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        
        this.editor?.destroy();
        this.editor = null;
        this.isInitialized = false;
        this.pendingChunks = [];
        this.renderScheduled = false;
        this.pendingContentLength = 0;
    }
}
