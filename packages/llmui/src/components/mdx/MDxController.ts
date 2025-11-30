// @file llm-ui/components/mdx/MDxController.ts
import { createMDxEditor, MDxEditor } from '@itookit/mdxeditor';

export class MDxController {
    private editor: MDxEditor | null = null;
    private container: HTMLElement;
    private currentContent: string = '';
    private isStreaming: boolean = false;
    private isReadOnly: boolean = true;
    private onChangeCallback?: (text: string) => void;
    
    // ✨ 新增：初始化状态和待处理的流式内容缓冲
    private isInitialized: boolean = false;
    private pendingContent: string = '';

    // 🚀 性能优化: 渲染节流 (Throttling)
    private updateScheduled: boolean = false;
    private lastRenderTime: number = 0;
    private readonly RENDER_INTERVAL = 100; // 最小渲染间隔 100ms (10 FPS)，防止 UI 阻塞

    constructor(container: HTMLElement, initialContent: string, options?: { 
        readOnly?: boolean,
        onChange?: (text: string) => void 
    }) {
        this.container = container;
        this.currentContent = initialContent;
        this.isReadOnly = options?.readOnly ?? true;
        this.onChangeCallback = options?.onChange;
        
        console.log('[MDxController] Constructor called, starting init...');
        this.init();
    }

    private async init() {
        console.log('[MDxController] init() started');
        
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
            ]
        }) as MDxEditor;

        this.editor.on('change', () => {
            if (!this.isStreaming) {
                const text = this.editor!.getText();
                this.currentContent = text;
                this.onChangeCallback?.(text);
            }
        });

        this.isInitialized = true;
        console.log('[MDxController] init() completed, isInitialized:', this.isInitialized);

        // 应用缓冲的内容
        if (this.pendingContent) {
            console.log('[MDxController] Applying pending content, length:', this.pendingContent.length);
            this.currentContent += this.pendingContent;
            this.pendingContent = '';
            this.editor.setText(this.currentContent);
        }
    }

    /**
     * 追加流式内容
     * 优化：只做字符串拼接和调度，不直接渲染
     */
    appendStream(delta: string) {
        this.isStreaming = true;
        
        // 1. 快速数据更新
        this.currentContent += delta;
        
        // 2. 状态检查：如果未初始化，只需缓冲，后续 init() 会处理
        if (!this.isInitialized || !this.editor) {
            this.pendingContent += delta;
            return;
        }

        // 3. 调度渲染更新
        this.scheduleUpdate();
    }

    /**
     * 调度更新机制
     * 使用 requestAnimationFrame + 时间间隔判断，实现高性能节流
     */
    private scheduleUpdate() {
        if (this.updateScheduled) return;

        this.updateScheduled = true;

        requestAnimationFrame(() => {
            const now = Date.now();
            const timeSinceLastRender = now - this.lastRenderTime;

            if (timeSinceLastRender >= this.RENDER_INTERVAL) {
                // 时间间隔足够，执行渲染
                this.performRender();
            } else {
                // 时间间隔不够，设置定时器在剩余时间后执行
                // 确保最后一次更新一定会被执行 (Trailing edge)
                setTimeout(() => {
                    this.performRender();
                }, this.RENDER_INTERVAL - timeSinceLastRender);
            }
        });
    }

    /**
     * 执行实际的渲染操作 (Expensive operation)
     */
    private performRender() {
        if (!this.editor) return;

        // 调用 setText，依赖 Editor 的自动渲染逻辑
        this.editor.setText(this.currentContent);
        
        // 重置状态
        this.lastRenderTime = Date.now();
        this.updateScheduled = false;
    }

    /**
     * 流结束处理
     * 强制立即刷新一次，确保所有内容都已上屏
     */
    finishStream() {
        this.isStreaming = false;
        
        if (this.editor) {
            // 处理可能的剩余 pending 内容（虽然理论上初始化后 pending 为空，但为了健壮性）
            if (this.pendingContent) {
                this.currentContent += this.pendingContent;
                this.pendingContent = '';
            }
            // 强制渲染最终结果
            this.editor.setText(this.currentContent);
        }
        
        // 重置调度标志
        this.updateScheduled = false;
        
        // 通知外部内容已变更
        this.onChangeCallback?.(this.currentContent);
        console.log('[MDxController] finishStream completed, final content length:', this.currentContent.length);
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

    get content() {
        return this.currentContent;
    }

    destroy() {
        this.editor?.destroy();
        this.editor = null;
        this.isInitialized = false;
        this.pendingContent = '';
        this.updateScheduled = false;
    }
}
