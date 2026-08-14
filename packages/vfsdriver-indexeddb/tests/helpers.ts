/**
 * Shared test helpers for @itookit/vfsdriver-indexeddb.
 * Each backend gets a unique dbName so tests never share state.
 */

import { IndexedDBBackend } from '../src/index';

let _dbSeq = 0;

/** Create a fresh IndexedDB backend with a unique database name. */
export function freshIDB(prefix = 'idb-test'): IndexedDBBackend {
    return new IndexedDBBackend({ dbName: prefix + '_' + Date.now() + '_' + (++_dbSeq) });
}
