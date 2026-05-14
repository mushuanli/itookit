/**
 * @file vfsdriver-indexeddb/src/index.ts
 * v4.1: Path-based IndexedDB storage backend.
 */

export { IndexedDBBackend, type IndexedDBBackendOptions } from './idb-backend';
export { IDBRecordStore } from './record-store';

export {
    openDB, req, collectCursor, txDone,
    ALL_STORES, DB_VERSION, STORE_NODES, STORE_RECORDS, STORE_TAGS,
} from './utils';
