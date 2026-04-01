/**
 * @file vfsdriver-fs/src/fs-backend.ts
 * @desc FsBackend — IStorageBackend backed by OS filesystem + SQLite.
 *
 * Directory layout under `rootDir`:
 *
 *   <rootDir>/
 *   └── .meta/
 *       ├── meta.db        ← Single SQLite: inodes, meta, inode_tags, records
 *       ├── meta.db-wal    ← WAL (auto-managed)
 *       ├── meta.db-shm    ← Shared memory (auto-managed)
 *       ├── content/       ← Binary content files named by `contentRef`
 *       │   ├── 1
 *       │   ├── 2
 *       │   └── ...
 *       └── tmp/           ← Temporary files for atomic writes (cleaned on init)
 *
 * Transaction semantics:
 *   runInTransaction serialises transactions via a Promise queue.
 *   Inside the transaction, SQLite changes are wrapped in BEGIN...COMMIT.
 *   Content writes use the tmp → rename pattern independently.
 *   In the worst-case crash scenario (SQLite committed, rename not yet done)
 *   the startup GC/verifyContentRefs routine detects and reports the gap.
 */

import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
    IStorageBackend,
    ITransactionScope,
    IInodeStore,
    IMetaStore,
    IContentStore,
    IRecordStore,
} from '@itookit/common';

import { openDatabase, closeDatabase } from './db/connection';
import { FsInodeStore }   from './stores/fs-inode-store';
import { FsMetaStore }    from './stores/fs-meta-store';
import { FsContentStore } from './stores/fs-content-store';
import { FsRecordStore }  from './stores/fs-record-store';
import { cleanTmpFiles, verifyContentRefs, gcOrphanedContent } from './utils/startup';
import { ensureDir } from './utils/atomic-write';

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

export interface FsBackendOptions {
    /**
     * Root directory where VFS data is stored.
     * The `.meta/` subdirectory is managed automatically.
     */
    rootDir: string;

    /**
     * Run a lightweight content-ref integrity check on init.
     * Logs a warning for any contentRef that has no corresponding file.
     * @default false
     */
    verifyOnInit?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend
// ─────────────────────────────────────────────────────────────────────────────

export class FsBackend implements IStorageBackend {
    readonly name = 'fs';

    // Public stores — placeholder until init() completes
    inodes: IInodeStore;
    meta:   IMetaStore;
    content: IContentStore;
    records: IRecordStore;

    private db: Database.Database | null = null;
    private _scope: ITransactionScope | null = null;
    private txQueue: Promise<unknown> = Promise.resolve();

    private readonly rootDir: string;
    private readonly metaDir: string;
    private readonly contentDir: string;
    private readonly tmpDir: string;
    private readonly dbPath: string;
    private readonly verifyOnInit: boolean;

    constructor(options: FsBackendOptions) {
        this.rootDir    = path.resolve(options.rootDir);
        this.metaDir    = path.join(this.rootDir, '.meta');
        this.contentDir = path.join(this.metaDir, 'content');
        this.tmpDir     = path.join(this.metaDir, 'tmp');
        this.dbPath     = path.join(this.metaDir, 'meta.db');
        this.verifyOnInit = options.verifyOnInit ?? false;

        // Placeholder stores that reject until init() is called
        const noInit = (): Promise<never> =>
            Promise.reject(new Error('FsBackend not initialised — call init() first'));

        this.inodes  = { allocateIno: noInit, putInode: noInit, getInode: noInit, lookup: noInit, forEachInode: noInit, deleteInode: noInit, updateInode: noInit, walkTree: noInit, hasChildren: noInit };
        this.meta    = { putMeta: noInit, getMeta: noInit, deleteMeta: noInit, patchMeta: noInit, forEachMeta: noInit, getAllDistinctTags: noInit, walkByTag: noInit, walkByMetadata: noInit };
        this.content = { putData: noInit, getData: noInit, deleteData: noInit, existsData: noInit, sizeData: noInit };
        this.records = { getRecordField: noInit, setRecordField: noInit, deleteRecordField: noInit, setAllRecordFields: noInit, clearRecordFields: noInit, createRecordIndex: noInit, deleteRecordIndex: noInit, queryRecordFields: noInit, walkRecordFields: noInit, walkRecordFieldNames: noInit };
    }

    async init(): Promise<void> {
        if (this.db) return; // Idempotent

        // Create directory structure
        await ensureDir(this.contentDir);
        await ensureDir(this.tmpDir);

        // Open / migrate SQLite
        this.db = openDatabase(this.dbPath);

        // Startup recovery: delete orphaned tmp files
        await cleanTmpFiles(this.tmpDir);

        // Optional integrity check
        if (this.verifyOnInit) {
            await verifyContentRefs(this.db, this.contentDir);
        }

        // Instantiate live stores
        const inodesStore  = new FsInodeStore(this.db);
        const metaStore    = new FsMetaStore(this.db);
        const contentStore = new FsContentStore(this.contentDir, this.tmpDir);
        const recordsStore = new FsRecordStore(this.db);

        Object.assign(this, {
            inodes:  inodesStore,
            meta:    metaStore,
            content: contentStore,
            records: recordsStore,
        });

        this._scope = {
            inodes:  inodesStore,
            meta:    metaStore,
            content: contentStore,
            records: recordsStore,
        };
    }

    async close(): Promise<void> {
        if (!this.db) return;
        closeDatabase(this.db);
        this.db = null;
        this._scope = null;
    }

    async runInTransaction<T>(
        mode: 'readonly' | 'readwrite',
        fn: (scope: ITransactionScope) => Promise<T>,
    ): Promise<T> {
        // Serialise: queue this transaction after any in-flight one
        const result = this.txQueue.then(() => this._execTx(mode, fn));
        // Attach a catch so failures don't break the queue
        this.txQueue = result.catch(() => undefined);
        return result;
    }

    // ── Public utilities ─────────────────────────────────────────────────────

    /**
     * Remove orphaned content files (files without a corresponding meta.contentRef).
     * This is an expensive operation — run it infrequently (e.g., on user request).
     */
    async gc(): Promise<{ deleted: number }> {
        const db = this.assertOpen();
        const deleted = await gcOrphanedContent(db, this.contentDir);
        return { deleted };
    }

    /** Full path to the SQLite database file (for backup tools). */
    get dbFilePath(): string { return this.dbPath; }

    // ── Private ──────────────────────────────────────────────────────────────

    private async _execTx<T>(
        mode: 'readonly' | 'readwrite',
        fn: (scope: ITransactionScope) => Promise<T>,
    ): Promise<T> {
        const db = this.assertOpen();
        const scope = this._scope!;

        // Begin transaction (IMMEDIATE prevents SQLITE_BUSY on first write)
        const beginSql = mode === 'readwrite' ? 'BEGIN IMMEDIATE' : 'BEGIN';
        db.prepare(beginSql).run();

        try {
            const result = await fn(scope);
            db.prepare('COMMIT').run();
            return result;
        } catch (e) {
            try { db.prepare('ROLLBACK').run(); } catch { /* ignore */ }
            throw e;
        }
    }

    private assertOpen(): Database.Database {
        if (!this.db) throw new Error('FsBackend is not open — call init() first');
        return this.db;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory shorthand
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and initialise an FsBackend in one call.
 *
 * @example
 * ```ts
 * const vfs = await createVFS({
 *   rootBackend: await openFsBackend({ rootDir: '/data/my-vault' }),
 * });
 * ```
 */
export async function openFsBackend(options: FsBackendOptions): Promise<FsBackend> {
    const backend = new FsBackend(options);
    await backend.init();
    return backend;
}
