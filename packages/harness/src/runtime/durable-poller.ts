export interface DurablePollerOptions<K> {
    intervalMs: number;
    poll(key: K): Promise<boolean>;
    onError(key: K, error: unknown): boolean;
}

export class DurablePoller<K> {
    private readonly timers = new Map<K, ReturnType<typeof setTimeout>>();
    private disposed = false;

    constructor(private readonly options: DurablePollerOptions<K>) {}

    start(key: K): void {
        if (this.disposed || this.options.intervalMs <= 0 || this.timers.has(key)) return;
        const timer = setTimeout(() => void this.tick(key), this.options.intervalMs);
        unrefTimer(timer);
        this.timers.set(key, timer);
    }

    stop(key: K): void {
        const timer = this.timers.get(key);
        if (timer) clearTimeout(timer);
        this.timers.delete(key);
    }

    dispose(): void {
        this.disposed = true;
        for (const key of this.timers.keys()) this.stop(key);
    }

    private async tick(key: K): Promise<void> {
        this.timers.delete(key);
        try {
            if (await this.options.poll(key)) this.start(key);
        } catch (error) {
            if (this.options.onError(key, error)) this.start(key);
        }
    }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}
