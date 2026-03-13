// @mdx/core/event-bus.ts
export type EventCallback<T = any> = (payload: T) => void;

/**
 * 类型安全的统一事件总线
 * 消除 MDxEditor.eventEmitter 和 PluginManager.eventBus 的二元性
 */
export class EventBus {
    private listeners = new Map<string, Map<symbol, EventCallback>>();

    // 高频事件批处理
    private pendingEmits = new Map<string, any>();
    private batchScheduled = false;
    private highFrequencyEvents: Set<string>;

    constructor(highFrequencyEvents: string[] = ['change', 'cursorMove']) {
        this.highFrequencyEvents = new Set(highFrequencyEvents);
    }

    on<T = any>(event: string, callback: EventCallback<T>): () => void {
        const id = Symbol(event);
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Map());
        }
        this.listeners.get(event)!.set(id, callback);
        return () => this.listeners.get(event)?.delete(id);
    }

    emit<T = any>(event: string, payload?: T): void {
        const handlers = this.listeners.get(event);
        if (!handlers || handlers.size === 0) return;

        if (this.highFrequencyEvents.has(event)) {
            this.pendingEmits.set(event, payload);
            if (!this.batchScheduled) {
                this.batchScheduled = true;
                queueMicrotask(() => this.flushBatch());
            }
        } else {
            this.dispatch(event, handlers, payload);
        }
    }

    private flushBatch(): void {
        this.batchScheduled = false;
        const batch = new Map(this.pendingEmits);
        this.pendingEmits.clear();

        for (const [event, payload] of batch) {
            const handlers = this.listeners.get(event);
            if (handlers) this.dispatch(event, handlers, payload);
        }
    }

    private dispatch(event: string, handlers: Map<symbol, EventCallback>, payload: any): void {
        for (const cb of handlers.values()) {
            try { cb(payload); }
            catch (err) { console.error(`[EventBus] Error in "${event}":`, err); }
        }
    }

    clear(): void {
        this.listeners.clear();
        this.pendingEmits.clear();
    }
}
