/**
 * @file vfsdriver-indexeddb/src/utils.ts
 * v4.1: path-based IDB stores. Single nodes store replaces inodes/meta/content split.
 */

export const STORE_NODES = 'nodes';
export const STORE_RECORDS = 'records';
export const STORE_TAGS = 'tags';

export const ALL_STORES = [STORE_NODES, STORE_RECORDS, STORE_TAGS] as const;
export const REQUIRED_STORES = [STORE_NODES, STORE_TAGS, STORE_RECORDS] as readonly string[];
export const DB_VERSION = 2;

// ── IDB Promise Wrappers ────────────────────────────────────────────

export type UpgradeHandler = (db: IDBDatabase, transaction: IDBTransaction) => void;

export function openDB(
    name: string,
    version: number | undefined,
    upgrade: UpgradeHandler,
): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = version === undefined
            ? indexedDB.open(name)
            : indexedDB.open(name, version);
        request.onupgradeneeded = () => {
            if (!request.transaction) {
                reject(new Error('IndexedDB upgrade transaction is unavailable'));
                return;
            }
            upgrade(request.result, request.transaction);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(
            request.error ?? new Error(`Failed to open IndexedDB "${name}"`),
        );
    });
}

export function txDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

export function req<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function deleteCursor(
    req: IDBRequest<IDBCursorWithValue | null>,
    predicate: (cursor: IDBCursorWithValue) => boolean = () => true,
): Promise<void> {
    const cursor = await new Promise<IDBCursorWithValue | null>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    if (cursor) {
        if (predicate(cursor)) cursor.delete();
        cursor.continue();
        await deleteCursor(req, predicate);
    }
}

export function collectCursor<T>(
    req: IDBRequest<IDBCursorWithValue | null>,
    mapper: (cursor: IDBCursorWithValue) => T,
): Promise<T[]> {
    const results: T[] = [];
    return new Promise((resolve, reject) => {
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) { results.push(mapper(cursor)); cursor.continue(); }
            else resolve(results);
        };
        req.onerror = () => reject(req.error);
    });
}
