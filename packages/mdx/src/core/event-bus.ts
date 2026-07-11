// @file: mdx/core/event-bus.ts
// Thin wrapper around the shared EventBus from @itookit/common.
// Preserves the existing public API (on/emit/clear) used by PluginManager and MDxEditor.

import { EventBus as CoreEventBus } from '@itookit/common';

export type EventCallback<T = any> = (payload: T) => void;

export class EventBus {
    private bus: CoreEventBus<Record<string, any>>;

    /**
     * @param coalesce - event names to coalesce via queueMicrotask (overwrite semantics).
     *   Defaults to ['change', 'cursorMove'].
     */
    constructor(coalesce: string[] = ['change', 'cursorMove']) {
        this.bus = new CoreEventBus<Record<string, any>>({ coalesce });
    }

    on<T = any>(event: string, callback: EventCallback<T>): () => void {
        return this.bus.on(event, (payload) => callback(payload));
    }

    emit<T = any>(event: string, payload?: T): void {
        this.bus.emit(event, payload as any);
    }

    clear(): void {
        this.bus.clear();
    }
}
