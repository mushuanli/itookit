/**
 * @file packages/vfslib/src/backend/memory-backend.ts
 * @desc 内存存储后端 — 用于测试和临时存储
 *
 * 完整实现 IStorageBackend 三层接口。
 * 所有数据存储在 Map 中，进程结束后丢失。
 */

import type {
    IStorageBackend,
    ITransactionScope,
    IInodeStore,
    IMetaStore,
    IContentStore,
    InodeRecord,
    MetaRecord,
} from '@itookit/common';

class MemoryInodeStore implements IInodeStore {
    private readonly data = new Map<number, InodeRecord>();
    private nextIno = 2; // 1 is reserved for root

    async allocateIno(): Promise<number> {
        return this.nextIno++;
    }

    async putInode(inode: InodeRecord): Promise<void> {
        this.data.set(inode.ino, { ...inode });
    }

    async getInode(ino: number): Promise<InodeRecord | null> {
        const rec = this.data.get(ino);
        return rec ? { ...rec } : null;
    }

    async lookup(parentIno: number, name: string): Promise<InodeRecord | null> {
        for (const rec of this.data.values()) {
            if (rec.parentIno === parentIno && rec.name === name) {
                return { ...rec };
            }
        }
        return null;
    }

    async listChildren(parentIno: number): Promise<InodeRecord[]> {
        const result: InodeRecord[] = [];
        for (const rec of this.data.values()) {
            if (rec.parentIno === parentIno && rec.ino !== parentIno) {
                result.push({ ...rec });
            }
        }
        return result;
    }

    async deleteInode(ino: number): Promise<void> {
        this.data.delete(ino);
    }

    async updateInode(
        ino: number,
        updates: Partial<Pick<InodeRecord, 'parentIno' | 'name' | 'nlink'>>,
    ): Promise<void> {
        const rec = this.data.get(ino);
        if (!rec) return;
        if (updates.parentIno !== undefined) rec.parentIno = updates.parentIno;
        if (updates.name !== undefined) rec.name = updates.name;
        if (updates.nlink !== undefined) rec.nlink = updates.nlink;
    }

    async batchGetInodes(inos: number[]): Promise<InodeRecord[]> {
        const result: InodeRecord[] = [];
        for (const ino of inos) {
            const rec = this.data.get(ino);
            if (rec) result.push({ ...rec });
        }
        return result;
    }
}

class MemoryMetaStore implements IMetaStore {
    private readonly data = new Map<number, MetaRecord>();

    async putMeta(meta: MetaRecord): Promise<void> {
        this.data.set(meta.ino, { ...meta });
    }

    async getMeta(ino: number): Promise<MetaRecord | null> {
        const rec = this.data.get(ino);
        return rec ? { ...rec } : null;
    }

    async deleteMeta(ino: number): Promise<void> {
        this.data.delete(ino);
    }

    async patchMeta(ino: number, partial: Partial<Omit<MetaRecord, 'ino'>>): Promise<void> {
        const rec = this.data.get(ino);
        if (!rec) return;
        Object.assign(rec, partial);
    }

    async batchGetMeta(inos: number[]): Promise<MetaRecord[]> {
        const result: MetaRecord[] = [];
        for (const ino of inos) {
            const rec = this.data.get(ino);
            if (rec) result.push({ ...rec });
        }
        return result;
    }

    async queryByTag(tag: string): Promise<number[]> {
        const result: number[] = [];
        for (const rec of this.data.values()) {
            if (rec.tags?.includes(tag)) {
                result.push(rec.ino);
            }
        }
        return result;
    }

    async queryByMetadata(field: string, value: unknown): Promise<number[]> {
        const result: number[] = [];
        for (const rec of this.data.values()) {
            if (rec.metadata && rec.metadata[field] === value) {
                result.push(rec.ino);
            }
        }
        return result;
    }
}

class MemoryContentStore implements IContentStore {
    private readonly data = new Map<string, ArrayBuffer>();

    async putData(ref: string, data: ArrayBuffer): Promise<void> {
        this.data.set(ref, data.slice(0));
    }

    async getData(ref: string): Promise<ArrayBuffer | null> {
        const buf = this.data.get(ref);
        return buf ? buf.slice(0) : null;
    }

    async deleteData(ref: string): Promise<void> {
        this.data.delete(ref);
    }

    async existsData(ref: string): Promise<boolean> {
        return this.data.has(ref);
    }

    async sizeData(ref: string): Promise<number> {
        return this.data.get(ref)?.byteLength ?? 0;
    }

    async appendData(ref: string, data: ArrayBuffer): Promise<void> {
        const existing = this.data.get(ref);
        if (existing) {
            const merged = new Uint8Array(existing.byteLength + data.byteLength);
            merged.set(new Uint8Array(existing), 0);
            merged.set(new Uint8Array(data), existing.byteLength);
            this.data.set(ref, merged.buffer as ArrayBuffer);
        } else {
            this.data.set(ref, data.slice(0));
        }
    }
}

export class MemoryBackend implements IStorageBackend {
    readonly name = 'memory';
    readonly inodes: IInodeStore = new MemoryInodeStore();
    readonly meta: IMetaStore = new MemoryMetaStore();
    readonly content: IContentStore = new MemoryContentStore();

    async init(): Promise<void> {
        // No-op
    }

    async close(): Promise<void> {
        // No-op
    }

    async runInTransaction<T>(
        _mode: 'readonly' | 'readwrite',
        fn: (scope: ITransactionScope) => Promise<T>,
    ): Promise<T> {
        // Memory backend: no real transaction — passthrough
        return fn({
            inodes: this.inodes,
            meta: this.meta,
            content: this.content,
        });
    }
}
