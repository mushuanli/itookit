import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDBBackend, DB_VERSION } from '../src/index';
const names: string[] = [];
afterEach(async () => { for (const name of names.splice(0)) await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); }); });
describe('IndexedDB storage version', () => {
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
