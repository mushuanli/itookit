/**
 * @file llmdriver-indexeddb/src/index.ts
 * @desc @itookit/llmdriver-indexeddb — IndexedDB VFS storage backend
 *
 * Usage:
 *   import { IndexedDBBackend } from '@itookit/llmdriver-indexeddb';
 *   import { createVFS } from '@itookit/vfslib';
 *
 *   const vfs = await createVFS({
 *     rootBackend: new IndexedDBBackend({ dbName: 'my-app-vfs' }),
 *   });
 */

export { IndexedDBBackend, type IndexedDBBackendOptions } from './idb-backend';

// Store implementation classes (useful for custom wiring)
export { IDBInodeStore } from './inode-store';
export { IDBMetaStore } from './meta-store';
export { IDBContentStore } from './content-store';
export { IDBRecordStore } from './record-store';

// Low-level utilities (useful for custom upgrade handlers)
export {
    openDB,
    txDone,
    req,
    collectCursor,
    ALL_STORES,
    DB_VERSION,
    ROOT_INO,
    STORE_INODES,
    STORE_META,
    STORE_CONTENT,
    STORE_RECORDS,
    STORE_COUNTERS,
} from './utils';
