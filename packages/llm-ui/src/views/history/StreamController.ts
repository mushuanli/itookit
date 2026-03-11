// @file: llm-ui/views/history/StreamController.ts

import { TimerManager } from '../../base/infrastructure/TimerManager';
import type { SessionRenderer } from './SessionRenderer';

/**
 * 流式输出控制器
 *
 * 职责：
 * 1. 管理流式/非流式模式切换
 * 2. 处理 chunk 追加和 thought 更新
 * 3. 管理 node 状态变更
 * 4. 流式结束时的清理和预览更新
 *
 * 不负责：DOM 创建、事件绑定、折叠
 */
export class StreamController {
    private isStreaming = false;
    private thoughtScrollThrottled = false;
    private previewTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private timers = new TimerManager();

    constructor(
        private container: HTMLElement,
        private renderer: SessionRenderer
    ) { }

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
    }

    exit(): void {
        if (!this.isStreaming) return;
        this.isStreaming = false;
        this.container.classList.remove('llm-ui-history--streaming');

        // 清理流式状态
        this.container.querySelectorAll('.llm-ui-node--streaming').forEach(el => {
            el.classList.remove('llm-ui-node--streaming');
        });

        this.previewTimers.forEach(timer => clearTimeout(timer));
        this.previewTimers.clear();

        // 更新所有预览
        this.renderer.editors.forEach((editor, nodeId) => {
            const el = this.renderer.getNode(nodeId);
            if (el) {
                const previewEl = el.querySelector('.llm-ui-header-preview');
                if (previewEl) {
                    previewEl.textContent = this.renderer.getPreviewText(editor.content);
                }
            }
        });

        // 结束所有编辑器的流式模式
        this.renderer.editors.forEach(editor => editor.finishStream());
    }

    // ================================================================
    // 内容更新
    // ================================================================

    updateContent(nodeId: string, chunk: string, field: 'thought' | 'output'): void {
        const el = this.renderer.getNode(nodeId);
        if (!el) return;

        if (!el.classList.contains('llm-ui-node--streaming')) {
            el.classList.add('llm-ui-node--streaming');
        }

        if (field === 'thought') {
            this.updateThought(el, chunk);
        } else {
            this.updateOutput(nodeId, chunk);
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

            // 清理预览定时器
            const timer = this.previewTimers.get(nodeId);
            if (timer) {
                clearTimeout(timer);
                this.previewTimers.delete(nodeId);
            }

            // 更新最终预览
            const editor = this.renderer.getEditor(nodeId);
            const previewEl = el.querySelector('.llm-ui-header-preview');
            if (editor && previewEl) {
                previewEl.textContent = this.renderer.getPreviewText(editor.content);
            }
        }

        // 结束编辑器流式
        const editor = this.renderer.getEditor(nodeId);
        if (editor && (status === 'success' || status === 'failed')) {
            editor.finishStream(false);
        }
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

    private updateOutput(nodeId: string, chunk: string): void {
        const editor = this.renderer.getEditor(nodeId);
        if (editor) {
            editor.appendStream(chunk);
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
    }

    destroy(): void {
        this.previewTimers.forEach(timer => clearTimeout(timer));
        this.previewTimers.clear();
        this.timers.destroy();
        this.isStreaming = false;
    }
}
