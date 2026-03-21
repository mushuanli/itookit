// @file: llm-ui/views/common/StreamRenderPipeline.ts

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
 * 将 "内容更新 → 高度检查 → 滚动" 合并为单一 RAF 循环，
 * 使用两阶段状态机确保渲染和滚动**永远不在同一帧**。
 *
 * 帧调度模型：
 *
 *   Frame N:   [读旧高度] → [flush DOM] → 标记 phase='rendered'
 *   Frame N+1: [浏览器完成 layout] → [checkAndScroll] → 标记 phase='idle'
 *
 * 这样保证：
 * - 每帧最多一次 layout read + 一次 layout write
 * - 滚动在 DOM 变更的下一帧执行，浏览器已完成 layout 计算
 * - 不需要滚动补偿（消除抖动根源）
 *
 * 设计原则：
 * - Pipeline 只负责时序调度，不知道 DOM 和滚动的具体实现（SRP）
 * - 回调接口最小化：flushContent + checkAndScroll（ISP）
 * - 非流式期间完全静默，零开销
 */
export class StreamRenderPipeline {
    private isActive = false;
    private rafId: number | null = null;
    private timers = new TimerManager();

    // 两阶段状态机
    private phase: 'idle' | 'rendered' = 'idle';

    // 内容渲染节流
    private contentDirty = false;
    private lastContentFlush = 0;
    private readonly CONTENT_INTERVAL = 80; // ms — 降低到 80ms 提升流畅度

    constructor(private callbacks: RenderPipelineCallbacks) { }

    /**
     * 进入流式模式，启动渲染循环
     */
    start(): void {
        if (this.isActive) return;
        this.isActive = true;
        this.phase = 'idle';
        this.contentDirty = false;
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

        // 最终滚动检查
        this.callbacks.checkAndScroll();
        this.phase = 'idle';

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

    /**
     * 两阶段帧执行
     *
     * idle → 检查是否需要渲染 → flush → rendered
     * rendered → 执行滚动（浏览器已完成上一帧的 layout） → idle
     */
    private executeFrame(): void {
        switch (this.phase) {
            case 'idle': {
                if (!this.contentDirty) return;

                const now = Date.now();
                if (now - this.lastContentFlush < this.CONTENT_INTERVAL) return;

                // Phase 1: 执行渲染（DOM mutation）
                this.callbacks.flushContent();
                this.contentDirty = false;
                this.lastContentFlush = now;

                // 标记下一帧需要滚动
                this.phase = 'rendered';
                break;
            }

            case 'rendered': {
                // Phase 2: 下一帧执行滚动
                // 此时浏览器已完成上一帧的 layout 计算
                this.callbacks.checkAndScroll();
                this.phase = 'idle';
                break;
            }
        }
    }

    destroy(): void {
        this.isActive = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.phase = 'idle';
        this.contentDirty = false;
        this.timers.destroy();
    }
}
