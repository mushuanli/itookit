/**
 * @file llmdriver-indexeddb/src/utils.ts
 * @desc IndexedDB promise helpers and shared constants
 */

/** Object store names used by this backend. */
export const STORE_INODES = 'inodes';
export const STORE_META = 'meta';
export const STORE_CONTENT = 'content';
export const STORE_RECORDS = 'records';
export const STORE_COUNTERS = '_counters';

export const ALL_STORES = [
    STORE_INODES,
    STORE_META,
    STORE_CONTENT,
    STORE_RECORDS,
    STORE_COUNTERS,
] as const;

/** Current database schema version. Bump when adding stores or indexes. */
export const DB_VERSION = 1;

/** Reserved ino for the filesystem root. */
export const ROOT_INO = 1;

/** Counter key name for the inode allocator. */
export const COUNTER_INO = 'ino';

// ─────────────────────────────────────────────────────────────────────────────
// Promise wrappers
// ─────────────────────────────────────────────────────────────────────────────

/** Wrap an IDBRequest in a Promise. */
export function req<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** Wrap an IDBOpenDBRequest in a Promise, applying the upgrade handler. */
export function openDB(
    name: string,
    version: number,
    upgrade: (db: IDBDatabase, oldVersion: number) => void,
): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = (event) => {
            upgrade(request.result, event.oldVersion);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`IndexedDB blocked: ${name}`));
    });
}

/** Wait for an IDBTransaction to complete. */
export function txDone(tx: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new DOMException('Transaction aborted', 'AbortError'));
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Iterate a cursor and collect all values. */
export function collectCursor<T>(request: IDBRequest<IDBCursorWithValue | null>): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
        const results: T[] = [];
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
                results.push(cursor.value as T);
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

/** Iterate a cursor and collect only keys. */
export function collectKeyCursor(request: IDBRequest<IDBCursor | null>): Promise<IDBValidKey[]> {
    return new Promise<IDBValidKey[]>((resolve, reject) => {
        const keys: IDBValidKey[] = [];
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
                keys.push(cursor.key);
                cursor.continue();
            } else {
                resolve(keys);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

/** Delete all records matching a cursor request. */
export function deleteCursor(request: IDBRequest<IDBCursorWithValue | null>): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        let count = 0;
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
                cursor.delete();
                count++;
                cursor.continue();
            } else {
                resolve(count);
            }
        };
        request.onerror = () => reject(request.error);
    });
}
