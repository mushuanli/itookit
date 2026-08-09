/**
 * @file vfsdriver-indexeddb/src/idb-backend.ts
 * v4.1: Path-based IStorageBackend using a single IDB object store.
 * No ino allocation, no separate inode/meta/content stores.
 */

import type {
    IStorageBackend,
    FSNode,
    FSFileNode,
    FSDirectoryNode,
    IRecordStore,
    IRecordTransaction,
    FSSearchQuery,
    RecordQuery,
    RecordQueryOptions,
    RecordQueryResult,
    RecordValue,
    RecordWalkOptions,
} from '@itookit/stdio';
import { openDB, req, collectCursor, REQUIRED_STORES, DB_VERSION, STORE_NODES, STORE_TAGS } from './utils';
import { IDBRecordStore, createRecordStore, ensureRecordIndexes } from './record-store';
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

export interface VerifyResult {
    /** True if the database is healthy (no issues detected). */
    healthy: boolean;
    /** Object store names that are missing from the database. */
    missingStores: string[];
    /** Paths of nodes whose parent directory does not exist. */
    orphanNodes: string[];
    /** Distinct parent paths that are referenced but missing. */
    missingParents: string[];
    /** Tag record IDs that reference non-existent paths. */
    orphanTags: number[];
    /** Total number of nodes scanned. */
    totalNodes: number;
    /** Total number of tag records scanned. */
    totalTags: number;
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
        if (this.db) return;
        this.db = await this.openCompatibleDatabase();
        if (!needsSchemaRepair(this.db)) return;

        const nextVersion = this.db.version + 1;
        this.db.close();
        this.db = null;
        this.db = await openDB(this.dbName, nextVersion, ensureSchema);
    }

    async close(): Promise<void> {
        this.db?.close();
        this.db = null;
    }

    private _db(): IDBDatabase {
        if (!this.db) throw new Error('IndexedDBBackend not initialized');
        return this.db;
    }

    private async openCompatibleDatabase(): Promise<IDBDatabase> {
        try {
            return await openDB(this.dbName, DB_VERSION, ensureSchema);
        } catch (error) {
            if (!isVersionError(error)) throw error;
            return openDB(this.dbName, undefined, ensureSchema);
        }
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
        await this._ensureParents(path);
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
        await this._ensureParents(path);
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
        const matched = entries.filter(entry => matchesSearch(entry, query));
        matched.sort((left, right) => compareSearchEntries(left, right, query));
        const offset = query.offset ?? 0;
        const limit = query.limit ?? 50;
        return matched
            .slice(offset, offset + limit)
            .map(toFSNode);
    }

    // ══ Transaction ══════════════════════════════════════════════

    async transaction<T>(fn: (tx: IStorageBackend) => Promise<T>): Promise<T> {
        // Internal methods (_getEntry, _putEntry) each create their own
        // short-lived IDB transactions. Creating an outer IDB tx here would
        // deadlock them. For true ACID across operations, a TransactionalBackend
        // proxy that reuses a single IDB transaction is needed.
        return fn(this);
    }

    // ══ Health ═══════════════════════════════════════════════════

    async verify(): Promise<VerifyResult> {
        const db = this._db();
        const result: VerifyResult = {
            healthy: true,
            missingStores: [],
            orphanNodes: [],
            missingParents: [],
            orphanTags: [],
            totalNodes: 0,
            totalTags: 0,
        };

        // 1. Check all required stores exist
        const storeSet = new Set(db.objectStoreNames);
        for (const name of REQUIRED_STORES) {
            if (!storeSet.has(name)) {
                result.missingStores.push(name);
                result.healthy = false;
            }
        }

        // 2. Scan all nodes — verify parent integrity
        const tx = db.transaction([STORE_NODES, STORE_TAGS], 'readonly');
        const allNodes = await collectCursor<NodeEntry>(
            tx.objectStore(STORE_NODES).openCursor(), c => c.value,
        );
        result.totalNodes = allNodes.length;

        const existingPaths = new Set<string>(allNodes.map(n => n.path));
        existingPaths.add('/'); // root is always considered to exist

        const missingParentSet = new Set<string>();
        for (const node of allNodes) {
            if (node.path === '/') continue;
            const parentPath = node.path.substring(0, node.path.lastIndexOf('/')) || '/';
            if (!existingPaths.has(parentPath)) {
                result.orphanNodes.push(node.path);
                missingParentSet.add(parentPath);
                result.healthy = false;
            }
        }
        result.missingParents = [...missingParentSet];

        // 3. Check orphaned tag references
        const allTags = await collectCursor<{ id: number; path: string; tag: string }>(
            tx.objectStore(STORE_TAGS).openCursor(), c => c.value,
        );
        result.totalTags = allTags.length;

        for (const tag of allTags) {
            if (!existingPaths.has(tag.path)) {
                result.orphanTags.push(tag.id);
                result.healthy = false;
            }
        }

        return result;
    }

    async repair(issues?: VerifyResult): Promise<{ fixedOrphanTags: number }> {
        const problems = issues ?? await this.verify();
        let fixedOrphanTags = 0;

        // Fix orphan tags by deleting them
        if (problems.orphanTags.length > 0) {
            const db = this._db();
            const repairTx = db.transaction(STORE_TAGS, 'readwrite');
            const store = repairTx.objectStore(STORE_TAGS);
            for (const id of problems.orphanTags) {
                store.delete(id);
                fixedOrphanTags++;
            }
        }

        // missingStores requires re-init (destructive to data).
        // orphanNodes / missingParents cannot be auto-repaired
        // without knowledge of the intended filesystem structure.

        return { fixedOrphanTags };
    }

    // ══ Internal ═════════════════════════════════════════════════

    private async _ensureParents(path: string): Promise<void> {
        const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
        if (parentPath === '/') return;

        const segments = parentPath.split('/').filter(Boolean);
        let current = '';
        for (const segment of segments) {
            current += '/' + segment;
            const entry = await this._getEntry(current);
            if (entry) {
                if (entry.type === 'file') {
                    throw new Error(`ENOTDIR: ${current} is a file`);
                }
                continue;
            }
            const dirEntry: NodeEntry = {
                path: current,
                type: 'directory',
                content: new ArrayBuffer(0),
                size: 0,
                createdAt: Date.now(),
                modifiedAt: Date.now(),
                tags: [],
                metadata: '{}',
            };
            await this._putEntry(dirEntry);
        }
    }

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

    async getRecordField(path: string, field: string): Promise<RecordValue | undefined> {
        return new IDBRecordStore(this.roStore()).getRecordField(path, field);
    }
    async setRecordField(path: string, field: string, value: RecordValue): Promise<void> {
        return new IDBRecordStore(this.store()).setRecordField(path, field, value);
    }
    async deleteRecordField(path: string, field: string): Promise<void> {
        return new IDBRecordStore(this.store()).deleteRecordField(path, field);
    }
    async setAllRecordFields(path: string, fields: Record<string, RecordValue>): Promise<void> {
        return new IDBRecordStore(this.store()).setAllRecordFields(path, fields);
    }
    async clearRecordFields(path: string): Promise<void> {
        return new IDBRecordStore(this.store()).clearRecordFields(path);
    }
    async walkRecordFields(
        path: string,
        callback: (field: string, value: RecordValue) => boolean | Promise<boolean>,
        options?: RecordWalkOptions,
    ): Promise<{ total: number; processed: number }> {
        return new IDBRecordStore(this.roStore()).walkRecordFields(path, callback, options);
    }
    async walkRecordFieldNames(
        path: string,
        callback: (field: string) => boolean | Promise<boolean>,
        options?: { prefix?: string; limit?: number },
    ): Promise<number> {
        return new IDBRecordStore(this.roStore()).walkRecordFieldNames(path, callback, options);
    }
    async createRecordIndex(path: string, field: string): Promise<void> {
        return new IDBRecordStore(this.store()).createRecordIndex(path, field);
    }
    async deleteRecordIndex(path: string, field: string): Promise<void> {
        return new IDBRecordStore(this.store()).deleteRecordIndex(path, field);
    }
    async queryRecordFields(
        path: string,
        query: RecordQuery,
        options?: RecordQueryOptions,
    ): Promise<RecordQueryResult[]> {
        return new IDBRecordStore(this.roStore()).queryRecordFields(path, query, options);
    }

    async transaction<T>(operation: (tx: IRecordTransaction) => Promise<T>): Promise<T> {
        const transaction = this.getDB().transaction(STORE_RECORDS, 'readwrite');
        const records = new IDBRecordStore(transaction.objectStore(STORE_RECORDS));
        const completed = waitForTransaction(transaction);
        try {
            const result = await operation(records);
            await completed;
            return result;
        } catch (error) {
            try { transaction.abort(); } catch { /* Transaction already closed. */ }
            await completed.catch(() => undefined);
            throw error;
        }
    }
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    });
}

const REQUIRED_INDEXES: Readonly<Record<string, readonly string[]>> = {
    [STORE_NODES]: ['type', 'modifiedAt'],
    [STORE_TAGS]: ['tag', 'path'],
    [STORE_RECORDS]: ['idx_path'],
};

function ensureSchema(db: IDBDatabase, transaction: IDBTransaction): void {
    const nodes = getOrCreateNodesStore(db, transaction);
    ensureIndex(nodes, 'type', 'type');
    ensureIndex(nodes, 'modifiedAt', 'modifiedAt');

    const tags = getOrCreateTagsStore(db, transaction);
    ensureIndex(tags, 'tag', 'tag');
    ensureIndex(tags, 'path', 'path');

    if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        createRecordStore(db);
    } else {
        ensureRecordIndexes(transaction.objectStore(STORE_RECORDS));
    }
}

function getOrCreateNodesStore(
    db: IDBDatabase,
    transaction: IDBTransaction,
): IDBObjectStore {
    if (db.objectStoreNames.contains(STORE_NODES)) {
        return transaction.objectStore(STORE_NODES);
    }
    return db.createObjectStore(STORE_NODES, { keyPath: 'path' });
}

function getOrCreateTagsStore(
    db: IDBDatabase,
    transaction: IDBTransaction,
): IDBObjectStore {
    if (db.objectStoreNames.contains(STORE_TAGS)) {
        return transaction.objectStore(STORE_TAGS);
    }
    return db.createObjectStore(STORE_TAGS, { keyPath: 'id', autoIncrement: true });
}

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string): void {
    if (!store.indexNames.contains(name)) {
        store.createIndex(name, keyPath);
    }
}

function needsSchemaRepair(db: IDBDatabase): boolean {
    if (REQUIRED_STORES.some(store => !db.objectStoreNames.contains(store))) {
        return true;
    }
    return Object.entries(REQUIRED_INDEXES).some(([storeName, indexes]) => {
        const store = db.transaction(storeName, 'readonly').objectStore(storeName);
        return indexes.some(index => !store.indexNames.contains(index));
    });
}

function isVersionError(error: unknown): boolean {
    return error instanceof Error && error.name === 'VersionError';
}

function matchesSearch(entry: NodeEntry, query: FSSearchQuery): boolean {
    const name = entry.path.split('/').pop() ?? '';
    const types = query.type
        ? Array.isArray(query.type) ? query.type : [query.type]
        : null;
    if (types && !types.includes(entry.type)) return false;
    if (!matchesName(name, query.name)) return false;
    if (!matchesTags(entry.tags, query.tags)) return false;
    if (!matchesMetadata(entry.metadata, query.metadata)) return false;
    if (query.modifiedAfter !== undefined && entry.modifiedAt <= query.modifiedAfter) return false;
    if (query.modifiedBefore !== undefined && entry.modifiedAt >= query.modifiedBefore) return false;
    if (query.text && !matchesText(entry, query.text)) return false;
    return true;
}

function matchesName(name: string, query: FSSearchQuery['name']): boolean {
    if (!query) return true;
    const value = name.toLowerCase();
    if (query.exact && value !== query.exact.toLowerCase()) return false;
    if (query.contains && !value.includes(query.contains.toLowerCase())) return false;
    if (query.startsWith && !value.startsWith(query.startsWith.toLowerCase())) return false;
    if (query.endsWith && !value.endsWith(query.endsWith.toLowerCase())) return false;
    return !query.pattern || matchesGlob(name, query.pattern);
}

function matchesTags(tags: string[], query: FSSearchQuery['tags']): boolean {
    if (!query) return true;
    if (query.all && !query.all.every(tag => tags.includes(tag))) return false;
    if (query.any && !query.any.some(tag => tags.includes(tag))) return false;
    return !query.none || query.none.every(tag => !tags.includes(tag));
}

function matchesMetadata(serialized: string, query?: Record<string, unknown>): boolean {
    if (!query) return true;
    const metadata = parseMetadata(serialized);
    return Object.entries(query).every(([key, value]) => Object.is(metadata[key], value));
}

function parseMetadata(serialized: string): Record<string, unknown> {
    try {
        const value: unknown = JSON.parse(serialized);
        return isUnknownRecord(value) ? value : {};
    } catch {
        return {};
    }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function matchesText(entry: NodeEntry, text: string): boolean {
    if (entry.type !== 'file') return false;
    const content = new TextDecoder().decode(entry.content).toLowerCase();
    return content.includes(text.toLowerCase());
}

function matchesGlob(value: string, pattern: string): boolean {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i').test(value);
}

function compareSearchEntries(
    left: NodeEntry,
    right: NodeEntry,
    query: FSSearchQuery,
): number {
    if (!query.orderBy) return 0;
    const direction = query.orderDirection === 'desc' ? -1 : 1;
    const leftValue = searchOrderValue(left, query.orderBy);
    const rightValue = searchOrderValue(right, query.orderBy);
    if (leftValue === rightValue) return 0;
    return (leftValue < rightValue ? -1 : 1) * direction;
}

function searchOrderValue(
    entry: NodeEntry,
    orderBy: NonNullable<FSSearchQuery['orderBy']>,
): string | number {
    if (orderBy === 'name') return entry.path.split('/').pop()?.toLowerCase() ?? '';
    return entry[orderBy];
}

function toFSNode(entry: NodeEntry): FSNode {
    const name = entry.path === '/' ? '' : entry.path.split('/').pop()!;
    const parentPath = entry.path === '/' ? null : entry.path.substring(0, entry.path.lastIndexOf('/')) || '/';
    const base = {
        parentPath,
        name,
        path: entry.path,
        createdAt: entry.createdAt,
        modifiedAt: entry.modifiedAt,
        version: Math.floor(entry.modifiedAt),
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
        assetDirPath: undefined,
    } as FSFileNode;
}

/**
 * Open (and initialize) an IndexedDB storage backend.
 * Symmetric with `openLocalFSBackend` from @itookit/vfsdriver-localfs.
 */
export async function openIndexedDBBackend(options?: IndexedDBBackendOptions): Promise<IndexedDBBackend> {
    const backend = new IndexedDBBackend(options);
    await backend.init();
    return backend;
}
