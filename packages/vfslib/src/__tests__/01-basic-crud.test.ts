/**
 * Basic CRUD: createFile, readContent, writeContent, updateMetadata,
 * rename, move, copy, delete — backed by IndexedDB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupVFS, expectNode, expectMissing, readText, type TestVFS } from './helpers';

describe('Basic CRUD (IndexedDB backend)', () => {
    let vfs: TestVFS;

    beforeEach(async () => { vfs = await setupVFS(); });
    afterEach(async () => { await vfs.dispose(); });

    // ── Create / Read ────────────────────────────────────────────────────────

    it('createFile and readContent (utf-8)', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'hello.txt', parentIdOrPath: null, content: 'Hello VFS!' });
        const text = await readText(fs, '/hello.txt');
        expect(text).toBe('Hello VFS!');
    });

    it('createFile with ArrayBuffer content', async () => {
        const { fs } = vfs;
        const buf = new TextEncoder().encode('binary data').buffer as ArrayBuffer;
        await fs.createFile({ name: 'data.bin', parentIdOrPath: null, content: buf });
        const result = await fs.readContent('/data.bin', { encoding: 'binary' });
        expect(result instanceof ArrayBuffer).toBe(true);
        expect(new TextDecoder().decode(result as ArrayBuffer)).toBe('binary data');
    });

    it('getNode returns correct metadata', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'meta.txt', parentIdOrPath: null, content: 'x' });
        const node = await expectNode(fs, '/meta.txt');
        expect(node.type).toBe('file');
        expect(node.name).toBe('meta.txt');
        expect(node.path).toBe('/meta.txt');
        expect(typeof node.createdAt).toBe('number');
    });

    it('resolvePath returns stable ID', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'resolve.txt', parentIdOrPath: null, content: '' });
        const id1 = await fs.resolvePath('/resolve.txt');
        const id2 = await fs.resolvePath('/resolve.txt');
        expect(id1).toBeTruthy();
        expect(id1).toBe(id2);
    });

    it('exists returns true/false correctly', async () => {
        const { fs } = vfs;
        expect(await fs.exists('/nope.txt')).toBe(false);
        await fs.createFile({ name: 'nope.txt', parentIdOrPath: null, content: '' });
        expect(await fs.exists('/nope.txt')).toBe(true);
    });

    // ── Write ────────────────────────────────────────────────────────────────

    it('writeContent overwrites existing content', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'write.txt', parentIdOrPath: null, content: 'old' });
        await fs.writeContent('/write.txt', 'new content');
        expect(await readText(fs, '/write.txt')).toBe('new content');
    });

    it('appendContent appends to file', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'append.txt', parentIdOrPath: null, content: 'line1\n' });
        await fs.appendContent('/append.txt', 'line2\n');
        const text = await readText(fs, '/append.txt');
        expect(text).toBe('line1\nline2\n');
    });

    it('createFile with overwrite:true replaces content', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'ow.txt', parentIdOrPath: null, content: 'original' });
        await fs.createFile({ name: 'ow.txt', parentIdOrPath: null, content: 'replaced', overwrite: true });
        expect(await readText(fs, '/ow.txt')).toBe('replaced');
    });

    // ── updateMetadata ───────────────────────────────────────────────────────

    it('updateMetadata merges fields', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'patch.txt', parentIdOrPath: null, content: '' });
        await fs.updateMetadata('/patch.txt', { color: 'blue', priority: 1 });
        const node = await expectNode(fs, '/patch.txt');
        expect(node.metadata.color).toBe('blue');
        expect(node.metadata.priority).toBe(1);
    });

    // ── Rename ───────────────────────────────────────────────────────────────

    it('rename changes file name', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'old.txt', parentIdOrPath: null, content: 'content' });
        await fs.rename('/old.txt', 'new.txt');
        await expectMissing(fs, '/old.txt');
        const node = await expectNode(fs, '/new.txt');
        expect(node.name).toBe('new.txt');
        expect(await readText(fs, '/new.txt')).toBe('content');
    });

    // ── Move ─────────────────────────────────────────────────────────────────

    it('move relocates file to another directory', async () => {
        const { fs } = vfs;
        await fs.createDirectory({ name: 'dst', parentIdOrPath: null });
        await fs.createFile({ name: 'move.txt', parentIdOrPath: null, content: 'moved' });
        await fs.move(['/move.txt'], '/dst');
        await expectMissing(fs, '/move.txt');
        expect(await readText(fs, '/dst/move.txt')).toBe('moved');
    });

    it('move multiple files at once', async () => {
        const { fs } = vfs;
        await fs.createDirectory({ name: 'target', parentIdOrPath: null });
        await fs.createFile({ name: 'a.txt', parentIdOrPath: null, content: 'a' });
        await fs.createFile({ name: 'b.txt', parentIdOrPath: null, content: 'b' });
        await fs.move(['/a.txt', '/b.txt'], '/target');
        expect(await readText(fs, '/target/a.txt')).toBe('a');
        expect(await readText(fs, '/target/b.txt')).toBe('b');
    });

    // ── Copy ─────────────────────────────────────────────────────────────────

    it('copy duplicates file', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'src.txt', parentIdOrPath: null, content: 'original' });
        const copy = await fs.copy!('/src.txt', null, 'copy.txt');
        expect(copy.name).toBe('copy.txt');
        expect(await readText(fs, '/src.txt')).toBe('original');
        expect(await readText(fs, '/copy.txt')).toBe('original');
    });

    it('copy is independent — editing copy does not affect source', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'orig.txt', parentIdOrPath: null, content: 'data' });
        await fs.copy!('/orig.txt', null, 'dup.txt');
        await fs.writeContent('/dup.txt', 'changed');
        expect(await readText(fs, '/orig.txt')).toBe('data');
    });

    // ── Delete ───────────────────────────────────────────────────────────────

    it('delete removes file', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'del.txt', parentIdOrPath: null, content: '' });
        await fs.delete(['/del.txt']);
        await expectMissing(fs, '/del.txt');
    });

    it('delete with force:true silently ignores missing files', async () => {
        const { fs } = vfs;
        await expect(fs.delete(['/ghost.txt'], { force: true })).resolves.not.toThrow();
    });

    it('delete rejects missing file without force', async () => {
        const { fs } = vfs;
        await expect(fs.delete(['/ghost.txt'])).rejects.toThrow();
    });

    // ── getStats ─────────────────────────────────────────────────────────────

    it('getStats returns correct counts', async () => {
        const { fs } = vfs;
        await fs.createFile({ name: 'f1.txt', parentIdOrPath: null, content: 'abc' });
        await fs.createFile({ name: 'f2.txt', parentIdOrPath: null, content: 'de' });
        await fs.createDirectory({ name: 'd1', parentIdOrPath: null });
        const stats = await fs.getStats!();
        expect(stats.fileCount).toBeGreaterThanOrEqual(2);
        expect(stats.directoryCount).toBeGreaterThanOrEqual(1);
        expect(stats.totalSize).toBeGreaterThanOrEqual(5);
    });
});
