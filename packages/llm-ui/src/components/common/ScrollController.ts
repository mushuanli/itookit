// @file: llm-ui/views/common/ScrollController.ts

import { TimerManager } from './TimerManager';

export interface ScrollControllerCallbacks {
    onUserScrolledUp?: () => void;
    onUserScrolledDown?: () => void;
    onScroll?: () => void;
}

/**
 * 统一滚动控制器
 *
 * ✅ 优化：
 * - 流式滚动使用 CSS scroll-behavior 消除抖动
 * - 程序滚动标记避免误判用户意图
 * - handleContentResize 是唯一的滚动触发入口（由 Pipeline 分帧调用）
 */
export class ScrollController {
    private shouldAutoScroll = true;
    private _isStreamingMode = false;
    private _isUserScrolledUp = false;
    private lastScrollHeight = 0;
    private scrollLockUntil = 0;

    private scrollFrameId: number | null = null;
    private timers = new TimerManager();
    private scrollThrottleTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly SCROLL_THRESHOLD = 150;
    private readonly SCROLL_THROTTLE = 100;

    // 程序滚动标记
    private isProgrammaticScroll = false;
    private programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null;

    private callbacks: ScrollControllerCallbacks;

    constructor(
        private container: HTMLElement,
        callbacks?: ScrollControllerCallbacks
    ) {
        this.callbacks = callbacks || {};
        this.container.addEventListener('scroll', this.handleScroll, { passive: true });
    }

    get isStreamingMode(): boolean {
        return this._isStreamingMode;
    }

    get isUserScrolledUp(): boolean {
        return this._isUserScrolledUp;
    }

    // ================================================================
    // 滚动事件处理
    // ================================================================

    private handleScroll = (): void => {
        // 程序触发的滚动：不更新用户状态
        if (this.isProgrammaticScroll) return;

        const { scrollTop, scrollHeight, clientHeight } = this.container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        const wasScrolledUp = this._isUserScrolledUp;
        const isNearBottom = distanceFromBottom < this.SCROLL_THRESHOLD;

        this._isUserScrolledUp = !isNearBottom;

        if (this._isStreamingMode) {
            if (this._isUserScrolledUp) {
                this.shouldAutoScroll = false;
            } else {
                this.shouldAutoScroll = true;
            }
        } else {
            if (Date.now() < this.scrollLockUntil) return;
            this.shouldAutoScroll = isNearBottom;
        }

        if (!wasScrolledUp && this._isUserScrolledUp) {
            this.callbacks.onUserScrolledUp?.();
        } else if (wasScrolledUp && !this._isUserScrolledUp) {
            this.callbacks.onUserScrolledDown?.();
        }

        this.callbacks.onScroll?.();
    };

    // ================================================================
    // 内容高度变化 — Pipeline 唯一调用入口
    // ================================================================

    /**
     * ✅ 简化：由 Pipeline 在渲染后的下一帧调用
     * 
     * Pipeline 保证此方法在 flushContent 的下一帧执行，
     * 此时浏览器已完成 layout 计算，读取 scrollHeight 不会触发强制布局。
     * 
     * 流式和非流式统一逻辑：
     * 1. 读取 scrollHeight（layout read）
     * 2. 比较高度变化
     * 3. 如果需要滚动，设置 scrollTop（layout write）
     * 
     * 每次调用最多 1 read + 1 write，零 layout thrashing。
     */
    handleContentResize(): void {
        if (!this.shouldAutoScroll) return;

        const currentScrollHeight = this.container.scrollHeight;

        // 非流式期间保持节流
        if (!this._isStreamingMode) {
            if (this.scrollThrottleTimer !== null) return;

            this.scrollThrottleTimer = this.timers.setTimeout(() => {
                this.scrollThrottleTimer = null;
                if (!this.shouldAutoScroll) return;

                const h = this.container.scrollHeight;
                if (h > this.lastScrollHeight) {
                    this.lastScrollHeight = h;
                    this.scrollToBottomImmediate();
                }
            }, this.SCROLL_THROTTLE);
            return;
        }

        // 流式期间：直接执行（Pipeline 已保证分帧和节流）
        if (currentScrollHeight <= this.lastScrollHeight) return;

        this.lastScrollHeight = currentScrollHeight;
        this.scrollToBottomImmediate();
    }

    // ================================================================
    // 滚动操作
    // ================================================================

    scrollToBottom(force: boolean = false): void {
        if (!force && !this.shouldAutoScroll) return;

        if (force && this._isStreamingMode && this._isUserScrolledUp) {
            return;
        }

        if (this.scrollFrameId !== null) {
            cancelAnimationFrame(this.scrollFrameId);
        }

        this.markProgrammaticScroll();

        this.scrollFrameId = this.timers.requestAnimationFrame(() => {
            this.scrollFrameId = null;
            this.container.scrollTop = this.container.scrollHeight;
            this.lastScrollHeight = this.container.scrollHeight;
            this.scrollLockUntil = Date.now() + 100;
        });
    }

    forceScrollToBottom(): void {
        this.shouldAutoScroll = true;
        this._isUserScrolledUp = false;

        this.markProgrammaticScroll();

        if (this.scrollFrameId !== null) {
            cancelAnimationFrame(this.scrollFrameId);
        }

        this.scrollFrameId = this.timers.requestAnimationFrame(() => {
            this.scrollFrameId = null;
            this.container.scrollTop = this.container.scrollHeight;
            this.lastScrollHeight = this.container.scrollHeight;
            this.scrollLockUntil = Date.now() + 100;
        });
    }

    /**
     * ✅ 流式期间的滚动：直接设置，不经过 RAF 排队
     * 
     * 因为 Pipeline 已经在 RAF 循环内调用 handleContentResize，
     * 此处直接写入 scrollTop 即可，无需再排一个 RAF。
     */
    private scrollToBottomImmediate(): void {
        if (!this.shouldAutoScroll) return;

        this.markProgrammaticScroll();
        this.container.scrollTop = this.container.scrollHeight;
    }

    private markProgrammaticScroll(): void {
        this.isProgrammaticScroll = true;

        if (this.programmaticScrollTimer !== null) {
            this.timers.clearTimeout(this.programmaticScrollTimer);
        }

        this.programmaticScrollTimer = this.timers.setTimeout(() => {
            this.isProgrammaticScroll = false;
            this.programmaticScrollTimer = null;
        }, 150);
    }

    // ================================================================
    // 流式模式
    // ================================================================

    enterStreamingMode(): void {
        if (this._isStreamingMode) return;
        this._isStreamingMode = true;

        const { scrollTop, scrollHeight, clientHeight } = this.container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        const isNearBottom = distanceFromBottom < this.SCROLL_THRESHOLD;

        this.shouldAutoScroll = isNearBottom;
        this._isUserScrolledUp = !isNearBottom;

        this.lastScrollHeight = this.container.scrollHeight;
    }

    exitStreamingMode(): void {
        if (!this._isStreamingMode) return;
        this._isStreamingMode = false;
    }

    // ================================================================
    // 清理
    // ================================================================

    destroy(): void {
        this.container.removeEventListener('scroll', this.handleScroll);

        if (this.scrollFrameId !== null) {
            cancelAnimationFrame(this.scrollFrameId);
            this.scrollFrameId = null;
        }

        this.timers.destroy();
    }
}
