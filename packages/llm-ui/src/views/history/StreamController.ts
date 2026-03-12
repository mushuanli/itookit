// @file: llm-ui/views/history/StreamController.ts

import { TimerManager, StreamRenderPipeline, ScrollController } from '../../base/infrastructure/';
import type { SessionRenderer } from './SessionRenderer';
import { getPreviewText } from '../../utils/textUtils';

/**
 * 流式输出控制器
 *
 * 职责：
 * 1. 管理流式/非流式模式切换
 * 2. 收集 chunk 并标记脏区
 * 3. 通过 Pipeline 统一调度渲染和滚动
 * 4. 管理 node 状态变更
 *
 * ✅ 优化：不再独立调度渲染，由 StreamRenderPipeline 协调
 */
export class StreamController {
    private isStreaming = false;
    private thoughtScrollThrottled = false;
    private previewTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private timers = new TimerManager();

    // ✅ 新增：统一渲染管线
    private pipeline: StreamRenderPipeline;

    // ✅ 新增：追踪哪些节点有 pending 内容
    private dirtyNodes = new Set<string>();

    constructor(
        private container: HTMLElement,
        private renderer: SessionRenderer,
        private scrollController: ScrollController
    ) {
        this.pipeline = new StreamRenderPipeline({
            flushContent: () => this.flushAllContent(),
            checkAndScroll: () => this.checkAndScroll(),
        });
    }

    get isStreamingMode(): boolean {
        return this.isStreaming;
    }

    // ================================================================
    // 模式切换
    // ================================================================

    enter(): void {
        if (this.isStreaming) return;
        this.isStreaming = true;
        this.container.classList.add('llm-ui-history--streaming');
        this.pipeline.start();
    }

    exit(): void {
        if (!this.isStreaming) return;
        this.isStreaming = false;
        this.container.classList.remove('llm-ui-history--streaming');

        // 停止管线（内部会执行最终 flush）
        this.pipeline.stop();

        // 清理流式 CSS 状态
        this.container.querySelectorAll('.llm-ui-node--streaming').forEach(el => {
            el.classList.remove('llm-ui-node--streaming');
        });

        this.previewTimers.forEach(timer => clearTimeout(timer));
        this.previewTimers.clear();
        this.dirtyNodes.clear();

        // 更新所有预览文本
        this.renderer.editors.forEach((editor, nodeId) => {
            this.updatePreview(nodeId, editor.content);
        });

        // 结束所有编辑器的流式模式
        this.renderer.editors.forEach(editor => editor.finishStream());
    }

    // ================================================================
    // 内容更新 — 只积累，不渲染
    // ================================================================

    updateContent(nodeId: string, chunk: string, field: 'thought' | 'output'): void {
        const el = this.renderer.getNode(nodeId);
        if (!el) return;

        if (!el.classList.contains('llm-ui-node--streaming')) {
            el.classList.add('llm-ui-node--streaming');
        }

        if (field === 'thought') {
            // thought 是纯文本追加，成本低，直接更新
            this.updateThought(el, chunk);
        } else {
            // output 通过 MDxController 积累，由 Pipeline 统一渲染
            const editor = this.renderer.getEditor(nodeId);
            if (editor) {
                editor.appendStream(chunk);
                this.dirtyNodes.add(nodeId);
                this.pipeline.markContentDirty();
            }
        }
    }

    updateStatus(nodeId: string, status: string, result?: any): void {
        const el = this.renderer.getNode(nodeId);
        if (el) {
            el.classList.remove('llm-ui-node--streaming');
            el.dataset.status = status;
            el.classList.remove(
                'llm-ui-node--running', 'llm-ui-node--success', 'llm-ui-node--failed'
            );
            el.classList.add(`llm-ui-node--${status}`);

            const statusText = el.querySelector('.llm-ui-node__status');
            if (statusText) {
                statusText.textContent = status;
                statusText.className = `llm-ui-node__status llm-ui-node__status--${status}`;
            }

            // tool 结果
            if (result && el.classList.contains('llm-ui-node--tool')) {
                const resEl = el.querySelector('.llm-ui-node__result') as HTMLElement;
                if (resEl) {
                    resEl.style.display = 'block';
                    resEl.textContent = typeof result === 'string'
                        ? result : JSON.stringify(result);
                }
            }

            // 更新最终预览
            const editor = this.renderer.getEditor(nodeId);
            if (editor) {
                this.updatePreview(nodeId, editor.content);
            }

            // 清理
            this.previewTimers.get(nodeId) && clearTimeout(this.previewTimers.get(nodeId)!);
            this.previewTimers.delete(nodeId);
            this.dirtyNodes.delete(nodeId);
        }

        // 结束编辑器流式
        const editor = this.renderer.getEditor(nodeId);
        if (editor && (status === 'success' || status === 'failed')) {
            editor.finishStream(false);
        }
    }

    // ================================================================
    // Pipeline 回调
    // ================================================================

    /**
     * ✅ 由 Pipeline 调用：批量 flush 所有 dirty 节点的内容
     * 
     * 一帧内只执行一次，将所有积累的 chunk 推送给编辑器
     */
    private flushAllContent(): void {
        for (const nodeId of this.dirtyNodes) {
            const editor = this.renderer.getEditor(nodeId);
            if (editor?.hasPendingRender()) {
                editor.flushStream();
            }
        }
        // 不清除 dirtyNodes：下次有新 chunk 时会继续标记
    }

    /**
     * ✅ 由 Pipeline 调用：检查高度变化并决定是否滚动
     * 
     * 合并了 ContentResizeTracker 和 ScrollController 的功能
     * 每帧最多：一次 scrollHeight 读取 + 一次 scrollTop 写入
     */
    private checkAndScroll(): void {
        this.scrollController.handleContentResize();
    }

    // ================================================================
    // 内部方法
    // ================================================================

    private updateThought(el: HTMLElement, chunk: string): void {
        const thoughtContainer = el.querySelector('.llm-ui-thought') as HTMLElement;
        const contentEl = el.querySelector('.llm-ui-thought__content') as HTMLElement;

        if (thoughtContainer && thoughtContainer.style.display === 'none') {
            thoughtContainer.style.display = 'block';
        }

        if (contentEl) {
            contentEl.textContent = (contentEl.textContent || '') + chunk;

            if (!this.thoughtScrollThrottled) {
                this.thoughtScrollThrottled = true;
                this.timers.requestAnimationFrame(() => {
                    this.thoughtScrollThrottled = false;
                    if (thoughtContainer) {
                        thoughtContainer.scrollTop = thoughtContainer.scrollHeight;
                    }
                });
            }
        }
    }

    private updatePreview(nodeId: string, content: string): void {
        const el = this.renderer.getNode(nodeId);
        if (!el) return;
        const previewEl = el.querySelector('.llm-ui-header-preview');
        if (previewEl) {
            previewEl.textContent = getPreviewText(content);
        }
    }

    // ================================================================
    // 清理
    // ================================================================

    cleanupNode(nodeId: string): void {
        const timer = this.previewTimers.get(nodeId);
        if (timer) {
            clearTimeout(timer);
            this.previewTimers.delete(nodeId);
        }
        this.dirtyNodes.delete(nodeId);
    }

    destroy(): void {
        this.pipeline.destroy();
        this.previewTimers.forEach(timer => clearTimeout(timer));
        this.previewTimers.clear();
        this.dirtyNodes.clear();
        this.timers.destroy();
        this.isStreaming = false;
    }
}
