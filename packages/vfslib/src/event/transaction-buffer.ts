/**
 * @file packages/vfslib/src/event/transaction-buffer.ts
 * @desc 事务事件缓冲器
 *
 * 事务执行期间收集事件，commit 后合并同类型事件一次性触发。
 * rollback 时丢弃所有缓冲事件。
 */

import type { FSEventType, FSEventPayloadMap } from '@itookit/common';
import type { EventBus } from './event-bus';

interface BufferedEvent {
    type: FSEventType;
    payload: unknown;
    moduleId?: string;
    mountId?: string;
}

export class TransactionEventBuffer {
    private readonly buffer: BufferedEvent[] = [];
    private settled = false;

    constructor(
        private readonly bus: EventBus,
        private readonly moduleId?: string,
    ) {}

    add<E extends FSEventType>(
        type: E,
        payload: E extends keyof FSEventPayloadMap ? FSEventPayloadMap[E] : unknown,
        mountId?: string,
    ): void {
        if (this.settled) return;
        this.buffer.push({ type, payload, moduleId: this.moduleId, mountId });
    }

    commit(): void {
        if (this.settled) return;
        this.settled = true;

        for (const evt of this.buffer) {
            this.bus.emit(evt.type, evt.payload as any, {
                moduleId: evt.moduleId,
                fromTransaction: true,
                mountId: evt.mountId,
            });
        }
        this.buffer.length = 0;
    }

    rollback(): void {
        this.settled = true;
        this.buffer.length = 0;
    }
}
