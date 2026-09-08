/**
 * IndexedDB backend contract tests for the path-based storage model.
 */
import { describe, expect, it, vi } from 'vitest';
import { IndexedDBBackend } from '../src/index';
import { freshIDB } from './helpers';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe('tag association index', () => {
    it('keeps associations in sync with tag updates, subtree renames and deletion', async () => {
        const backend = freshIDB('tag-index');
        await backend.init();
        try {
            await backend.write('/folder/file.md', encoder.encode('content'));
            await backend.write('/folder-other/keep.md', encoder.encode('keep'));
            await backend.setTags('/folder/file.md', ['work', 'work']);
            await backend.setTags('/folder-other/keep.md', ['keep']);
            await backend.rename('/folder', '/moved');
            expect(await backend.listTagEntries()).toEqual(expect.arrayContaining([
                { path: '/moved/file.md', tag: 'work' }, { path: '/folder-other/keep.md', tag: 'keep' },
            ]));
            expect((await backend.listTagEntries()).length).toBe(2);
            await backend.setTags('/moved/file.md', ['done']);
            expect(await backend.getAllTags()).not.toContain('work');
            await backend.delete('/moved', { recursive: true });
            expect(await backend.listTagEntries()).toEqual([{ path: '/folder-other/keep.md', tag: 'keep' }]);
        } finally { await backend.close(); }
    });
});

describe('IndexedDBBackend lifecycle', () => {
    it('initializes idempotently and closes safely', async () => {
        const backend = freshIDB('lifecycle');
        await backend.init();
        await expect(backend.init()).resolves.not.toThrow();
        await expect(backend.close()).resolves.not.toThrow();
    });

    it('rejects operations before initialization', async () => {
        const backend = freshIDB('not-initialized');
        await expect(backend.stat('/missing')).rejects.toThrow('not initialized');
    });

    it('preserves files across backend instances', async () => {
        const dbName = uniqueName('persistence');
        const first = new IndexedDBBackend({ dbName });
        await first.init();
        await first.write('/persist.txt', encoder.encode('preserved'));
        await first.close();

        const second = new IndexedDBBackend({ dbName });
        await second.init();
        const content = await second.read('/persist.txt');
        expect(decoder.decode(content)).toBe('preserved');
        await second.close();
    });
});

describe('IndexedDBBackend records', () => {
    it('supports field operations without leaking records between paths', async () => {
        const backend = freshIDB('records');
        await backend.init();
        await backend.records.setRecordField('/a', 'status', 'open');
        await backend.records.setRecordField('/b', 'status', 'closed');

        expect(await backend.records.getRecordField('/a', 'status')).toBe('open');
        expect(await backend.records.getRecordField('/b', 'status')).toBe('closed');
        await backend.records.clearRecordFields('/a');
        expect(await backend.records.getRecordField('/a', 'status')).toBeUndefined();
        expect(await backend.records.getRecordField('/b', 'status')).toBe('closed');
        await backend.close();
    });

    it('walks, filters and queries record fields', async () => {
        const backend = freshIDB('record-query');
        await backend.init();
        await backend.records.setAllRecordFields('/item', {
            'meta:title': 'Hello',
            'meta:count': 3,
            ignored: true,
        });
        const fields: string[] = [];
        const result = await backend.records.walkRecordFields(
            '/item',
            (field) => {
                fields.push(field);
                return true;
            },
            { prefix: 'meta:' },
        );
        const matches = await backend.records.queryRecordFields('/item', {
            field: 'meta:count',
            operator: '>=',
            value: 2,
        });

        expect(result).toEqual({ total: 2, processed: 2 });
        expect(fields.sort()).toEqual(['meta:count', 'meta:title']);
        expect(matches).toEqual([{ field: 'meta:count', value: 3 }]);
        await backend.close();
    });
});

describe('IndexedDBBackend rename records', () => {
    it('migrates file records with the file', async () => {
        const backend = freshIDB('rename-file-records');
        await backend.init();
        try {
            await backend.write('/old.seq', encoder.encode('old'));
            await backend.records.setRecordField('/old.seq', 'state', 'ready');
            await backend.rename('/old.seq', '/new.seq');

            expect(await backend.stat('/old.seq')).toBeNull();
            expect((await backend.stat('/new.seq'))?.path).toBe('/new.seq');
            expect(await backend.records.getRecordField('/new.seq', 'state')).toBe('ready');
            expect(await backend.records.getRecordField('/old.seq', 'state')).toBeUndefined();
        } finally { await backend.close(); }
    });

    it('migrates subtree records without touching prefix siblings', async () => {
        const backend = freshIDB('rename-subtree-records');
        await backend.init();
        try {
            await backend.write('/folder/data.seq', encoder.encode('data'));
            await backend.write('/folder-other/keep.seq', encoder.encode('keep'));
            await backend.records.setRecordField('/folder/data.seq', 'state', 'ready');
            await backend.records.setRecordField('/folder-other/keep.seq', 'state', 'sibling');

            await backend.rename('/folder', '/moved');

            expect(await backend.records.getRecordField('/moved/data.seq', 'state')).toBe('ready');
            expect(await backend.records.getRecordField('/folder/data.seq', 'state')).toBeUndefined();
            expect(await backend.records.getRecordField('/folder-other/keep.seq', 'state')).toBe('sibling');
            expect(await backend.stat('/moved/data.seq')).not.toBeNull();
            expect(await backend.stat('/folder/data.seq')).toBeNull();
        } finally { await backend.close(); }
    });

    it('refuses to overwrite durable destination records', async () => {
        const backend = freshIDB('rename-record-conflict');
        await backend.init();
        try {
            await backend.write('/source.seq', encoder.encode('source'));
            await backend.records.setRecordField('/source.seq', 'state', 'source');
            await backend.records.setRecordField('/dest.seq', 'state', 'dest');

            await expect(backend.rename('/source.seq', '/dest.seq'))
                .rejects.toThrow(/destination.*records/i);

            expect(await backend.stat('/source.seq')).not.toBeNull();
            expect(await backend.stat('/dest.seq')).toBeNull();
            expect(await backend.records.getRecordField('/source.seq', 'state')).toBe('source');
            expect(await backend.records.getRecordField('/dest.seq', 'state')).toBe('dest');
        } finally { await backend.close(); }
    });

    it('refuses to merge an existing destination subtree', async () => {
        const backend = freshIDB('rename-node-conflict');
        await backend.init();
        try {
            await backend.write('/source/child.seq', encoder.encode('source'));
            await backend.records.setRecordField('/source/child.seq', 'state', 'source');
            await backend.write('/dest/child.seq', encoder.encode('dest'));

            await expect(backend.rename('/source', '/dest'))
                .rejects.toThrow(/destination exists/i);

            expect(await backend.stat('/source/child.seq')).not.toBeNull();
            expect(await backend.records.getRecordField('/source/child.seq', 'state')).toBe('source');
            expect(await backend.stat('/dest/child.seq')).not.toBeNull();
        } finally { await backend.close(); }
    });

    it('rolls back all node, tag and record moves when a later write fails', async () => {
        const backend = freshIDB('rename-rollback');
        await backend.init();
        try {
            await backend.write('/source/a.seq', encoder.encode('a'));
            await backend.write('/source/b.seq', encoder.encode('b'));
            await backend.setTags('/source/a.seq', ['durable']);
            await backend.records.setRecordField('/source/a.seq', 'state', 'a');
            await backend.records.setRecordField('/source/b.seq', 'state', 'b');

            const originalAdd = IDBObjectStore.prototype.add;
            let nodeAdds = 0;
            const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
                this: IDBObjectStore,
                ...args: any[]
            ) {
                if (this.name === 'nodes' && ++nodeAdds === 2) throw new Error('injected node add failure');
                return (originalAdd as any).apply(this, args);
            });

            try {
                await expect(backend.rename('/source', '/moved')).rejects.toThrow('injected node add failure');
            } finally {
                spy.mockRestore();
            }

            expect(await backend.stat('/source')).not.toBeNull();
            expect(await backend.stat('/source/a.seq')).not.toBeNull();
            expect(await backend.stat('/source/b.seq')).not.toBeNull();
            expect(await backend.stat('/moved')).toBeNull();
            expect(await backend.listTagEntries()).toEqual([{ path: '/source/a.seq', tag: 'durable' }]);
            expect(await backend.records.getRecordField('/source/a.seq', 'state')).toBe('a');
            expect(await backend.records.getRecordField('/source/b.seq', 'state')).toBe('b');
            expect(await backend.records.getRecordField('/moved/a.seq', 'state')).toBeUndefined();
        } finally { await backend.close(); }
    });
});


describe('IndexedDBBackend path model', () => {
    it('creates intermediate directories and protects file path segments', async () => {
        const backend = freshIDB('parents');
        await backend.init();
        await backend.write('/a/b/file.txt', encoder.encode('data'));
        expect((await backend.stat('/a'))?.type).toBe('directory');
        expect((await backend.stat('/a/b'))?.type).toBe('directory');

        await backend.write('/plain.txt', encoder.encode('file'));
        await expect(backend.write('/plain.txt/child', encoder.encode('x')))
            .rejects.toThrow('ENOTDIR');
        await backend.close();
    });

    it('reports a clean database as healthy', async () => {
        const backend = freshIDB('verify');
        await backend.init();
        await backend.mkdir('/healthy');
        await backend.write('/healthy/file.txt', encoder.encode('ok'));
        const result = await backend.verify();

        expect(result.healthy).toBe(true);
        expect(result.missingStores).toEqual([]);
        expect(result.orphanNodes).toEqual([]);
        await backend.close();
    });


});

function uniqueName(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random()}`;
}
