import { afterEach, describe, expect, it } from 'vitest';
import {
    IDBRecordStore,
    IndexedDBBackend,
    STORE_NODES,
    STORE_RECORDS,
    STORE_TAGS,
} from '../src/index';

const databases: string[] = [];

afterEach(async () => {
    await Promise.all(databases.splice(0).map(deleteDatabase));
});

describe('IndexedDB schema migration', () => {
    it('adds missing indexes without deleting existing data', async () => {
        const dbName = uniqueDatabaseName('missing-index');
        const legacy = await createLegacyDatabase(dbName);
        legacy.close();

        const backend = new IndexedDBBackend({ dbName });
        await backend.init();

        expect(await backend.stat('/keep')).not.toBeNull();
        expect(await backend.records.getRecordField('/seq', 'title')).toBe('preserved');
        await backend.close();

        expect(await getIndexNames(dbName, STORE_RECORDS)).toContain('idx_path');
        const reopened = new IndexedDBBackend({ dbName });
        await reopened.init();
        expect(await reopened.records.getRecordField('/seq', 'title')).toBe('preserved');
        await reopened.close();
    });

    it('walks and clears records when the path index is unavailable', async () => {
        const dbName = uniqueDatabaseName('cursor-fallback');
        const db = await createLegacyDatabase(dbName);
        const store = db.transaction(STORE_RECORDS, 'readwrite').objectStore(STORE_RECORDS);
        const records = new IDBRecordStore(store);
        const visited: string[] = [];

        await records.walkRecordFields('/seq', (field) => {
            visited.push(field);
            return true;
        });
        expect(visited).toEqual(['title']);

        const clearStore = db.transaction(STORE_RECORDS, 'readwrite').objectStore(STORE_RECORDS);
        await new IDBRecordStore(clearStore).clearRecordFields('/seq');
        const readStore = db.transaction(STORE_RECORDS, 'readonly').objectStore(STORE_RECORDS);
        expect(await new IDBRecordStore(readStore).getRecordField('/seq', 'title')).toBeUndefined();
        db.close();
    });
});

function uniqueDatabaseName(prefix: string): string {
    const name = `${prefix}-${Date.now()}-${Math.random()}`;
    databases.push(name);
    return name;
}

function createLegacyDatabase(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 2);
        request.onupgradeneeded = () => createLegacySchema(request.result);
        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            try {
                await seedLegacyData(request.result);
                resolve(request.result);
            } catch (error) {
                reject(error);
            }
        };
    });
}

function createLegacySchema(db: IDBDatabase): void {
    const nodes = db.createObjectStore(STORE_NODES, { keyPath: 'path' });
    nodes.createIndex('type', 'type');
    nodes.createIndex('modifiedAt', 'modifiedAt');
    const tags = db.createObjectStore(STORE_TAGS, { keyPath: 'id', autoIncrement: true });
    tags.createIndex('tag', 'tag');
    tags.createIndex('path', 'path');
    db.createObjectStore(STORE_RECORDS, { keyPath: ['path', 'field'] });
}

function seedLegacyData(db: IDBDatabase): Promise<void> {
    const transaction = db.transaction([STORE_NODES, STORE_RECORDS], 'readwrite');
    transaction.objectStore(STORE_NODES).put({
        path: '/keep',
        type: 'directory',
        content: new ArrayBuffer(0),
        size: 0,
        createdAt: 1,
        modifiedAt: 1,
        tags: [],
        metadata: '{}',
    });
    transaction.objectStore(STORE_RECORDS).put({
        path: '/seq',
        field: 'title',
        value: 'preserved',
    });
    return transactionDone(transaction);
}

async function getIndexNames(dbName: string, storeName: string): Promise<string[]> {
    const db = await openCurrentDatabase(dbName);
    const names = Array.from(
        db.transaction(storeName, 'readonly').objectStore(storeName).indexNames,
    );
    db.close();
    return names;
}

function openCurrentDatabase(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
}

function deleteDatabase(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}
