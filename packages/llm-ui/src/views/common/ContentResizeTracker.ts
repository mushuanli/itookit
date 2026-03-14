// @file: llm-ui/views/common/ContentResizeTracker.ts

import { TimerManager } from './TimerManager';

/**
 * 内容高度变化追踪器
 *
 * ✅ 简化：移除流式 polling 逻辑
 * 流式期间由 StreamRenderPipeline 接管高度检查，
 * 此类仅负责非流式期间的 ResizeObserver 监听。
 */
export class ContentResizeTracker {
    private resizeObserver: ResizeObserver;
    private pendingCallback = false;
    private lastNotifiedHeight = 0;
    private timers = new TimerManager();
    private rafId: number | null = null;

    constructor(
        private container: HTMLElement,
        private onResize: (newHeight: number, oldHeight: number) => void
    ) {
        this.lastNotifiedHeight = container.scrollHeight;

        this.resizeObserver = new ResizeObserver(this.handleObserverEntry);
        this.resizeObserver.observe(container);
    }

    private handleObserverEntry = (): void => {
        if (this.pendingCallback) return;

        this.pendingCallback = true;
        this.scheduleCheck();
    };

    private scheduleCheck(): void {
        if (this.rafId !== null) return;

        this.rafId = this.timers.requestAnimationFrame(() => {
            this.rafId = null;
            this.pendingCallback = false;
            this.checkHeight();
        });
    }

    private checkHeight(): void {
        const currentHeight = this.container.scrollHeight;
        if (currentHeight !== this.lastNotifiedHeight) {
            const oldHeight = this.lastNotifiedHeight;
            this.lastNotifiedHeight = currentHeight;
            this.onResize(currentHeight, oldHeight);
        }
    }

    // ✅ 删除：enterStreamingMode(), exitStreamingMode()
    // 不再需要，流式期间由 Pipeline 接管

    destroy(): void {
        this.resizeObserver.disconnect();
        this.timers.destroy();
    }
}
