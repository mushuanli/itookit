// @file: llm-ui/utils/ContentResizeTracker.ts

import { TimerManager } from './TimerManager';

/**
 * 内容高度变化追踪器
 *
 * 替代直接使用 ResizeObserver，提供：
 * 1. 内置节流（避免 layout thrashing）
 * 2. 流式/非流式模式自适应
 * 3. 避免 ResizeObserver 的 "loop limit exceeded" 警告
 */
export class ContentResizeTracker {
    private resizeObserver: ResizeObserver;
    private pendingCallback = false;
    private lastNotifiedHeight = 0;
    private timers = new TimerManager();
    private rafId: number | null = null;

    private isStreamingMode = false;
    private streamingPollTimer: ReturnType<typeof setInterval> | null = null;
    private readonly STREAMING_POLL_INTERVAL = 80;

    constructor(
        private container: HTMLElement,
        private onResize: (newHeight: number, oldHeight: number) => void
    ) {
        this.lastNotifiedHeight = container.scrollHeight;

        this.resizeObserver = new ResizeObserver(this.handleObserverEntry);
        this.resizeObserver.observe(container);
    }

    private handleObserverEntry = (): void => {
        // 流式模式由 polling 驱动，忽略 ResizeObserver
        if (this.isStreamingMode) return;
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

    enterStreamingMode(): void {
        if (this.isStreamingMode) return;
        this.isStreamingMode = true;

        this.streamingPollTimer = this.timers.setInterval(() => {
            this.checkHeight();
        }, this.STREAMING_POLL_INTERVAL);
    }

    exitStreamingMode(): void {
        if (!this.isStreamingMode) return;
        this.isStreamingMode = false;

        if (this.streamingPollTimer !== null) {
            this.timers.clearInterval(this.streamingPollTimer);
            this.streamingPollTimer = null;
        }

        // 最终检查一次
        this.checkHeight();
    }

    destroy(): void {
        this.resizeObserver.disconnect();
        this.timers.destroy();
    }
}
