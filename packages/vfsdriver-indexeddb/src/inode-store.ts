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

import type { IInodeStore, InodeRecord, InodeWalkOptions } from '@itookit/common';
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

    private async _listChildrenInternal(parentIno: number): Promise<InodeRecord[]> {
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

    async forEachInode(
        inos: number[],
        callback: (inode: InodeRecord, index: number) => boolean | Promise<boolean>,
    ): Promise<void> {
        for (let i = 0; i < inos.length; i++) {
            const rec = await req<InodeRecord | undefined>(this.inodes.get(inos[i]));
            if (rec) {
                if (!(await callback(rec, i))) break;
            }
        }
    }

    async walkTree(
        parentIno: number,
        callback: (inode: InodeRecord, depth: number) => boolean | 'skip' | Promise<boolean | 'skip'>,
        options?: InodeWalkOptions,
    ): Promise<void> {
        if (options?.order === 'breadth-first') {
            await this._walkBFS(parentIno, callback, options?.maxDepth ?? -1);
        } else {
            await this._walkDFS(parentIno, callback, 0, options?.maxDepth ?? -1);
        }
    }

    private async _walkDFS(
        parentIno: number,
        callback: (inode: InodeRecord, depth: number) => boolean | 'skip' | Promise<boolean | 'skip'>,
        depth: number,
        maxDepth: number,
    ): Promise<boolean> {
        const children = await this._listChildrenInternal(parentIno);
        for (const child of children) {
            const result = await callback(child, depth);
            if (result === false) return false;
            if (result !== 'skip' && child.type === 'directory' && (maxDepth < 0 || depth < maxDepth)) {
                if (!(await this._walkDFS(child.ino, callback, depth + 1, maxDepth))) return false;
            }
        }
        return true;
    }

    private async _walkBFS(
        parentIno: number,
        callback: (inode: InodeRecord, depth: number) => boolean | 'skip' | Promise<boolean | 'skip'>,
        maxDepth: number,
    ): Promise<void> {
        const queue: Array<{ ino: number; depth: number }> = [{ ino: parentIno, depth: -1 }];
        while (queue.length > 0) {
            const { ino, depth } = queue.shift()!;
            const nextDepth = depth + 1;
            if (maxDepth >= 0 && nextDepth > maxDepth) continue;
            const children = await this._listChildrenInternal(ino);
            for (const child of children) {
                const result = await callback(child, nextDepth);
                if (result === false) return;
                if (result !== 'skip' && child.type === 'directory' && (maxDepth < 0 || nextDepth < maxDepth)) {
                    queue.push({ ino: child.ino, depth: nextDepth });
                }
            }
        }
    }

    async hasChildren(parentIno: number): Promise<boolean> {
        const idx = this.inodes.index('idx_parentIno');
        const count = await req(idx.count(IDBKeyRange.only(parentIno)));
        return count > 0;
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
