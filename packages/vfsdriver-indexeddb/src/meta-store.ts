/**
 * @file llmdriver-indexeddb/src/meta-store.ts
 * @desc IMetaStore implementation backed by IndexedDB
 *
 * Object store schema ("meta"):
 *   keyPath: "ino"
 *   indexes:
 *     idx_tags — tags (multiEntry, for queryByTag)
 */

import type { IMetaStore, MetaRecord } from '@itookit/common';
import { req, collectCursor, STORE_META } from './utils';

export class IDBMetaStore implements IMetaStore {
    constructor(private readonly meta: IDBObjectStore) {}

    async putMeta(record: MetaRecord): Promise<void> {
        await req(this.meta.put(record));
    }

    async getMeta(ino: number): Promise<MetaRecord | null> {
        const result = await req<MetaRecord | undefined>(this.meta.get(ino));
        return result ?? null;
    }

    async deleteMeta(ino: number): Promise<void> {
        await req(this.meta.delete(ino));
    }

    async patchMeta(ino: number, partial: Partial<Omit<MetaRecord, 'ino'>>): Promise<void> {
        const current = await req<MetaRecord | undefined>(this.meta.get(ino));
        if (!current) return;
        const updated = { ...current, ...partial };
        await req(this.meta.put(updated));
    }

    async batchGetMeta(inos: number[]): Promise<MetaRecord[]> {
        const results: MetaRecord[] = [];
        for (const ino of inos) {
            const rec = await req<MetaRecord | undefined>(this.meta.get(ino));
            if (rec) results.push(rec);
        }
        return results;
    }

    async queryByTag(tag: string): Promise<number[]> {
        const idx = this.meta.index('idx_tags');
        const records = await collectCursor<MetaRecord>(
            idx.openCursor(IDBKeyRange.only(tag)) as IDBRequest<IDBCursorWithValue | null>,
        );
        return records.map((r) => r.ino);
    }

    async queryByMetadata(field: string, value: unknown): Promise<number[]> {
        // Cursor scan — no dynamic metadata indexes in IDB
        const all = await collectCursor<MetaRecord>(
            this.meta.openCursor() as IDBRequest<IDBCursorWithValue | null>,
        );
        return all
            .filter((r) => r.metadata && (r.metadata as Record<string, unknown>)[field] === value)
            .map((r) => r.ino);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema upgrade helper
// ─────────────────────────────────────────────────────────────────────────────

export function createMetaStore(db: IDBDatabase): void {
    const store = db.createObjectStore(STORE_META, { keyPath: 'ino' });
    store.createIndex('idx_tags', 'tags', { unique: false, multiEntry: true });
}
