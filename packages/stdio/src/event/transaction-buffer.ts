/**
 * @file packages/vfslib/src/event/transaction-buffer.ts
 * @desc 事务事件缓冲器
 *
 * 事务执行期间收集事件，commit 后合并同类型事件一次性触发。
 * rollback 时丢弃所有缓冲事件。
 */

import type { FSEventType, FSEventPayloadMap } from '../protocol';
import type { FSEventBus } from './event-bus';

interface BufferedEvent {
    dispatch(): void;
}

export class TransactionEventBuffer {
    private readonly buffer: BufferedEvent[] = [];
    private settled = false;

    constructor(
        private readonly bus: FSEventBus,
        private readonly moduleId?: string,
    ) {}

    add<E extends FSEventType>(
        type: E,
        payload: FSEventPayloadMap[E],
        mountId?: string,
    ): void {
        if (this.settled) return;
        this.buffer.push({
            dispatch: () => this.bus.emit(type, payload, {
                moduleId: this.moduleId,
                fromTransaction: true,
                mountId,
            }),
        });
    }

    commit(): void {
        if (this.settled) return;
        this.settled = true;

        this.buffer.forEach(event => event.dispatch());
        this.buffer.length = 0;
    }

    rollback(): void {
        this.settled = true;
        this.buffer.length = 0;
    }
}
