// @mdx/core/store/adapter-store.ts
import type { IPersistenceAdapter } from '@itookit/common';
import type { ScopedPersistenceStore } from './types';

export class AdapterStore implements ScopedPersistenceStore {
    constructor(private adapter: IPersistenceAdapter, private prefix: string) { }

    private key(k: string): string { return `${this.prefix}:${k}`; }
    async get(key: string): Promise<any> {
        return this.adapter.getItem(this.key(key));
    }

    async set(key: string, value: any): Promise<void> {
        return this.adapter.setItem(this.key(key), value);
    }

    async remove(key: string): Promise<void> {
        return this.adapter.removeItem(this.key(key));
    }
}
