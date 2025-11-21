/**
 * @file vfs-ui/core/Coordinator.ts
 */
type Listener = (event: { channel: string; data: any; timestamp: number }) => void;

export class Coordinator {
    private channels = new Map<string, Set<Listener>>();

    public publish(channel: string, data: any): void {
        const listeners = this.channels.get(channel);
        if (!listeners) return;
        const event = { channel, data, timestamp: Date.now() };
        listeners.forEach(listener => {
            try { listener(event); } catch (e) { console.error(e); }
        });
    }

    public subscribe(channel: string, listener: Listener): () => void {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }
        const listeners = this.channels.get(channel)!;
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) this.channels.delete(channel);
        };
    }

    public clearAll(): void {
        this.channels.clear();
    }
}
