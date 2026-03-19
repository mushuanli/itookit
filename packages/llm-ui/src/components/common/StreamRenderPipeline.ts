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
 * 将 "内容更新 → 高度检查 → 滚动" 合并为单一 RAF 循环。
 * 流式期间替代 ContentResizeTracker 的 polling 和 ScrollController 的独立 RAF。
 *
 * ✅ 优化：两阶段状态机
 * 
 * 抖动的核心原因是渲染（DOM mutation）和滚动（scrollTop 读写）
 * 在同一帧内交替执行，导致 layout thrashing。
 * 
 * 状态机保证：
 * - 'idle' → 执行渲染 → 进入 'rendered'
 * - 'rendered' → 下一帧执行滚动 → 回到 'idle'
 * - 渲染和滚动永远不在同一帧
 * 
 * 参考：VS Code Terminal 的渲染管线设计
 *   - 内容变更批量收集
 *   - 渲染帧和滚动帧严格分离
 *   - 每帧最多一次 layout read + 一次 layout write
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

    /**
     * 内容渲染最小间隔（ms）
     * 
     * 80ms ≈ 12.5 fps 的内容更新频率：
     * - 比 250ms 流畅得多（用户感知到连续输出而非跳跃）
     * - 比 16ms (60fps) 更节省资源（markdown 渲染成本较高）
     * - 与人眼对文本变化的感知阈值匹配（~100ms）
     */
    private readonly CONTENT_INTERVAL = 80;

    constructor(private callbacks: RenderPipelineCallbacks) { }

    /**
     * 进入流式模式，启动渲染循环
     */
    start(): void {
        if (this.isActive) return;
        this.isActive = true;
        this.phase = 'idle';
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

    /**
     * 标记需要滚动检查（由外部高度变化触发）
     */
    markScrollDirty(): void {
        // 如果当前在 idle 且没有 content dirty，
        // 直接标记为 rendered 状态让下一帧执行滚动
        if (this.phase === 'idle' && !this.contentDirty) {
            this.phase = 'rendered';
        }
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
     * 两阶段帧执行：
     *
     * Frame N (idle → rendered):
     *   1. 检查内容节流时间
     *   2. 执行 flushContent()（DOM mutation）
     *   3. 切换到 rendered 状态
     *
     * Frame N+1 (rendered → idle):
     *   1. 执行 checkAndScroll()（layout read + scroll write）
     *   2. 切换回 idle 状态
     *
     * 关键：渲染和滚动永远不在同一帧，避免 layout thrashing
     */
    private executeFrame(): void {
        switch (this.phase) {
            case 'idle': {
                if (!this.contentDirty) return;

                const now = Date.now();
                if (now - this.lastContentFlush < this.CONTENT_INTERVAL) return;

                // Phase 1: 执行渲染（layout write via DOM mutation）
                this.callbacks.flushContent();
                this.contentDirty = false;
                this.lastContentFlush = now;

                // 标记下一帧需要滚动
                this.phase = 'rendered';
                break;
            }

            case 'rendered': {
                // Phase 2: 下一帧执行滚动（layout read + write）
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
        this.timers.destroy();
    }
}
