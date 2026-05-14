/**
 * @file vfsdriver-indexeddb/src/idb-backend.ts
 * v4.1: Path-based IStorageBackend using a single IDB object store.
 * No ino allocation, no separate inode/meta/content stores.
 */

import type { IStorageBackend, FSNode, FSFileNode, FSDirectoryNode, IRecordStore, FSSearchQuery } from '@itookit/common';
import { openDB, req, collectCursor, ALL_STORES, DB_VERSION, STORE_NODES, STORE_TAGS } from './utils';
import { IDBRecordStore, createRecordStore } from './record-store';
import { STORE_RECORDS } from './utils';

interface NodeEntry {
    path: string;
    type: 'file' | 'directory';
    content: ArrayBuffer;
    size: number;
    createdAt: number;
    modifiedAt: number;
    icon?: string;
    tags: string[];
    metadata: string; // JSON
}

export interface IndexedDBBackendOptions {
    dbName?: string;
}

export class IndexedDBBackend implements IStorageBackend {
    readonly name = 'indexeddb';
    readonly records: IRecordStore;
    private db: IDBDatabase | null = null;
    private readonly dbName: string;

    constructor(options: IndexedDBBackendOptions = {}) {
        this.dbName = options.dbName ?? 'MindOS-v4';
        this.records = new LazyRecordStore(() => this._db());
    }

    // ══ Lifecycle ═════════════════════════════════════════════════

    async init(): Promise<void> {
        this.db = await openDB(this.dbName, DB_VERSION, (db) => {
            if (!db.objectStoreNames.contains(STORE_NODES)) {
                const nodes = db.createObjectStore(STORE_NODES, { keyPath: 'path' });
                nodes.createIndex('type', 'type');
                nodes.createIndex('modifiedAt', 'modifiedAt');
            }
            if (!db.objectStoreNames.contains(STORE_TAGS)) {
                const tags = db.createObjectStore(STORE_TAGS, { keyPath: 'id', autoIncrement: true });
                tags.createIndex('tag', 'tag');
                tags.createIndex('path', 'path');
            }
            if (!db.objectStoreNames.contains(STORE_RECORDS)) {
                createRecordStore(db);
            }
        });
    }

    async close(): Promise<void> {
        this.db?.close();
        this.db = null;
    }

    private _db(): IDBDatabase {
        if (!this.db) throw new Error('IndexedDBBackend not initialized');
        return this.db;
    }

    // ══ Structure ════════════════════════════════════════════════

    async stat(path: string): Promise<FSNode | null> {
        const entry = await this._getEntry(path);
        return entry ? toFSNode(entry) : null;
    }

    async list(dirPath: string): Promise<FSNode[]> {
        const prefix = dirPath === '/' ? '/' : dirPath + '/';
        const db = this._db();
        const tx = db.transaction(STORE_NODES, 'readonly');
        const entries = await collectCursor<NodeEntry>(
            tx.objectStore(STORE_NODES).openCursor(),
            (c) => c.value,
        );
        const seen = new Set<string>();
        return entries
            .filter(e => {
                if (e.path === dirPath || !e.path.startsWith(prefix)) return false;
                const rest = e.path.slice(prefix.length);
                if (rest.includes('/')) return false;
                if (seen.has(e.path)) return false;
                seen.add(e.path);
                return true;
            })
            .map(toFSNode);
    }

    async mkdir(path: string): Promise<FSNode> {
        const existing = await this._getEntry(path);
        if (existing) return toFSNode(existing);
        const entry: NodeEntry = {
            path, type: 'directory', content: new ArrayBuffer(0),
            size: 0, createdAt: Date.now(), modifiedAt: Date.now(),
            tags: [], metadata: '{}',
        };
        await this._putEntry(entry);
        return toFSNode(entry);
    }

    async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
        const db = this._db();
        const tx = db.transaction([STORE_NODES, STORE_TAGS], 'readwrite');
        const nodes = tx.objectStore(STORE_NODES);

        if (options?.recursive) {
            const prefix = path === '/' ? '/' : path + '/';
            const all = await collectCursor<NodeEntry>(nodes.openCursor(), c => c.value);
            for (const e of all) {
                if (e.path.startsWith(prefix)) {
                    nodes.delete(e.path);
                    await this._deleteTagRefs(tx, e.path);
                }
            }
        }
        nodes.delete(path);
        await this._deleteTagRefs(tx, path);
    }

    async rename(fromPath: string, toPath: string): Promise<void> {
        const entry = await this._getEntry(fromPath);
        if (!entry) return;
        const fromPrefix = fromPath + '/';
        const toPrefix = toPath + '/';
        const db = this._db();
        const tx = db.transaction(STORE_NODES, 'readwrite');
        const nodes = tx.objectStore(STORE_NODES);

        const all = await collectCursor<NodeEntry>(nodes.openCursor(), c => c.value);
        for (const e of all) {
            if (e.path === fromPath) {
                nodes.delete(fromPath);
                await req(nodes.add({ ...entry, path: toPath, modifiedAt: Date.now() }));
            } else if (e.path.startsWith(fromPrefix)) {
                const newChildPath = toPrefix + e.path.slice(fromPrefix.length);
                nodes.delete(e.path);
                await req(nodes.add({ ...e, path: newChildPath, modifiedAt: Date.now() }));
            }
        }
    }

    // ══ Content ══════════════════════════════════════════════════

    async read(path: string, options?: { offset?: number; length?: number }): Promise<Uint8Array> {
        const entry = await this._getEntry(path);
        if (!entry) throw new Error(`ENOENT: ${path}`);
        const data = new Uint8Array(entry.content);
        if (options?.offset !== undefined) {
            return data.slice(options.offset, options.length ? options.offset + options.length : undefined);
        }
        return data;
    }

    async write(path: string, content: Uint8Array): Promise<FSNode> {
        const existing = await this._getEntry(path);
        const entry: NodeEntry = {
            path,
            type: existing?.type ?? 'file',
            content: content.buffer as ArrayBuffer,
            size: content.byteLength,
            createdAt: existing?.createdAt ?? Date.now(),
            modifiedAt: Date.now(),
            icon: existing?.icon,
            tags: existing?.tags ?? [],
            metadata: existing?.metadata ?? '{}',
        };
        await this._putEntry(entry);
        return toFSNode(entry);
    }

    // ══ Metadata ═════════════════════════════════════════════════

    async updateMetadata(path: string, metadata: Record<string, unknown>): Promise<void> {
        const entry = await this._getEntry(path);
        if (!entry) return;
        const existing = JSON.parse(entry.metadata);
        entry.metadata = JSON.stringify({ ...existing, ...metadata });
        entry.modifiedAt = Date.now();
        await this._putEntry(entry);
    }

    async setTags(path: string, tags: string[]): Promise<void> {
        const entry = await this._getEntry(path);
        if (!entry) return;
        entry.tags = tags;
        entry.modifiedAt = Date.now();
        await this._putEntry(entry);
        await this._syncTags(path, tags);
    }

    async getAllTags(): Promise<string[]> {
        const db = this._db();
        const tx = db.transaction(STORE_TAGS, 'readonly');
        const rows = await collectCursor<{ tag: string }>(tx.objectStore(STORE_TAGS).index('tag').openCursor(), c => c.value);
        return [...new Set(rows.map(r => r.tag))];
    }

    // ══ Search ═══════════════════════════════════════════════════

    async search(query: FSSearchQuery): Promise<FSNode[]> {
        const db = this._db();
        const tx = db.transaction(STORE_NODES, 'readonly');
        const entries = await collectCursor<NodeEntry>(tx.objectStore(STORE_NODES).openCursor(), c => c.value);
        return entries
            .filter(e => {
                if (query.type && e.type !== query.type) return false;
                const name = e.path.split('/').pop() ?? '';
                if (query.name?.contains && !name.toLowerCase().includes(query.name.contains.toLowerCase())) return false;
                return true;
            })
            .map(toFSNode)
            .slice(0, query.limit ?? 50);
    }

    // ══ Transaction ══════════════════════════════════════════════

    async transaction<T>(fn: (tx: IStorageBackend) => Promise<T>): Promise<T> {
        return fn(this);
    }

    // ══ Internal ═════════════════════════════════════════════════

    private async _getEntry(path: string): Promise<NodeEntry | null> {
        const db = this._db();
        const tx = db.transaction(STORE_NODES, 'readonly');
        return req<NodeEntry | undefined>(tx.objectStore(STORE_NODES).get(path)).then(r => r ?? null);
    }

    private async _putEntry(entry: NodeEntry): Promise<void> {
        const db = this._db();
        const tx = db.transaction(STORE_NODES, 'readwrite');
        await req(tx.objectStore(STORE_NODES).put(entry));
    }

    private async _syncTags(path: string, tags: string[]): Promise<void> {
        const db = this._db();
        const tx = db.transaction(STORE_TAGS, 'readwrite');
        const store = tx.objectStore(STORE_TAGS);
        const idx = store.index('path');
        const existing = await collectCursor<{ id: number }>(idx.openCursor(IDBKeyRange.only(path)), c => c.value);
        for (const e of existing) store.delete(e.id);
        for (const tag of tags) await req(store.add({ path, tag }));
    }

    private async _deleteTagRefs(tx: IDBTransaction, path: string): Promise<void> {
        const store = tx.objectStore(STORE_TAGS);
        const idx = store.index('path');
        const existing = await collectCursor<{ id: number }>(idx.openCursor(IDBKeyRange.only(path)), c => c.value);
        for (const e of existing) store.delete(e.id);
    }
}

// ── FSNode Factory ─────────────────────────────────────────────────

// ══ Lazy Record Store — wraps IDBRecordStore with per-op short-lived IDB tx ══

class LazyRecordStore implements IRecordStore {
    constructor(private readonly getDB: () => IDBDatabase) {}

    private store(): IDBObjectStore {
        const tx = this.getDB().transaction(STORE_RECORDS, 'readwrite');
        return tx.objectStore(STORE_RECORDS);
    }

    private roStore(): IDBObjectStore {
        const tx = this.getDB().transaction(STORE_RECORDS, 'readonly');
        return tx.objectStore(STORE_RECORDS);
    }

    async getRecordField(ino: number, field: string) {
        return new IDBRecordStore(this.roStore()).getRecordField(ino, field);
    }
    async setRecordField(ino: number, field: string, value: import('@itookit/common').RecordValue) {
        return new IDBRecordStore(this.store()).setRecordField(ino, field, value);
    }
    async deleteRecordField(ino: number, field: string) {
        return new IDBRecordStore(this.store()).deleteRecordField(ino, field);
    }
    async setAllRecordFields(ino: number, fields: Record<string, import('@itookit/common').RecordValue>) {
        return new IDBRecordStore(this.store()).setAllRecordFields(ino, fields);
    }
    async clearRecordFields(ino: number) {
        return new IDBRecordStore(this.store()).clearRecordFields(ino);
    }
    async walkRecordFields(ino: number, cb: any, opts?: any) {
        return new IDBRecordStore(this.roStore()).walkRecordFields(ino, cb, opts);
    }
    async walkRecordFieldNames(ino: number, cb: any, opts?: any) {
        return new IDBRecordStore(this.roStore()).walkRecordFieldNames(ino, cb, opts);
    }
    async createRecordIndex(ino: number, field: string) {
        return new IDBRecordStore(this.store()).createRecordIndex(ino, field);
    }
    async deleteRecordIndex(ino: number, field: string) {
        return new IDBRecordStore(this.store()).deleteRecordIndex(ino, field);
    }
    async queryRecordFields(ino: number, query: import('@itookit/common').RecordQuery, opts?: import('@itookit/common').RecordQueryOptions) {
        return new IDBRecordStore(this.roStore()).queryRecordFields(ino, query, opts);
    }
}

function toFSNode(entry: NodeEntry): FSNode {
    const name = entry.path === '/' ? '' : entry.path.split('/').pop()!;
    const parentPath = entry.path === '/' ? null : entry.path.substring(0, entry.path.lastIndexOf('/')) || '/';
    const base = {
        id: entry.path,
        parentId: parentPath,
        name,
        path: entry.path,
        createdAt: entry.createdAt,
        modifiedAt: entry.modifiedAt,
        version: Math.floor(entry.modifiedAt),
        nlink: 1,
        icon: entry.icon,
        tags: entry.tags,
        metadata: JSON.parse(entry.metadata) as Record<string, unknown>,
    };

    if (entry.type === 'directory') {
        return { ...base, type: 'directory' } as FSDirectoryNode;
    }

    return {
        ...base,
        type: 'file',
        size: entry.size,
        contentHash: undefined,
        assetDirId: undefined,
    } as FSFileNode;
}
