// @file llm-ui/components/mdx/MDxController.ts
import { createMDxEditor, MDxEditor } from '@itookit/mdxeditor';
import { IEditor } from '@itookit/common';

export class MDxController {
    // ✨ [修改] 类型定义放宽为 IEditor，以便使用通用接口
    private editor: MDxEditor | null = null;
    private container: HTMLElement;
    private currentContent: string = '';
    private isStreaming: boolean = false;
    private isReadOnly: boolean = true;
    private onChangeCallback?: (text: string) => void;
    
    private isInitialized: boolean = false;
    private pendingChunks: string[] = [];
    private readyPromise: Promise<void>;
    private readyResolve!: () => void;
    // ✨ [修复 6.1] 添加 reject 函数
    private readyReject!: (reason: any) => void;

    // ✅ 优化：增加节流间隔
    private readonly RENDER_INTERVAL = 150;
    private lastRenderTime: number = 0;
    private rafId: number | null = null;
    private renderScheduled: boolean = false;
    
    // ✅ 新增：批量缓冲
    private contentSnapshot: string = '';
    private snapshotTime: number = 0;

    constructor(container: HTMLElement, initialContent: string, options?: { 
        readOnly?: boolean,
        onChange?: (text: string) => void 
    }) {
        this.container = container;
        this.currentContent = initialContent;
        this.isReadOnly = options?.readOnly ?? true;
        this.onChangeCallback = options?.onChange;
        
        // ✨ [修复 6.1] 同时创建 resolve 和 reject
        this.readyPromise = new Promise((resolve, reject) => {
            this.readyResolve = resolve;
            this.readyReject = reject;
        });
        
        console.log('[MDxController] Constructor called, starting init...');
        this.init();
    }

    /**
     * ✨ [新增] 等待初始化完成
     */
    async waitUntilReady(): Promise<void> {
        return this.readyPromise;
    }

    private async init() {
        console.log('[MDxController] init() started');
        
        try {
            this.editor = await createMDxEditor(this.container, {
                initialContent: this.currentContent,
                initialMode: this.isReadOnly ? 'render' : 'edit',
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
                defaultCollapsed: false
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
        
        if (!this.isInitialized || !this.editor) {
            this.pendingChunks.push(delta);
            return;
        }
        
        this.scheduleRender();
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

        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            
            const now = Date.now();
            const elapsed = now - this.lastRenderTime;

            if (elapsed >= this.RENDER_INTERVAL) {
                this.doRender();
            } else {
                // 延迟到下一个间隔点
                const delay = this.RENDER_INTERVAL - elapsed;
                setTimeout(() => this.doRender(), delay);
            }
        });
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
            // 提示浏览器优化渲染
            this.container.style.contain = 'content';
            
            await this.editor.setStreamingText(this.currentContent);
            
            this.contentSnapshot = this.currentContent;
            this.lastRenderTime = Date.now();
            
        } catch (e) {
            console.error('[MDxController] Render failed:', e);
        } finally {
            // 恢复默认
            this.container.style.contain = '';
        }
    }

    /**
     * ✅ 优化：结束流式输出
     */
    finishStream(emitChange: boolean = false): void {
        this.isStreaming = false;
        
        // 取消挂起的渲染
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.renderScheduled = false;
        
        // 最终渲染（同步）
        if (this.editor && this.isInitialized) {
            this.editor.setStreamingText(this.currentContent).catch(console.error);
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
    }
}
