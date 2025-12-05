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

    private updateScheduled: boolean = false;
    private lastRenderTime: number = 0;
    private readonly RENDER_INTERVAL = 100;

    constructor(container: HTMLElement, initialContent: string, options?: { 
        readOnly?: boolean,
        onChange?: (text: string) => void 
    }) {
        this.container = container;
        this.currentContent = initialContent;
        this.isReadOnly = options?.readOnly ?? true;
        this.onChangeCallback = options?.onChange;
        
        // ✨ [优化] 创建 ready Promise
        this.readyPromise = new Promise((resolve) => {
            this.readyResolve = resolve;
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
                defaultCollapsed:false
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
            this.readyResolve(); // 即使失败也要 resolve，避免永久阻塞
            throw e;
        }
    }

    appendStream(delta: string) {
        this.isStreaming = true;
        this.currentContent += delta;
        
        if (!this.isInitialized || !this.editor) {
            this.pendingChunks.push(delta);
            return;
        }
        this.scheduleUpdate();
    }

    private scheduleUpdate() {
        if (this.updateScheduled) return;
        this.updateScheduled = true;

        requestAnimationFrame(() => {
            const now = Date.now();
            const timeSinceLastRender = now - this.lastRenderTime;

            if (timeSinceLastRender >= this.RENDER_INTERVAL) {
                this.performRender();
            } else {
                const delay = this.RENDER_INTERVAL - timeSinceLastRender;
                setTimeout(() => {
                    this.performRender();
                }, delay);
            }
        });
    }

    /**
     * ✨ [核心修复] 执行实际的渲染操作
     * 改为 async 并等待 editor.setStreamingText 完成
     */
    private async performRender() {
        if (!this.editor) return;

        // 使用 setStreamingText，如果编辑器支持，它会自动串行化渲染任务
        // 防止 CSS 崩坏和 DOM 冲突
        await this.editor.setStreamingText(this.currentContent);

        this.lastRenderTime = Date.now();
        this.updateScheduled = false;
    }

    finishStream() {
        this.isStreaming = false;
        if (this.editor && this.isInitialized) {
            // 确保最后一次内容完全同步
            this.editor.setStreamingText(this.currentContent);
        }
        this.updateScheduled = false;
        this.onChangeCallback?.(this.currentContent);
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

    destroy() {
        this.editor?.destroy();
        this.editor = null;
        this.isInitialized = false;
        this.pendingChunks = [];
        this.updateScheduled = false;
    }
}
