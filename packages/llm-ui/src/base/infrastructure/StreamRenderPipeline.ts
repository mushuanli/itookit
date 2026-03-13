// @file: llm-ui/infrastructure/StreamRenderPipeline.ts

import { TimerManager } from './TimerManager';

export interface RenderPipelineCallbacks {
    /** 执行内容渲染（批量 flush 所有 pending chunks） */
    flushContent: () => void;
    /** 检查高度并决定是否滚动 */
    checkAndScroll: () => void;
}

/**
 * 流式渲染管线
 *
 * 将 "内容更新 → 高度检查 → 滚动" 合并为单一 RAF 循环。
 * 流式期间替代 ContentResizeTracker 的 polling 和 ScrollController 的独立 RAF。
 *
 * 设计原则：
 * - 每帧最多一次 layout read (scrollHeight) + 一次 layout write (scrollTop)
 * - 内容更新频率独立控制，不受帧率限制
 * - 非流式期间完全静默
 */
export class StreamRenderPipeline {
    private isActive = false;
    private rafId: number | null = null;
    private timers = new TimerManager();
    private dirty = false;
    private scrollPending = false; // ✅ 添加属性声明

    // 内容渲染节流
    private contentDirty = false;
    private lastContentFlush = 0;
    private readonly CONTENT_INTERVAL = 250; // ms

    constructor(private callbacks: RenderPipelineCallbacks) { }

    /**
     * 进入流式模式，启动渲染循环
     */
    start(): void {
        if (this.isActive) return;
        this.isActive = true;
        this.scheduleFrame();
    }

    /**
     * 退出流式模式，执行最终渲染后停止
     */
    stop(): void {
        if (!this.isActive) return;
        this.isActive = false;

        // 最终 flush：确保所有 pending 内容都渲染
        if (this.contentDirty) {
            this.callbacks.flushContent();
            this.contentDirty = false;
        }

        this.callbacks.checkAndScroll();
        this.scrollPending = false; // ✅ 停止时清理

        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    /**
     * 标记有新内容到达（由 StreamController 调用）
     */
    markContentDirty(): void {
        this.contentDirty = true;
        this.dirty = true;
    }

    /**
     * 标记需要滚动检查（由外部高度变化触发）
     */
    markScrollDirty(): void {
        this.dirty = true;
    }

    private scheduleFrame(): void {
        if (this.rafId !== null || !this.isActive) return;

        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            if (!this.isActive) return;

            this.executeFrame();
            this.scheduleFrame(); // 持续循环
        });
    }

    private executeFrame(): void {
        // Phase 1: 内容渲染（有节流）
        if (this.contentDirty) {
            const now = Date.now();
            if (now - this.lastContentFlush >= this.CONTENT_INTERVAL) {
                this.callbacks.flushContent();
                this.contentDirty = false;
                this.lastContentFlush = now;
                // ✅ 渲染后不立即滚动，标记下一帧滚动
                this.scrollPending = true;
                return;
            }
        }

        // 滚动在渲染的下一帧执行
        if (this.scrollPending || this.dirty) {
            this.scrollPending = false;
            this.dirty = false;
            this.callbacks.checkAndScroll();
        }
    }

    destroy(): void {
        this.isActive = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.scrollPending = false; // ✅ 销毁时清理
        this.timers.destroy();
    }
}
