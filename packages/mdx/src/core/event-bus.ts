export type EventCallback<T = unknown> = (payload: T) => void;

/** Instance-local events; selected events coalesce within one microtask. */
export class EventBus {
    private listeners = new Map<string, Set<EventCallback<any>>>();
    private pending = new Map<string, unknown>();
    private generation = 0;
    constructor(private readonly coalesce: string[] = ['change', 'cursorMove']) {}

    on<T = unknown>(event: string, callback: EventCallback<T>): () => void {
        const listeners = this.listeners.get(event) ?? new Set();
        this.listeners.set(event, listeners); listeners.add(callback);
        return () => { listeners.delete(callback); };
    }

    emit<T = unknown>(event: string, payload?: T): void {
        if (!this.coalesce.includes(event)) { this.dispatch(event, payload); return; }
        const queued = this.pending.has(event), generation = this.generation;
        this.pending.set(event, payload);
        if (!queued) queueMicrotask(() => {
            if (generation !== this.generation) return;
            const value = this.pending.get(event); this.pending.delete(event);
            this.dispatch(event, value);
        });
    }

    private dispatch(event: string, payload: unknown): void {
        for (const callback of [...this.listeners.get(event) ?? []]) {
            try { callback(payload); } catch (error) { console.error('[mdx event]', error); }
        }
    }
    clear(): void { this.generation++; this.pending.clear(); this.listeners.clear(); }
}
