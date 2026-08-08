/**
 * IndexedDB backend contract tests for the path-based storage model.
 */
import { describe, expect, it } from 'vitest';
import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { freshIDB } from './helpers';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

    it('adds missing stores without deleting existing nodes', async () => {
        const dbName = uniqueName('missing-stores');
        await createNodesOnlyDatabase(dbName);
        const backend = new IndexedDBBackend({ dbName });
        await backend.init();

        expect(await backend.stat('/existing')).not.toBeNull();
        await backend.records.setRecordField('/existing', 'key', 'value');
        expect(await backend.records.getRecordField('/existing', 'key')).toBe('value');
        await backend.close();
    });
});

function uniqueName(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random()}`;
}

function createNodesOnlyDatabase(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
            const nodes = request.result.createObjectStore('nodes', { keyPath: 'path' });
            nodes.put({
                path: '/existing',
                type: 'directory',
                content: new ArrayBuffer(0),
                size: 0,
                createdAt: 1,
                modifiedAt: 1,
                tags: [],
                metadata: '{}',
            });
        };
        request.onsuccess = () => {
            request.result.close();
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}
