/**
 * @file llmdriver-indexeddb/src/inode-store.ts
 * @desc IInodeStore implementation backed by IndexedDB
 *
 * Object store schema ("inodes"):
 *   keyPath: "ino"
 *   indexes:
 *     idx_parentIno       — parentIno             (for listChildren)
 *     idx_parentIno_name  — [parentIno, name]     (unique, for lookup)
 *
 * Counter store ("_counters"):
 *   keyPath: "name"
 *   record: { name: "ino", value: number }
 */

import type { IInodeStore, InodeRecord } from '@itookit/common';
import {
    req,
    collectCursor,
    STORE_INODES,
    STORE_COUNTERS,
    COUNTER_INO,
} from './utils';

export class IDBInodeStore implements IInodeStore {
    constructor(
        private readonly inodes: IDBObjectStore,
        private readonly counters: IDBObjectStore,
    ) {}

    async allocateIno(): Promise<number> {
        const record = await req<{ name: string; value: number } | undefined>(
            this.counters.get(COUNTER_INO),
        );
        const next = (record?.value ?? 1) + 1;
        await req(this.counters.put({ name: COUNTER_INO, value: next }));
        return next;
    }

    async putInode(inode: InodeRecord): Promise<void> {
        await req(this.inodes.put(inode));
    }

    async getInode(ino: number): Promise<InodeRecord | null> {
        const result = await req<InodeRecord | undefined>(this.inodes.get(ino));
        return result ?? null;
    }

    async lookup(parentIno: number, name: string): Promise<InodeRecord | null> {
        const idx = this.inodes.index('idx_parentIno_name');
        const result = await req<InodeRecord | undefined>(
            idx.get(IDBKeyRange.only([parentIno, name])),
        );
        return result ?? null;
    }

    async listChildren(parentIno: number): Promise<InodeRecord[]> {
        const idx = this.inodes.index('idx_parentIno');
        return collectCursor<InodeRecord>(
            idx.openCursor(IDBKeyRange.only(parentIno)) as IDBRequest<IDBCursorWithValue | null>,
        );
    }

    async deleteInode(ino: number): Promise<void> {
        await req(this.inodes.delete(ino));
    }

    async updateInode(
        ino: number,
        updates: Partial<Pick<InodeRecord, 'parentIno' | 'name' | 'nlink'>>,
    ): Promise<void> {
        const current = await req<InodeRecord | undefined>(this.inodes.get(ino));
        if (!current) return;
        const updated: InodeRecord = { ...current, ...updates };
        await req(this.inodes.put(updated));
    }

    async batchGetInodes(inos: number[]): Promise<InodeRecord[]> {
        const results: InodeRecord[] = [];
        for (const ino of inos) {
            const rec = await req<InodeRecord | undefined>(this.inodes.get(ino));
            if (rec) results.push(rec);
        }
        return results;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema upgrade helpers (called during IDB onupgradeneeded)
// ─────────────────────────────────────────────────────────────────────────────

export function createInodeStore(db: IDBDatabase): void {
    const store = db.createObjectStore(STORE_INODES, { keyPath: 'ino' });
    store.createIndex('idx_parentIno', 'parentIno', { unique: false });
    store.createIndex('idx_parentIno_name', ['parentIno', 'name'], { unique: false });
}

export function createCounterStore(db: IDBDatabase): void {
    db.createObjectStore(STORE_COUNTERS, { keyPath: 'name' });
}
