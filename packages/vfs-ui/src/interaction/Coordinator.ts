/**
 * @file vfs-ui/core/Coordinator.ts
 */
type Event = { channel: string; data: any; timestamp: number };
type Listener = (event: Event) => void;

export class Coordinator {
    private channels = new Map<string, Set<Listener>>();

    publish(channel: string, data: any): void {
        this.channels.get(channel)?.forEach(listener => {
            try { listener({ channel, data, timestamp: Date.now() }); } 
            catch (e) { console.error(e); }
        });
    }

    subscribe(channel: string, listener: Listener): () => void {
        if (!this.channels.has(channel)) this.channels.set(channel, new Set());
        this.channels.get(channel)!.add(listener);
        return () => {
            const listeners = this.channels.get(channel);
            listeners?.delete(listener);
            if (!listeners?.size) this.channels.delete(channel);
        };
    }

    clearAll = () => this.channels.clear();
}
