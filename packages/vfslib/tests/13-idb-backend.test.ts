/**
 * IndexedDB-specific backend tests:
 * - init/close lifecycle
 * - runInTransaction ACID guarantees
 * - allocateIno correctness
 * - appendData / readRange on content store
 * - IRecordStore field operations and queries
 * - Persistence: data survives close + re-open
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { freshIDB } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Backend lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('IndexedDBBackend lifecycle', () => {
    it('init() opens the database without error', async () => {
        const backend = freshIDB('lc');
        await expect(backend.init()).resolves.not.toThrow();
        await backend.close();
    });

    it('init() is idempotent', async () => {
        const backend = freshIDB('idem');
        await backend.init();
        await expect(backend.init()).resolves.not.toThrow();
        await backend.close();
    });

    it('close() shuts the database without error', async () => {
        const backend = freshIDB('cl');
        await backend.init();
        await expect(backend.close()).resolves.not.toThrow();
    });

    it('throws if used before init()', async () => {
        const backend = freshIDB('noinit');
        await expect(backend.inodes.allocateIno()).rejects.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// IInodeStore
// ─────────────────────────────────────────────────────────────────────────────

describe('IDBInodeStore', () => {
    let backend: IndexedDBBackend;
    beforeEach(async () => {
        backend = freshIDB('inode');
        await backend.init();
    });
    afterEach(async () => { await backend.close(); });

    it('allocateIno returns incrementing numbers starting at 2', async () => {
        const a = await backend.inodes.allocateIno();
        const b = await backend.inodes.allocateIno();
        expect(a).toBeGreaterThanOrEqual(2);
        expect(b).toBe(a + 1);
    });

    it('putInode / getInode round-trip', async () => {
        const ino = await backend.inodes.allocateIno();
        const rec = { ino, parentIno: 1, name: 'test.txt', type: 'file' as const, createdAt: Date.now(), nlink: 1 };
        await backend.inodes.putInode(rec);
        const got = await backend.inodes.getInode(ino);
        expect(got).toMatchObject({ ino, name: 'test.txt', type: 'file' });
    });

    it('getInode returns null for unknown ino', async () => {
        expect(await backend.inodes.getInode(99999)).toBeNull();
    });

    it('lookup finds child by parentIno + name', async () => {
        const parentIno = 1;
        const ino = await backend.inodes.allocateIno();
        await backend.inodes.putInode({ ino, parentIno, name: 'find-me.txt', type: 'file', createdAt: Date.now(), nlink: 1 });
        const found = await backend.inodes.lookup(parentIno, 'find-me.txt');
        expect(found?.ino).toBe(ino);
    });

    it('lookup returns null for wrong name', async () => {
        expect(await backend.inodes.lookup(1, 'no-such.txt')).toBeNull();
    });

    it('walkTree(maxDepth:0) returns all direct children of a parent', async () => {
        const parentIno = 42;
        for (let i = 0; i < 3; i++) {
            const ino = await backend.inodes.allocateIno();
            await backend.inodes.putInode({ ino, parentIno, name: `child${i}.txt`, type: 'file', createdAt: Date.now(), nlink: 1 });
        }
        const children: import('@itookit/common').InodeRecord[] = [];
        await backend.inodes.walkTree(parentIno, (inode) => { children.push(inode); return true; }, { maxDepth: 0 });
        expect(children).toHaveLength(3);
    });

    it('deleteInode removes the record', async () => {
        const ino = await backend.inodes.allocateIno();
        await backend.inodes.putInode({ ino, parentIno: 1, name: 'del.txt', type: 'file', createdAt: Date.now(), nlink: 1 });
        await backend.inodes.deleteInode(ino);
        expect(await backend.inodes.getInode(ino)).toBeNull();
    });

    it('updateInode patches parentIno and name', async () => {
        const ino = await backend.inodes.allocateIno();
        await backend.inodes.putInode({ ino, parentIno: 1, name: 'old.txt', type: 'file', createdAt: Date.now(), nlink: 1 });
        await backend.inodes.updateInode(ino, { name: 'new.txt', parentIno: 2 });
        const updated = await backend.inodes.getInode(ino);
        expect(updated?.name).toBe('new.txt');
        expect(updated?.parentIno).toBe(2);
    });

    it('forEachInode visits existing inodes and skips missing', async () => {
        const ino1 = await backend.inodes.allocateIno();
        const ino2 = await backend.inodes.allocateIno();
        await backend.inodes.putInode({ ino: ino1, parentIno: 1, name: 'a.txt', type: 'file', createdAt: Date.now(), nlink: 1 });
        await backend.inodes.putInode({ ino: ino2, parentIno: 1, name: 'b.txt', type: 'file', createdAt: Date.now(), nlink: 1 });
        const visited: number[] = [];
        await backend.inodes.forEachInode([ino1, ino2, 99999], (inode) => { visited.push(inode.ino); return true; });
        expect(visited).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// IMetaStore
// ─────────────────────────────────────────────────────────────────────────────

describe('IDBMetaStore', () => {
    let backend: IndexedDBBackend;
    beforeEach(async () => { backend = freshIDB('meta'); await backend.init(); });
    afterEach(async () => { await backend.close(); });

    it('putMeta / getMeta round-trip', async () => {
        const meta = { ino: 100, modifiedAt: Date.now(), size: 42, version: 0, tags: ['a', 'b'] };
        await backend.meta.putMeta(meta);
        const got = await backend.meta.getMeta(100);
        expect(got?.tags).toEqual(['a', 'b']);
        expect(got?.size).toBe(42);
    });

    it('getMeta returns null for unknown ino', async () => {
        expect(await backend.meta.getMeta(99999)).toBeNull();
    });

    it('deleteMeta removes record', async () => {
        await backend.meta.putMeta({ ino: 200, modifiedAt: Date.now(), size: 0, version: 0 });
        await backend.meta.deleteMeta(200);
        expect(await backend.meta.getMeta(200)).toBeNull();
    });

    it('patchMeta merges partial fields', async () => {
        await backend.meta.putMeta({ ino: 300, modifiedAt: 0, size: 0, version: 0, tags: ['old'] });
        await backend.meta.patchMeta(300, { tags: ['new'], version: 1 });
        const got = await backend.meta.getMeta(300);
        expect(got?.tags).toEqual(['new']);
        expect(got?.version).toBe(1);
    });

    it('walkByTag visits matching inos', async () => {
        await backend.meta.putMeta({ ino: 401, modifiedAt: Date.now(), size: 0, version: 0, tags: ['vip'] });
        await backend.meta.putMeta({ ino: 402, modifiedAt: Date.now(), size: 0, version: 0, tags: ['vip', 'other'] });
        await backend.meta.putMeta({ ino: 403, modifiedAt: Date.now(), size: 0, version: 0, tags: ['other'] });
        const vips: number[] = [];
        await backend.meta.walkByTag('vip', (ino) => { vips.push(ino); return true; });
        expect(vips.sort()).toEqual([401, 402]);
    });

    it('walkByMetadata finds matching records', async () => {
        await backend.meta.putMeta({ ino: 501, modifiedAt: Date.now(), size: 0, version: 0, metadata: { color: 'red' } as any });
        await backend.meta.putMeta({ ino: 502, modifiedAt: Date.now(), size: 0, version: 0, metadata: { color: 'blue' } as any });
        const reds: number[] = [];
        await backend.meta.walkByMetadata('color', 'red', (ino) => { reds.push(ino); return true; });
        expect(reds).toEqual([501]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// IContentStore
// ─────────────────────────────────────────────────────────────────────────────

describe('IDBContentStore', () => {
    let backend: IndexedDBBackend;
    beforeEach(async () => { backend = freshIDB('content'); await backend.init(); });
    afterEach(async () => { await backend.close(); });

    const ref = 'content-ref-1';
    const encode = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
    const decode = (b: ArrayBuffer) => new TextDecoder().decode(b);

    it('putData / getData round-trip', async () => {
        await backend.content.putData(ref, encode('hello world'));
        const data = await backend.content.getData(ref);
        expect(decode(data!)).toBe('hello world');
    });

    it('getData returns null for unknown ref', async () => {
        expect(await backend.content.getData('ghost-ref')).toBeNull();
    });

    it('existsData returns true/false', async () => {
        expect(await backend.content.existsData(ref)).toBe(false);
        await backend.content.putData(ref, encode('x'));
        expect(await backend.content.existsData(ref)).toBe(true);
    });

    it('sizeData returns byte length', async () => {
        const data = encode('12345'); // 5 bytes
        await backend.content.putData(ref, data);
        expect(await backend.content.sizeData(ref)).toBe(5);
    });

    it('deleteData removes content', async () => {
        await backend.content.putData(ref, encode('del'));
        await backend.content.deleteData(ref);
        expect(await backend.content.getData(ref)).toBeNull();
    });

    it('readRange returns a slice of the content', async () => {
        await backend.content.putData(ref, encode('ABCDEFGH'));
        const slice = await backend.content.readRange!(ref, 2, 4);
        expect(decode(slice!)).toBe('CDEF');
    });

    it('appendData appends bytes to existing content', async () => {
        await backend.content.putData(ref, encode('Hello'));
        await backend.content.appendData!(ref, encode(' World'));
        const full = await backend.content.getData(ref);
        expect(decode(full!)).toBe('Hello World');
    });

    it('appendData creates content if ref does not exist', async () => {
        await backend.content.appendData!('new-ref', encode('fresh'));
        const data = await backend.content.getData('new-ref');
        expect(decode(data!)).toBe('fresh');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// IRecordStore
// ─────────────────────────────────────────────────────────────────────────────

describe('IDBRecordStore', () => {
    let backend: IndexedDBBackend;
    beforeEach(async () => { backend = freshIDB('record'); await backend.init(); });
    afterEach(async () => { await backend.close(); });

    it('setRecordField / getRecordField round-trip', async () => {
        await backend.records!.setRecordField(1, 'name', 'alice');
        expect(await backend.records!.getRecordField(1, 'name')).toBe('alice');
    });

    it('getRecordField returns undefined for missing field', async () => {
        expect(await backend.records!.getRecordField(1, 'ghost')).toBeUndefined();
    });

    it('deleteRecordField removes a field', async () => {
        await backend.records!.setRecordField(1, 'age', 30);
        await backend.records!.deleteRecordField(1, 'age');
        expect(await backend.records!.getRecordField(1, 'age')).toBeUndefined();
    });

    it('walkRecordFields returns all key-value pairs', async () => {
        await backend.records!.setRecordField(2, 'x', 'val-x');
        await backend.records!.setRecordField(2, 'y', 'val-y');
        const all: Record<string, import('@itookit/common').RecordValue> = {};
        await backend.records!.walkRecordFields(2, (f, v) => { all[f] = v; return true; });
        expect(all).toMatchObject({ x: 'val-x', y: 'val-y' });
    });

    it('setAllRecordFields replaces all fields atomically', async () => {
        await backend.records!.setRecordField(3, 'old', 'v');
        await backend.records!.setAllRecordFields(3, { new1: 'a', new2: 'b' });
        const all: Record<string, import('@itookit/common').RecordValue> = {};
        await backend.records!.walkRecordFields(3, (f, v) => { all[f] = v; return true; });
        expect(Object.keys(all)).not.toContain('old');
        expect(all.new1).toBe('a');
    });

    it('clearRecordFields removes all fields for an ino', async () => {
        await backend.records!.setRecordField(4, 'k1', 'v1');
        await backend.records!.setRecordField(4, 'k2', 'v2');
        await backend.records!.clearRecordFields(4);
        const count = await backend.records!.walkRecordFieldNames(4, () => true);
        expect(count).toBe(0);
    });

    it('walkRecordFieldNames returns field names', async () => {
        await backend.records!.setRecordField(5, 'a', 1);
        await backend.records!.setRecordField(5, 'b', 2);
        const fields: string[] = [];
        await backend.records!.walkRecordFieldNames(5, (f) => { fields.push(f); return true; });
        expect(fields.sort()).toEqual(['a', 'b']);
    });

    it('different inos have independent field namespaces', async () => {
        await backend.records!.setRecordField(10, 'k', 'ino10');
        await backend.records!.setRecordField(11, 'k', 'ino11');
        expect(await backend.records!.getRecordField(10, 'k')).toBe('ino10');
        expect(await backend.records!.getRecordField(11, 'k')).toBe('ino11');
    });

    it('queryRecordFields with = operator', async () => {
        await backend.records!.setRecordField(20, 'status', 'active');
        await backend.records!.setRecordField(20, 'type', 'user');
        const results = await backend.records!.queryRecordFields(20, { field: 'status', operator: '=', value: 'active' });
        expect(results).toHaveLength(1);
        expect(results[0].value).toBe('active');
    });

    it('queryRecordFields with in operator', async () => {
        await backend.records!.setRecordField(21, 'color', 'red');
        const results = await backend.records!.queryRecordFields(21, {
            field: 'color', operator: 'in', value: ['red', 'blue'],
        });
        expect(results).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// runInTransaction (ACID semantics)
// ─────────────────────────────────────────────────────────────────────────────

describe('IndexedDBBackend.runInTransaction', () => {
    let backend: IndexedDBBackend;
    beforeEach(async () => { backend = freshIDB('tx'); await backend.init(); });
    afterEach(async () => { await backend.close(); });

    it('all writes in tx are visible after commit', async () => {
        await backend.runInTransaction('readwrite', async (scope) => {
            const ino = await scope.inodes.allocateIno();
            await scope.inodes.putInode({ ino, parentIno: 1, name: 'tx.txt', type: 'file', createdAt: Date.now(), nlink: 1 });
            await scope.meta.putMeta({ ino, modifiedAt: Date.now(), size: 5, version: 0 });
            await scope.content.putData(String(ino), new TextEncoder().encode('hello').buffer as ArrayBuffer);
        });
        const children: import('@itookit/common').InodeRecord[] = [];
        await backend.inodes.walkTree(1, (inode) => { children.push(inode); return true; }, { maxDepth: 0 });
        expect(children.some(c => c.name === 'tx.txt')).toBe(true);
    });

    it('readonly transaction can read committed data', async () => {
        const ino = await backend.inodes.allocateIno();
        await backend.inodes.putInode({ ino, parentIno: 1, name: 'ro.txt', type: 'file', createdAt: Date.now(), nlink: 1 });
        const found = await backend.runInTransaction('readonly', async (scope) => {
            return scope.inodes.getInode(ino);
        });
        expect(found?.name).toBe('ro.txt');
    });

    it('tx aborts on error, leaving store unchanged', async () => {
        const collectChildren = async () => {
            const items: import('@itookit/common').InodeRecord[] = [];
            await backend.inodes.walkTree(1, (inode) => { items.push(inode); return true; }, { maxDepth: 0 });
            return items;
        };
        const before = await collectChildren();
        try {
            await backend.runInTransaction('readwrite', async (scope) => {
                const ino = await scope.inodes.allocateIno();
                await scope.inodes.putInode({ ino, parentIno: 1, name: 'fail.txt', type: 'file', createdAt: Date.now(), nlink: 1 });
                throw new Error('abort!');
            });
        } catch { /* expected */ }
        const after = await collectChildren();
        // With IDB, the failed transaction is rolled back
        expect(after.length).toBe(before.length);
    });
});
