// @mdx/core/store/memory-store.ts
import type { ScopedPersistenceStore } from './types';

export class MemoryStore implements ScopedPersistenceStore {
    private data = new Map<string, unknown>();

    async get(key: string): Promise<unknown> { return this.data.get(key); }
    async set(key: string, value: unknown): Promise<void> { this.data.set(key, value); }
    async remove(key: string): Promise<void> { this.data.delete(key); }

    destroy(): void { this.data.clear(); }
}
