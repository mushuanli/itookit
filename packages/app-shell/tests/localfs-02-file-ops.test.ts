/**
 * LocalFS integration — File CRUD operations
 *
 * Inspect tests/test_vfsroot/file-ops/<NNN>/ after a run to see real file layout.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import {
    setupLocalVFS, diskExists, diskRead, diskStat, text, type LocalTestVFS,
} from './helpers-localfs';

const SUITE = 'file-ops';

describe('File — create', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('createFile writes real file to disk', async () => {
        await vfs.fs.createFile({ name: 'hello.md', parentIdOrPath: null, content: '# Hello' });

        expect(await diskExists(vfs.moduleDir, 'hello.md')).toBe(true);
        expect(await diskRead(vfs.moduleDir,   'hello.md')).toBe('# Hello');
    });

    it('createFile appears in getChildren', async () => {
        await vfs.fs.createFile({ name: 'note.txt', parentIdOrPath: null, content: '' });

        const names = (await vfs.fs.getChildren('/')).map(n => n.name);
        expect(names).toContain('note.txt');
    });

    it('createFile with binary content', async () => {
        const bytes = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
        await vfs.fs.createFile({
            name:           'bin.dat',
            parentIdOrPath: null,
            content:        bytes.buffer as ArrayBuffer,
        });

        const raw = await fsp.readFile(join(vfs.moduleDir, 'bin.dat'));
        expect(new Uint8Array(raw)).toEqual(bytes);
    });

    it('createFile in a new subdirectory with recursive:true', async () => {
        await vfs.fs.createFile({
            name:           'deep.md',
            parentIdOrPath: '/a/b',
            content:        'deep content',
            recursive:      true,
        });

        expect(await diskExists(vfs.moduleDir, 'a/b/deep.md')).toBe(true);
        expect(await diskRead(vfs.moduleDir,   'a/b/deep.md')).toBe('deep content');
    });

    it('pre-existing disk files are auto-discovered by VFS', async () => {
        // Write directly to disk, bypass VFS
        await fsp.writeFile(join(vfs.moduleDir, 'external.md'), 'from disk');

        const content = await vfs.fs.readContent('/external.md', { encoding: 'utf-8' });
        expect(content).toBe('from disk');
    });
});

describe('File — read', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('readContent returns file text', async () => {
        await vfs.fs.createFile({ name: 'readme.md', parentIdOrPath: null, content: '# Read me' });
        const result = await vfs.fs.readContent('/readme.md', { encoding: 'utf-8' });
        expect(result).toBe('# Read me');
    });

    it('readContent returns binary ArrayBuffer', async () => {
        const bytes = new Uint8Array([1, 2, 3, 4]);
        await vfs.fs.createFile({
            name: 'blob.bin', parentIdOrPath: null,
            content: bytes.buffer as ArrayBuffer,
        });

        const result = await vfs.fs.readContent('/blob.bin', { encoding: 'binary' }) as ArrayBuffer;
        expect(new Uint8Array(result)).toEqual(bytes);
    });

    it('getNode returns correct metadata', async () => {
        await vfs.fs.createFile({ name: 'meta.txt', parentIdOrPath: null, content: 'content' });
        const node = await vfs.fs.getNode('/meta.txt');

        expect(node).not.toBeNull();
        expect(node!.name).toBe('meta.txt');
        expect(node!.type).toBe('file');
    });
});

describe('File — write / update', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('writeContent overwrites file on disk', async () => {
        await vfs.fs.createFile({ name: 'log.txt', parentIdOrPath: null, content: 'v1' });
        await vfs.fs.writeContent('/log.txt', 'v2');

        expect(await diskRead(vfs.moduleDir, 'log.txt')).toBe('v2');
    });

    it('writeContent append mode adds to end', async () => {
        await vfs.fs.createFile({ name: 'append.txt', parentIdOrPath: null, content: 'AAA' });
        await vfs.fs.writeContent('/append.txt', 'BBB', { mode: 'append' });

        expect(await diskRead(vfs.moduleDir, 'append.txt')).toBe('AAABBB');
    });

    it('writeContent reflects on disk immediately', async () => {
        await vfs.fs.createFile({ name: 'live.md', parentIdOrPath: null, content: 'old' });
        await vfs.fs.writeContent('/live.md', 'new content');

        // Cross-check: disk and VFS agree
        const fromDisk = await diskRead(vfs.moduleDir, 'live.md');
        const fromVFS  = await vfs.fs.readContent('/live.md', { encoding: 'utf-8' });
        expect(fromDisk).toBe('new content');
        expect(fromVFS).toBe('new content');
    });
});

describe('File — rename', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('rename moves file to new name on disk', async () => {
        await vfs.fs.createFile({ name: 'old.md', parentIdOrPath: null, content: 'data' });
        await vfs.fs.rename('/old.md', 'new.md');

        expect(await diskExists(vfs.moduleDir, 'old.md')).toBe(false);
        expect(await diskExists(vfs.moduleDir, 'new.md')).toBe(true);
        expect(await diskRead(vfs.moduleDir, 'new.md')).toBe('data');
    });

    it('rename updates VFS metadata (getNode by new path)', async () => {
        await vfs.fs.createFile({ name: 'before.txt', parentIdOrPath: null, content: 'x' });
        await vfs.fs.rename('/before.txt', 'after.txt');

        expect(await vfs.fs.exists('/before.txt')).toBe(false);
        const node = await vfs.fs.getNode('/after.txt');
        expect(node?.name).toBe('after.txt');
    });
});

describe('File — move', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('move file into subdirectory updates disk', async () => {
        await vfs.fs.createDirectory({ name: 'sub', parentIdOrPath: null });
        await vfs.fs.createFile({ name: 'moveme.txt', parentIdOrPath: null, content: 'moving' });

        const node = await vfs.fs.getNode('/moveme.txt');
        await vfs.fs.move([node!.id], '/sub');

        expect(await diskExists(vfs.moduleDir, 'moveme.txt')).toBe(false);
        expect(await diskExists(vfs.moduleDir, 'sub/moveme.txt')).toBe(true);
        expect(await diskRead(vfs.moduleDir, 'sub/moveme.txt')).toBe('moving');
    });
});

describe('File — delete', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('delete removes file from disk', async () => {
        await vfs.fs.createFile({ name: 'gone.txt', parentIdOrPath: null, content: 'bye' });
        const node = await vfs.fs.getNode('/gone.txt');
        await vfs.fs.delete([node!.id]);

        expect(await diskExists(vfs.moduleDir, 'gone.txt')).toBe(false);
        expect(await vfs.fs.exists('/gone.txt')).toBe(false);
    });

    it('deleted file disappears from getChildren', async () => {
        await vfs.fs.createFile({ name: 'tmp.md', parentIdOrPath: null, content: '' });
        const node = await vfs.fs.getNode('/tmp.md');
        await vfs.fs.delete([node!.id]);

        const names = (await vfs.fs.getChildren('/')).map(n => n.name);
        expect(names).not.toContain('tmp.md');
    });
});
