import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDBBackend, DB_VERSION } from '../src/index';
const names: string[] = [];
afterEach(async () => { for (const name of names.splice(0)) await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); }); });
describe('IndexedDB storage version', () => {
    it('adds the type-only index to an existing v4 database', async () => {
        const name = crypto.randomUUID(); names.push(name);
        const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(name, 4);
            request.onupgradeneeded = () => {
                const db = request.result;
                const nodes = db.createObjectStore('nodes', { keyPath: 'path' });
                nodes.createIndex('type', 'type'); nodes.createIndex('modifiedAt', 'modifiedAt');
                nodes.createIndex('parentPath', 'parentPath');
                const tags = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
                tags.createIndex('tag', 'tag'); tags.createIndex('path', 'path');
                const records = db.createObjectStore('records', { keyPath: ['path', 'field'] });
                records.createIndex('idx_path', 'path');
                nodes.put({ path: '/existing', parentPath: '/', type: 'directory', content: new ArrayBuffer(0),
                    size: 0, createdAt: 0, modifiedAt: 0, version: 1, tags: [], metadata: '{}' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        legacy.close();
        const backend = new IndexedDBBackend({ dbName: name });
        await backend.init();
        try { expect(await backend.statType('/existing')).toEqual({ type: 'directory' }); }
        finally { await backend.close(); }
    });

    it('backfills parent paths when upgrading a v3 database', async () => {
        const name = crypto.randomUUID(); names.push(name);
        const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(name, 3);
            request.onupgradeneeded = () => {
                const db = request.result;
                const nodes = db.createObjectStore('nodes', { keyPath: 'path' });
                nodes.createIndex('type', 'type'); nodes.createIndex('modifiedAt', 'modifiedAt');
                const tags = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
                tags.createIndex('tag', 'tag'); tags.createIndex('path', 'path');
                const records = db.createObjectStore('records', { keyPath: ['path', 'field'] });
                records.createIndex('idx_path', 'path');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        await new Promise<void>((resolve, reject) => {
            const tx = legacy.transaction('nodes', 'readwrite');
            for (const path of ['/tasks', '/tasks/a', '/tasks/a/task.seq', '/tasks-other']) {
                tx.objectStore('nodes').put({ path, type: path.endsWith('.seq') ? 'file' : 'directory',
                    content: new ArrayBuffer(0), size: 0, createdAt: 0, modifiedAt: 0, version: 1,
                    tags: [], metadata: '{}' });
            }
            tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
        });
        legacy.close();
        const backend = new IndexedDBBackend({ dbName: name });
        await backend.init();
        try {
            expect((await backend.listEntries('/tasks')).map(entry => entry.path)).toEqual(['/tasks/a']);
            expect(await backend.statType('/tasks/a/task.seq')).toEqual({ type: 'file' });
            await backend.rename('/tasks/a', '/tasks/b');
            expect((await backend.listEntries('/tasks')).map(entry => entry.path)).toEqual(['/tasks/b']);
            expect(await backend.statType('/tasks/b/task.seq')).toEqual({ type: 'file' });
        } finally { await backend.close(); }
    });

    it('rejects old schemas without upgrading or rewriting them', async () => {
        const name = crypto.randomUUID(); names.push(name);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open(name, DB_VERSION - 1);
            r.onupgradeneeded = () => r.result.createObjectStore('obsolete');
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
        db.close();
        await expect(new IndexedDBBackend({ dbName: name }).init()).rejects.toThrow('version incompatible');
        const old = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); });
        expect(old.version).toBe(DB_VERSION - 1); expect([...old.objectStoreNames]).toEqual(['obsolete']); old.close();
    });
    it('persists and reopens the current record schema', async () => {
        const name = crypto.randomUUID(); names.push(name);
        const first = new IndexedDBBackend({ dbName: name }); await first.init();
        await first.records.setRecordField('/session.seq', 'session', 'current'); await first.close();
        const second = new IndexedDBBackend({ dbName: name }); await second.init();
        expect(await second.records.getRecordField('/session.seq', 'session')).toBe('current'); await second.close();
    });
});
