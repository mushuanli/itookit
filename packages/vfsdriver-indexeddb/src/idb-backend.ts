/**
 * @file vfsdriver-indexeddb/src/idb-backend.ts
 * @desc IndexedDB IStorageBackend implementation
 *
 * Design:
 * - All four stores (inodes, meta, content, records) live in one IDB database.
 * - runInTransaction opens a real IDB transaction that spans all stores,
 *   providing genuine ACID semantics within a single tab.
 * - Outside of runInTransaction, each store operation opens its own
 *   short-lived IDB transaction (auto-commits on success).
 * - The IRecordStore is always present, making seqFiles available by default.
 *
 * Transaction safety:
 *   IDB transactions stay open while there are pending IDB requests in the
 *   current microtask. Since all store methods only await IDB requests,
 *   the transaction remains alive throughout the async fn call.
 */

import type {
    IStorageBackend,
    ITransactionScope,
    IInodeStore,
    IMetaStore,
    IContentStore,
    IRecordStore,
    InodeRecord,
    InodeWalkOptions,
} from '@itookit/common';

import { IDBInodeStore, createInodeStore, createCounterStore } from './inode-store';
import { IDBMetaStore, createMetaStore } from './meta-store';
import { IDBContentStore, createContentStore } from './content-store';
import { IDBRecordStore, createRecordStore } from './record-store';
import {
    openDB,
    txDone,
    req,
    ALL_STORES,
    DB_VERSION,
    ROOT_INO,
    COUNTER_INO,
    STORE_INODES,
    STORE_META,
    STORE_CONTENT,
    STORE_RECORDS,
    STORE_COUNTERS,
} from './utils';

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

export interface IndexedDBBackendOptions {
    /**
     * IndexedDB database name.
     * Use a unique name per mounted backend to avoid collisions.
     * @default 'vfs'
     */
    dbName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoped transaction stores (use a provided IDB transaction)
// ─────────────────────────────────────────────────────────────────────────────

function makeTxScope(tx: IDBTransaction): ITransactionScope {
    return {
        inodes: new IDBInodeStore(
            tx.objectStore(STORE_INODES),
            tx.objectStore(STORE_COUNTERS),
        ),
        meta: new IDBMetaStore(tx.objectStore(STORE_META)),
        content: new IDBContentStore(tx.objectStore(STORE_CONTENT)),
        records: new IDBRecordStore(tx.objectStore(STORE_RECORDS)),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone stores (each operation opens its own short-lived IDB tx)
// ─────────────────────────────────────────────────────────────────────────────

class StandaloneInodeStore implements IInodeStore {
    constructor(private readonly db: IDBDatabase) {}

    private tx(mode: IDBTransactionMode = 'readonly'): IDBTransaction {
        return this.db.transaction([STORE_INODES, STORE_COUNTERS], mode);
    }

    async allocateIno(): Promise<number> {
        const tx = this.tx('readwrite');
        const store = new IDBInodeStore(tx.objectStore(STORE_INODES), tx.objectStore(STORE_COUNTERS));
        const ino = await store.allocateIno();
        await txDone(tx);
        return ino;
    }

    async putInode(inode: import('@itookit/common').InodeRecord): Promise<void> {
        const tx = this.tx('readwrite');
        await new IDBInodeStore(tx.objectStore(STORE_INODES), tx.objectStore(STORE_COUNTERS)).putInode(inode);
        await txDone(tx);
    }

    async getInode(ino: number): Promise<import('@itookit/common').InodeRecord | null> {
        const tx = this.tx();
        return new IDBInodeStore(tx.objectStore(STORE_INODES), tx.objectStore(STORE_COUNTERS)).getInode(ino);
    }

    async lookup(parentIno: number, name: string): Promise<import('@itookit/common').InodeRecord | null> {
        const tx = this.tx();
        return new IDBInodeStore(tx.objectStore(STORE_INODES), tx.objectStore(STORE_COUNTERS)).lookup(parentIno, name);
    }

    async deleteInode(ino: number): Promise<void> {
        const tx = this.tx('readwrite');
        await new IDBInodeStore(tx.objectStore(STORE_INODES), tx.objectStore(STORE_COUNTERS)).deleteInode(ino);
        await txDone(tx);
    }

    async updateInode(ino: number, updates: Partial<Pick<import('@itookit/common').InodeRecord, 'parentIno' | 'name' | 'nlink'>>): Promise<void> {
        const tx = this.tx('readwrite');
        await new IDBInodeStore(tx.objectStore(STORE_INODES), tx.objectStore(STORE_COUNTERS)).updateInode(ino, updates);
        await txDone(tx);
    }

    async forEachInode(inos: number[], callback: (inode: InodeRecord, index: number) => boolean | Promise<boolean>): Promise<void> {
        const tx = this.tx();
        return new IDBInodeStore(tx.objectStore(STORE_INODES), tx.objectStore(STORE_COUNTERS)).forEachInode(inos, callback);
    }

    async walkTree(
        parentIno: number,
        callback: (inode: InodeRecord, depth: number) => boolean | 'skip' | Promise<boolean | 'skip'>,
        options?: InodeWalkOptions,
    ): Promise<void> {
        const tx = this.tx();
        return new IDBInodeStore(tx.objectStore(STORE_INODES), tx.objectStore(STORE_COUNTERS)).walkTree(parentIno, callback, options);
    }

    async hasChildren(parentIno: number): Promise<boolean> {
        const tx = this.tx();
        return new IDBInodeStore(tx.objectStore(STORE_INODES), tx.objectStore(STORE_COUNTERS)).hasChildren(parentIno);
    }
}

class StandaloneMetaStore implements IMetaStore {
    constructor(private readonly db: IDBDatabase) {}

    private tx(mode: IDBTransactionMode = 'readonly'): IDBTransaction {
        return this.db.transaction([STORE_META], mode);
    }

    private store(mode?: IDBTransactionMode): IDBMetaStore {
        return new IDBMetaStore(this.tx(mode).objectStore(STORE_META));
    }

    async putMeta(meta: import('@itookit/common').MetaRecord): Promise<void> {
        const tx = this.db.transaction([STORE_META], 'readwrite');
        await new IDBMetaStore(tx.objectStore(STORE_META)).putMeta(meta);
        await txDone(tx);
    }

    getMeta(ino: number) { return this.store().getMeta(ino); }

    async deleteMeta(ino: number): Promise<void> {
        const tx = this.db.transaction([STORE_META], 'readwrite');
        await new IDBMetaStore(tx.objectStore(STORE_META)).deleteMeta(ino);
        await txDone(tx);
    }

    async patchMeta(ino: number, partial: Partial<Omit<import('@itookit/common').MetaRecord, 'ino'>>): Promise<void> {
        const tx = this.db.transaction([STORE_META], 'readwrite');
        await new IDBMetaStore(tx.objectStore(STORE_META)).patchMeta(ino, partial);
        await txDone(tx);
    }

    forEachMeta(inos: number[], callback: (meta: import('@itookit/common').MetaRecord, index: number) => boolean | Promise<boolean>) { return this.store().forEachMeta(inos, callback); }
    getAllDistinctTags() { return this.store().getAllDistinctTags(); }
    walkByTag(tag: string, callback: (ino: number) => boolean | Promise<boolean>, options?: import('@itookit/common').MetaWalkOptions) { return this.store().walkByTag(tag, callback, options); }
    walkByMetadata(field: string, value: unknown, callback: (ino: number) => boolean | Promise<boolean>, options?: import('@itookit/common').MetaWalkOptions) { return this.store().walkByMetadata(field, value, callback, options); }
}

class StandaloneContentStore implements IContentStore {
    constructor(private readonly db: IDBDatabase) {}

    private tx(mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
        return this.db.transaction([STORE_CONTENT], mode).objectStore(STORE_CONTENT);
    }

    async putData(ref: string, data: ArrayBuffer): Promise<void> {
        const tx = this.db.transaction([STORE_CONTENT], 'readwrite');
        await new IDBContentStore(tx.objectStore(STORE_CONTENT)).putData(ref, data);
        await txDone(tx);
    }

    getData(ref: string) { return new IDBContentStore(this.tx()).getData(ref); }
    existsData(ref: string) { return new IDBContentStore(this.tx()).existsData(ref); }
    sizeData(ref: string) { return new IDBContentStore(this.tx()).sizeData(ref); }
    readRange(ref: string, offset: number, length: number) {
        return new IDBContentStore(this.tx()).readRange(ref, offset, length);
    }

    async deleteData(ref: string): Promise<void> {
        const tx = this.db.transaction([STORE_CONTENT], 'readwrite');
        await new IDBContentStore(tx.objectStore(STORE_CONTENT)).deleteData(ref);
        await txDone(tx);
    }

    async appendData(ref: string, data: ArrayBuffer): Promise<void> {
        const tx = this.db.transaction([STORE_CONTENT], 'readwrite');
        await new IDBContentStore(tx.objectStore(STORE_CONTENT)).appendData(ref, data);
        await txDone(tx);
    }
}

class StandaloneRecordStore implements IRecordStore {
    constructor(private readonly db: IDBDatabase) {}

    private ro(): IDBRecordStore {
        return new IDBRecordStore(this.db.transaction([STORE_RECORDS], 'readonly').objectStore(STORE_RECORDS));
    }

    getRecordField(ino: number, field: string) { return this.ro().getRecordField(ino, field); }
    queryRecordFields(ino: number, query: import('@itookit/common').RecordQuery, options?: import('@itookit/common').RecordQueryOptions) {
        return this.ro().queryRecordFields(ino, query, options);
    }
    walkRecordFields(ino: number, callback: (field: string, value: import('@itookit/common').RecordValue) => boolean | Promise<boolean>, options?: import('@itookit/common').RecordWalkOptions) {
        return this.ro().walkRecordFields(ino, callback, options);
    }
    walkRecordFieldNames(ino: number, callback: (field: string) => boolean | Promise<boolean>, options?: { prefix?: string; limit?: number }) {
        return this.ro().walkRecordFieldNames(ino, callback, options);
    }

    async setRecordField(ino: number, field: string, value: import('@itookit/common').RecordValue): Promise<void> {
        const tx = this.db.transaction([STORE_RECORDS], 'readwrite');
        await new IDBRecordStore(tx.objectStore(STORE_RECORDS)).setRecordField(ino, field, value);
        await txDone(tx);
    }

    async deleteRecordField(ino: number, field: string): Promise<void> {
        const tx = this.db.transaction([STORE_RECORDS], 'readwrite');
        await new IDBRecordStore(tx.objectStore(STORE_RECORDS)).deleteRecordField(ino, field);
        await txDone(tx);
    }

    async setAllRecordFields(ino: number, fields: Record<string, import('@itookit/common').RecordValue>): Promise<void> {
        const tx = this.db.transaction([STORE_RECORDS], 'readwrite');
        await new IDBRecordStore(tx.objectStore(STORE_RECORDS)).setAllRecordFields(ino, fields);
        await txDone(tx);
    }

    async clearRecordFields(ino: number): Promise<void> {
        const tx = this.db.transaction([STORE_RECORDS], 'readwrite');
        await new IDBRecordStore(tx.objectStore(STORE_RECORDS)).clearRecordFields(ino);
        await txDone(tx);
    }

    createRecordIndex(ino: number, field: string) { return this.ro().createRecordIndex(ino, field); }
    deleteRecordIndex(ino: number, field: string) { return this.ro().deleteRecordIndex(ino, field); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main backend
// ─────────────────────────────────────────────────────────────────────────────

export class IndexedDBBackend implements IStorageBackend {
    readonly name = 'indexeddb';

    readonly inodes: IInodeStore;
    readonly meta: IMetaStore;
    readonly content: IContentStore;
    readonly records: IRecordStore;

    private db: IDBDatabase | null = null;
    private readonly dbName: string;

    constructor(options?: IndexedDBBackendOptions) {
        this.dbName = options?.dbName ?? 'vfs';

        // Placeholder stores — replaced in init() with live instances.
        // Use Promise.reject so callers can use .rejects in async tests.
        const noDb = (): Promise<never> => Promise.reject(
            new Error('IndexedDBBackend not initialized — call init() first'),
        );
        this.inodes = { allocateIno: noDb, putInode: noDb, getInode: noDb, lookup: noDb, forEachInode: noDb, deleteInode: noDb, updateInode: noDb, walkTree: noDb, hasChildren: noDb };
        this.meta = { putMeta: noDb, getMeta: noDb, deleteMeta: noDb, patchMeta: noDb, forEachMeta: noDb, getAllDistinctTags: noDb, walkByTag: noDb, walkByMetadata: noDb };
        this.content = { putData: noDb, getData: noDb, deleteData: noDb, existsData: noDb, sizeData: noDb };
        this.records = { getRecordField: noDb, setRecordField: noDb, deleteRecordField: noDb, setAllRecordFields: noDb, clearRecordFields: noDb, createRecordIndex: noDb, deleteRecordIndex: noDb, queryRecordFields: noDb, walkRecordFields: noDb, walkRecordFieldNames: noDb };
    }

    async init(): Promise<void> {
        if (this.db) return;

        this.db = await openDB(this.dbName, DB_VERSION, (db, oldVersion) => {
            if (oldVersion < 1) {
                createInodeStore(db);
                createCounterStore(db);
                createMetaStore(db);
                createContentStore(db);
                createRecordStore(db);
            }
        });

        // Seed the ino counter if this is a fresh database
        await this.seedCounter();

        // Replace placeholder stores with live instances
        const db = this.db;
        Object.assign(this, {
            inodes: new StandaloneInodeStore(db),
            meta: new StandaloneMetaStore(db),
            content: new StandaloneContentStore(db),
            records: new StandaloneRecordStore(db),
        });
    }

    async close(): Promise<void> {
        this.db?.close();
        this.db = null;
    }

    async runInTransaction<T>(
        mode: 'readonly' | 'readwrite',
        fn: (scope: ITransactionScope) => Promise<T>,
    ): Promise<T> {
        const db = this.assertOpen();
        const idbMode = mode === 'readwrite' ? 'readwrite' : 'readonly';
        const tx = db.transaction([...ALL_STORES], idbMode);

        // Register completion handlers BEFORE starting the async work so
        // oncomplete is never missed even if fn() resolves synchronously.
        const done = txDone(tx);
        const scope = makeTxScope(tx);

        try {
            const result = await fn(scope);
            await done;
            return result;
        } catch (e) {
            try { tx.abort(); } catch { /* already completed or aborted */ }
            // Suppress the AbortError that txDone will emit after tx.abort() —
            // we are already throwing the original error below.
            done.catch(() => { /* swallow AbortError */ });
            throw e;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private assertOpen(): IDBDatabase {
        if (!this.db) throw new Error('IndexedDBBackend is not open — call init() first');
        return this.db;
    }

    private async seedCounter(): Promise<void> {
        const db = this.db!;
        const tx = db.transaction([STORE_COUNTERS], 'readwrite');
        const store = tx.objectStore(STORE_COUNTERS);
        const existing = await req<{ name: string; value: number } | undefined>(
            store.get(COUNTER_INO),
        );
        if (!existing) {
            // Seed with ROOT_INO so allocateIno() returns ROOT_INO + 1 = 2 first
            await req(store.put({ name: COUNTER_INO, value: ROOT_INO }));
        }
        await txDone(tx);
    }
}
