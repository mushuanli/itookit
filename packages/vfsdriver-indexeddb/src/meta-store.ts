/**
 * @file llmdriver-indexeddb/src/meta-store.ts
 * @desc IMetaStore implementation backed by IndexedDB
 *
 * Object store schema ("meta"):
 *   keyPath: "ino"
 *   indexes:
 *     idx_tags — tags (multiEntry, for queryByTag)
 */

import type { IMetaStore, MetaRecord, MetaWalkOptions } from '@itookit/common';
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

    async forEachMeta(
        inos: number[],
        callback: (meta: MetaRecord, index: number) => boolean | Promise<boolean>,
    ): Promise<void> {
        for (let i = 0; i < inos.length; i++) {
            const rec = await req<MetaRecord | undefined>(this.meta.get(inos[i]));
            if (rec) {
                if (!(await callback(rec, i))) break;
            }
        }
    }

    async walkByTag(
        tag: string,
        callback: (ino: number) => boolean | Promise<boolean>,
        options?: MetaWalkOptions,
    ): Promise<{ total: number; processed: number }> {
        const idx = this.meta.index('idx_tags');
        const records = await collectCursor<MetaRecord>(
            idx.openCursor(IDBKeyRange.only(tag)) as IDBRequest<IDBCursorWithValue | null>,
        );
        const total = records.length;
        let processed = 0;
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? Infinity;
        for (let i = offset; i < records.length && processed < limit; i++) {
            if (!(await callback(records[i].ino))) break;
            processed++;
        }
        return { total, processed };
    }

    async walkByMetadata(
        field: string,
        value: unknown,
        callback: (ino: number) => boolean | Promise<boolean>,
        options?: MetaWalkOptions,
    ): Promise<{ total: number; processed: number }> {
        const all = await collectCursor<MetaRecord>(
            this.meta.openCursor() as IDBRequest<IDBCursorWithValue | null>,
        );
        const filtered = all.filter(r => r.metadata && (r.metadata as Record<string, unknown>)[field] === value);
        const total = filtered.length;
        let processed = 0;
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? Infinity;
        for (let i = offset; i < filtered.length && processed < limit; i++) {
            if (!(await callback(filtered[i].ino))) break;
            processed++;
        }
        return { total, processed };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema upgrade helper
// ─────────────────────────────────────────────────────────────────────────────

export function createMetaStore(db: IDBDatabase): void {
    const store = db.createObjectStore(STORE_META, { keyPath: 'ino' });
    store.createIndex('idx_tags', 'tags', { unique: false, multiEntry: true });
}
