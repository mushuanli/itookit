// @file: llm-ui/utils/EventBatchProcessor.ts

import { OrchestratorEvent } from '@itookit/llm-engine';

export interface BatchedEvents {
    /** 合并后的 chunk 更新（nodeId → 合并内容） */
    chunks: Map<string, { thought: string; output: string }>;
    /** 状态变更（nodeId → 最新状态，后覆盖前） */
    statusChanges: Map<string, { status: string; result?: any }>;
    /** 不可合并的事件（按原始顺序） */
    immediate: OrchestratorEvent[];
}

/**
 * 事件批处理器
 *
 * 功能：
 * 1. 合并连续的 node_update chunk
 * 2. 合并连续的 node_status（取最新）
 * 3. 保证处理顺序：先 chunk → 再 status → 再 immediate
 * 4. 自适应批处理间隔
 * 5. 立即处理不可合并的事件（先 flush 队列保证顺序）
 */
export class EventBatchProcessor {
    private queue: OrchestratorEvent[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;

    // 自适应间隔
    private currentInterval: number;
    private readonly MIN_INTERVAL = 30;
    private readonly MAX_INTERVAL = 150;

    /** 立即处理的事件类型 */
    private static readonly IMMEDIATE_TYPES = new Set([
        'session_start', 'finished', 'error', 'session_cleared',
        'messages_deleted', 'message_edited', 'retry_started',
        'branch_switched', 'branch_created', 'branch_renamed', 'branch_deleted',
        'sibling_switch',
    ]);

    constructor(
        private onFlush: (batched: BatchedEvents) => void,
        private onImmediate: (event: OrchestratorEvent) => void,
        interval: number = 50
    ) {
        this.currentInterval = interval;
    }

    push(event: OrchestratorEvent): void {
        if (EventBatchProcessor.IMMEDIATE_TYPES.has(event.type)) {
            // 先 flush 队列保证顺序
            this.flush();
            this.onImmediate(event);
            return;
        }

        this.queue.push(event);
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.timer !== null) return;

        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush();
        }, this.currentInterval);
    }

    flush(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.queue.length === 0) return;

        const events = this.queue;
        this.queue = [];

        const batched = this.mergeEvents(events);
        this.adjustInterval(events.length);
        this.onFlush(batched);
    }

    private mergeEvents(events: OrchestratorEvent[]): BatchedEvents {
        const result: BatchedEvents = {
            chunks: new Map(),
            statusChanges: new Map(),
            immediate: [],
        };

        for (const event of events) {
            switch (event.type) {
                case 'node_update': {
                    const { nodeId, chunk, field } = event.payload;
                    if (!chunk || !field) continue;

                    if (!result.chunks.has(nodeId)) {
                        result.chunks.set(nodeId, { thought: '', output: '' });
                    }
                    const merged = result.chunks.get(nodeId)!;
                    if (field === 'thought') {
                        merged.thought += chunk;
                    } else if (field === 'output') {
                        merged.output += chunk;
                    }
                    break;
                }

                case 'node_status': {
                    const { nodeId, status, result: statusResult } = event.payload;
                    result.statusChanges.set(nodeId, { status, result: statusResult });
                    break;
                }

                case 'node_start': {
                    // node_start 不可合并，但可以延迟处理
                    result.immediate.push(event);
                    break;
                }

                default:
                    result.immediate.push(event);
                    break;
            }
        }

        return result;
    }

    private adjustInterval(eventCount: number): void {
        if (eventCount > 20) {
            this.currentInterval = Math.min(this.currentInterval * 1.2, this.MAX_INTERVAL);
        } else if (eventCount < 5) {
            this.currentInterval = Math.max(this.currentInterval * 0.8, this.MIN_INTERVAL);
        }
    }

    destroy(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.queue = [];
    }
}
