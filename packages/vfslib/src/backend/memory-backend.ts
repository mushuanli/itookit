/**
 * @file packages/vfslib/src/backend/memory-backend.ts
 * @desc 内存存储后端 — path-based IStorageBackend（测试和临时存储用）
 *
 * v4.1: 简化为 path-based 统一接口，放弃 IInodeStore/IMetaStore/IContentStore 三层分离。
 */

import type { IStorageBackend, FSNode, FSFileNode, FSDirectoryNode, FSSearchQuery } from '@itookit/common';

interface Entry {
    type: 'file' | 'directory';
    content: Uint8Array;
    createdAt: number;
    modifiedAt: number;
    tags: string[];
    metadata: Record<string, unknown>;
    icon?: string;
    symlinkTarget?: string;
    extra?: Record<string, unknown>;
}

const ROOT_ENTRY: Entry = Object.freeze({
    type: 'directory' as const,
    content: new Uint8Array(0),
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    tags: [],
    metadata: {},
});

export class MemoryBackend implements IStorageBackend {
    readonly name = 'memory';
    private data = new Map<string, Entry>();

    async init(): Promise<void> {
        this.data.set('/', { ...ROOT_ENTRY, createdAt: Date.now(), modifiedAt: Date.now() });
    }

    async close(): Promise<void> {
        this.data.clear();
    }

    // ── Structure ──

    async stat(path: string): Promise<FSNode | null> {
        const entry = this.data.get(normalize(path));
        if (!entry) return null;
        return toFSNode(path, entry);
    }

    async list(path: string): Promise<FSNode[]> {
        const parent = normalize(path);
        if (!this.data.has(parent)) return [];
        const prefix = parent === '/' ? '/' : parent + '/';
        const seen = new Set<string>();
        const results: FSNode[] = [];

        for (const [p, entry] of this.data) {
            if (p === parent || !p.startsWith(prefix)) continue;
            const rest = p.slice(prefix.length);
            const segEnd = rest.indexOf('/');
            const seg = segEnd === -1 ? rest : rest.slice(0, segEnd);
            const fullPath = segEnd === -1 ? p : parent + '/' + seg;
            if (seen.has(fullPath)) continue;
            seen.add(fullPath);

            const childEntry = this.data.get(fullPath);
            if (childEntry) {
                results.push(toFSNode(fullPath, childEntry));
            }
        }
        return results;
    }

    async mkdir(path: string): Promise<FSNode> {
        const p = normalize(path);
        if (this.data.has(p)) {
            const existing = this.data.get(p)!;
            return toFSNode(p, existing);
        }
        const entry: Entry = {
            type: 'directory',
            content: new Uint8Array(0),
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            tags: [],
            metadata: {},
        };
        this.data.set(p, entry);
        return toFSNode(p, entry);
    }

    async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
        const p = normalize(path);
        if (!this.data.has(p)) return;
        const prefix = p === '/' ? '/' : p + '/';

        if (options?.recursive) {
            for (const key of this.data.keys()) {
                if (key.startsWith(prefix)) this.data.delete(key);
            }
        }
        this.data.delete(p);
    }

    async rename(fromPath: string, toPath: string): Promise<void> {
        const from = normalize(fromPath);
        const to = normalize(toPath);
        const entry = this.data.get(from);
        if (!entry) return;
        const fromPrefix = from === '/' ? '/' : from + '/';
        const toPrefix = to === '/' ? '/' : to + '/';

        this.data.delete(from);
        this.data.set(to, { ...entry, modifiedAt: Date.now() });

        // Move children
        for (const [p, e] of this.data) {
            if (p.startsWith(fromPrefix)) {
                const childRest = p.slice(fromPrefix.length - 1);
                const newChildPath = to === '/' ? childRest : to + childRest;
                this.data.delete(p);
                this.data.set(newChildPath, e);
            }
        }
    }

    // ── Content ──

    async read(path: string, options?: { offset?: number; length?: number }): Promise<Uint8Array> {
        const entry = this.data.get(normalize(path));
        if (!entry) throw new Error('ENOENT');
        let buf = entry.content;
        if (options?.offset !== undefined) {
            buf = buf.slice(options.offset, options.length ? options.offset + options.length : undefined);
        }
        return buf;
    }

    async write(path: string, content: Uint8Array): Promise<FSNode> {
        const p = normalize(path);
        const existing = this.data.get(p);
        const entry: Entry = {
            type: 'file',
            content: new Uint8Array(content),
            createdAt: existing?.createdAt ?? Date.now(),
            modifiedAt: Date.now(),
            tags: existing?.tags ?? [],
            metadata: existing?.metadata ?? {},
            icon: existing?.icon,
            symlinkTarget: existing?.symlinkTarget,
            extra: existing?.extra,
        };
        this.data.set(p, entry);
        return toFSNode(p, entry);
    }

    // ── Metadata ──

    async updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void> {
        const entry = this.data.get(normalize(path));
        if (!entry) return;
        entry.metadata = { ...entry.metadata, ...metadata };
        entry.modifiedAt = Date.now();
    }

    async setTags(path: string, tags: string[]): Promise<void> {
        const entry = this.data.get(normalize(path));
        if (!entry) return;
        entry.tags = tags;
        entry.modifiedAt = Date.now();
    }

    async getAllTags(): Promise<string[]> {
        const seen = new Set<string>();
        for (const entry of this.data.values()) {
            for (const t of entry.tags) seen.add(t);
        }
        return [...seen];
    }

    // ── Search ──

    async search(query: FSSearchQuery): Promise<FSNode[]> {
        const results: FSNode[] = [];
        for (const [path, entry] of this.data) {
            const node = toFSNode(path, entry);
            if (matchesSearch(node, query)) results.push(node);
        }
        if (query.orderBy === 'modifiedAt') {
            results.sort((a, b) => query.orderDirection === 'desc' ? b.modifiedAt - a.modifiedAt : a.modifiedAt - b.modifiedAt);
        }
        const offset = query.offset ?? 0;
        const limit = query.limit ?? 50;
        return results.slice(offset, offset + limit);
    }

    // ── Transaction ──

    async transaction<T>(fn: (tx: IStorageBackend) => Promise<T>): Promise<T> {
        return fn(this); // Memory backend: no isolation
    }
}

// ── Helpers ──

function normalize(path: string): string {
    if (path === '' || path === '/') return '/';
    return '/' + path.split('/').filter(Boolean).join('/');
}

function toFSNode(path: string, entry: Entry): FSNode {
    const name = path === '/' ? '' : path.split('/').pop()!;
    const parentDir = path === '/' ? null : path.substring(0, path.lastIndexOf('/')) || '/';
    const base = {
        id: path,
        parentId: parentDir,
        name,
        path,
        createdAt: entry.createdAt,
        modifiedAt: entry.modifiedAt,
        version: Math.floor(entry.modifiedAt),
        nlink: 1,
        tags: entry.tags,
        metadata: entry.metadata,
        icon: entry.icon,
    };

    if (entry.type === 'directory') {
        return { ...base, type: 'directory' } as FSDirectoryNode;
    }

    const fileBase = {
        ...base,
        type: 'file' as const,
        size: entry.content.byteLength,
        contentHash: undefined,
        assetDirId: undefined,
    };

    if (entry.symlinkTarget) {
        return { ...fileBase, type: 'symlink' as const, symlinkTarget: entry.symlinkTarget } as FSNode;
    }

    return fileBase as FSFileNode;
}

function matchesSearch(node: FSNode, q: FSSearchQuery): boolean {
    if (q.type) {
        const types = Array.isArray(q.type) ? q.type : [q.type];
        if (!types.includes(node.type)) return false;
    }
    if (q.name?.contains && !node.name.toLowerCase().includes(q.name.contains.toLowerCase())) return false;
    if (q.name?.exact && node.name !== q.name.exact) return false;
    if (q.name?.startsWith && !node.name.startsWith(q.name.startsWith)) return false;
    if (q.tags?.all && !q.tags.all.every(t => node.tags.includes(t))) return false;
    if (q.tags?.any && !q.tags.any.some(t => node.tags.includes(t))) return false;
    if (q.tags?.none && q.tags.none.some(t => node.tags.includes(t))) return false;
    if (q.text && node.type === 'file') return false; // Memory backend can't full-text search content
    return true;
}
