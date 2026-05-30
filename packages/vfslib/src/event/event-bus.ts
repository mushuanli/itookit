/**
 * @file packages/vfslib/src/event/event-bus.ts
 * @desc 类型安全事件总线
 */

import type { FSEventType, FSEvent, FSEventPayloadMap } from '@itookit/common';
import { busDEBUG } from '../utils/debug';

type Handler<E extends FSEventType = FSEventType> = (event: FSEvent<E>) => void;

export class EventBus {
    private readonly handlers = new Map<string, Set<Handler<any>>>();
    private readonly anyHandlers = new Set<Handler>();

    on<E extends FSEventType>(event: E, callback: Handler<E>): () => void {
        let set = this.handlers.get(event);
        if (!set) {
            set = new Set();
            this.handlers.set(event, set);
        }
        set.add(callback);
        busDEBUG.on(event, set.size);
        return () => { set!.delete(callback); };
    }

    onAny(callback: Handler): () => void {
        this.anyHandlers.add(callback);
        return () => { this.anyHandlers.delete(callback); };
    }

    emit<E extends FSEventType>(
        type: E,
        payload: E extends keyof FSEventPayloadMap ? FSEventPayloadMap[E] : unknown,
        extra?: { moduleId?: string; fromTransaction?: boolean; mountId?: string },
    ): void {
        const event: FSEvent<E> = {
            type,
            payload,
            timestamp: Date.now(),
            moduleId: extra?.moduleId,
            fromTransaction: extra?.fromTransaction,
            mountId: extra?.mountId,
        };

        const set = this.handlers.get(type);
        busDEBUG.emit(type, (set?.size ?? 0) + this.anyHandlers.size, {
            moduleId: extra?.moduleId,
            fromTransaction: extra?.fromTransaction,
        });
        // Copy before iterating: handlers may subscribe/unsubscribe in callback
        if (set) {
            for (const h of [...set]) {
                try { h(event); } catch { /* swallow */ }
            }
        }

        for (const h of [...this.anyHandlers]) {
            try { h(event as FSEvent); } catch { /* swallow */ }
        }
    }

    removeAll(): void {
        this.handlers.clear();
        this.anyHandlers.clear();
    }

    removeAllListeners(): void {
        this.removeAll();
    }
}

export class TransactionEventBuffer {
    private readonly buffer: Array<{
        type: FSEventType;
        payload: unknown;
        moduleId?: string;
        mountId?: string;
    }> = [];
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
