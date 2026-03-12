// @file: llm-ui/utils/ScrollController.ts

import { TimerManager } from './TimerManager';

export interface ScrollControllerCallbacks {
    onUserScrolledUp?: () => void;
    onUserScrolledDown?: () => void;
    onScroll?: () => void;
}

/**
 * 统一滚动控制器
 *
 * 合并原来分散在 HistoryView、NavigationHelper 中的滚动逻辑：
 * - 自动滚动判断
 * - 流式模式管理
 * - 用户滚动状态跟踪
 * - 内容高度变化响应
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

    // ✅ 新增：流式期间的滚动节流
    private streamingScrollThrottle = false;
    private readonly STREAMING_SCROLL_INTERVAL = 120; // ms

    private readonly SCROLL_THRESHOLD = 150;
    private readonly SCROLL_THROTTLE = 100;

    // ✅ 新增：追踪是否是程序触发的滚动（而非用户手动）
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
        const { scrollTop, scrollHeight, clientHeight } = this.container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        const wasScrolledUp = this._isUserScrolledUp;
        const isNearBottom = distanceFromBottom < this.SCROLL_THRESHOLD;

        // ✅ 关键修复：区分用户滚动和程序滚动
        if (this.isProgrammaticScroll) {
            // 程序触发的滚动：不更新用户状态
            return;
        }

        this._isUserScrolledUp = !isNearBottom;

        // ✅ 关键修复：流式模式下也要响应用户滚动
        if (this._isStreamingMode) {
            if (this._isUserScrolledUp) {
                // 用户主动上滚 → 停止自动滚动
                this.shouldAutoScroll = false;
            } else {
                // 用户滚回底部 → 恢复自动滚动
                this.shouldAutoScroll = true;
            }
        } else {
            if (Date.now() < this.scrollLockUntil) return;
            this.shouldAutoScroll = isNearBottom;
        }

        // 状态变化回调
        if (!wasScrolledUp && this._isUserScrolledUp) {
            this.callbacks.onUserScrolledUp?.();
        } else if (wasScrolledUp && !this._isUserScrolledUp) {
            this.callbacks.onUserScrolledDown?.();
        }

        this.callbacks.onScroll?.();
    };

    // ================================================================
    // 内容高度变化
    // ================================================================

    /**
     * ✅ 优化：流式期间使用更积极的节流
     * 由 StreamRenderPipeline 每帧调用，但实际滚动有最小间隔
     */
    handleContentResize(): void {
        if (!this.shouldAutoScroll) return;

        // 流式期间：使用独立节流，避免与非流式逻辑冲突
        if (this._isStreamingMode) {
            if (this.streamingScrollThrottle) return;
            this.streamingScrollThrottle = true;

            this.timers.setTimeout(() => {
                this.streamingScrollThrottle = false;
            }, this.STREAMING_SCROLL_INTERVAL);

            this.scrollToBottomImmediate();
            return;
        }

        // 非流式期间：保持原有逻辑
        if (this.scrollThrottleTimer !== null) return;

        this.scrollThrottleTimer = this.timers.setTimeout(() => {
            this.scrollThrottleTimer = null;
            if (!this.shouldAutoScroll) return;

            const currentScrollHeight = this.container.scrollHeight;
            if (currentScrollHeight > this.lastScrollHeight) {
                this.lastScrollHeight = currentScrollHeight;
                this.scrollToBottomImmediate();
            }
        }, this.SCROLL_THROTTLE);
    }

    // ================================================================
    // 滚动操作
    // ================================================================

    scrollToBottom(force: boolean = false): void {
        // ✅ 关键修复：非 force 模式下，尊重用户的滚动意图
        if (!force && !this.shouldAutoScroll) return;

        // ✅ force 模式在流式期间也要检查用户状态
        if (force && this._isStreamingMode && this._isUserScrolledUp) {
            // 流式模式下，即使 force 也不应该覆盖用户的上滚
            // 只有非流式场景下的 force（如 session_start 初始定位）才强制滚动
            return;
        }

        if (this.scrollFrameId !== null) {
            cancelAnimationFrame(this.scrollFrameId);
        }

        // ✅ 标记为程序滚动
        this.markProgrammaticScroll();

        this.scrollFrameId = this.timers.requestAnimationFrame(() => {
            this.scrollFrameId = null;
            this.container.scrollTop = this.container.scrollHeight;
            this.lastScrollHeight = this.container.scrollHeight;
            this.scrollLockUntil = Date.now() + 100;
        });
    }

    /**
     * ✅ 新增：强制滚动到底部（不受用户状态限制）
     * 仅在明确的用户操作触发时使用（如点击 "scroll to bottom" 按钮）
     */
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

    private scrollToBottomImmediate(): void {
        if (this.scrollFrameId !== null) return;

        // ✅ 再次检查
        if (!this.shouldAutoScroll) return;

        this.markProgrammaticScroll();

        this.scrollFrameId = this.timers.requestAnimationFrame(() => {
            this.scrollFrameId = null;
            this.container.scrollTop = this.container.scrollHeight;
        });
    }

    /**
     * ✅ 新增：标记接下来的滚动为程序触发
     * 
     * 使用短暂的标记窗口（150ms），在此期间的 scroll 事件
     * 被视为程序触发，不会更新用户滚动状态。
     */
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

        // ✅ 关键修复：只有当用户当前在底部时才启用自动滚动
        // 如果用户进入流式前就在查看历史，不应该强制拉到底部
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
