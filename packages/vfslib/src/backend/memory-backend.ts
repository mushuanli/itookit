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
    InodeWalkOptions,
    ContentStreamOptions,
    ContentStreamResult,
    MetaWalkOptions,
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

    async forEachInode(
        inos: number[],
        callback: (inode: InodeRecord, index: number) => boolean | Promise<boolean>,
    ): Promise<void> {
        for (let i = 0; i < inos.length; i++) {
            const rec = this.data.get(inos[i]);
            if (rec) {
                if (!(await callback({ ...rec }, i))) break;
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
        for (const rec of this.data.values()) {
            if (rec.parentIno !== parentIno || rec.ino === parentIno) continue;
            const result = await callback({ ...rec }, depth);
            if (result === false) return false;
            if (result !== 'skip' && rec.type === 'directory' && (maxDepth < 0 || depth < maxDepth)) {
                if (!(await this._walkDFS(rec.ino, callback, depth + 1, maxDepth))) return false;
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
            for (const rec of this.data.values()) {
                if (rec.parentIno !== ino || rec.ino === ino) continue;
                const result = await callback({ ...rec }, nextDepth);
                if (result === false) return;
                if (result !== 'skip' && rec.type === 'directory') {
                    queue.push({ ino: rec.ino, depth: nextDepth });
                }
            }
        }
    }

    async hasChildren(parentIno: number): Promise<boolean> {
        for (const rec of this.data.values()) {
            if (rec.parentIno === parentIno && rec.ino !== parentIno) return true;
        }
        return false;
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

    async forEachMeta(
        inos: number[],
        callback: (meta: MetaRecord, index: number) => boolean | Promise<boolean>,
    ): Promise<void> {
        for (let i = 0; i < inos.length; i++) {
            const rec = this.data.get(inos[i]);
            if (rec) {
                if (!(await callback({ ...rec }, i))) break;
            }
        }
    }

    async walkByTag(
        tag: string,
        callback: (ino: number) => boolean | Promise<boolean>,
        options?: MetaWalkOptions,
    ): Promise<{ total: number; processed: number }> {
        const matched: number[] = [];
        for (const rec of this.data.values()) {
            if (rec.tags?.includes(tag)) matched.push(rec.ino);
        }
        const total = matched.length;
        let processed = 0;
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? Infinity;
        for (let i = offset; i < matched.length && processed < limit; i++) {
            if (!(await callback(matched[i]))) break;
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
        const matched: number[] = [];
        for (const rec of this.data.values()) {
            if (rec.metadata && rec.metadata[field] === value) matched.push(rec.ino);
        }
        const total = matched.length;
        let processed = 0;
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? Infinity;
        for (let i = offset; i < matched.length && processed < limit; i++) {
            if (!(await callback(matched[i]))) break;
            processed++;
        }
        return { total, processed };
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

    async streamData(
        ref: string,
        callback: (chunk: ArrayBuffer, offset: number) => boolean | Promise<boolean>,
        options?: ContentStreamOptions,
    ): Promise<ContentStreamResult> {
        const data = await this.getData(ref);
        if (!data) return { bytesRead: 0, completed: false };
        const chunkSize = options?.chunkSize ?? 65536;
        const start = options?.startOffset ?? 0;
        const end = options?.maxLength != null ? start + options.maxLength : data.byteLength;
        let offset = start;
        let bytesRead = 0;
        while (offset < end) {
            const chunk = data.slice(offset, Math.min(offset + chunkSize, end));
            if (!(await callback(chunk, offset))) return { bytesRead, completed: false };
            bytesRead += chunk.byteLength;
            offset += chunk.byteLength;
        }
        return { bytesRead, completed: true };
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
