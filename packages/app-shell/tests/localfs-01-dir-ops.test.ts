/**
 * LocalFS integration — Directory operations
 *
 * Each test writes to tests/test_vfsroot/dir-ops/<NNN>/ on the real filesystem.
 * Inspect those directories after a run to verify the exact disk layout.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import {
    setupLocalVFS, diskExists, diskList, diskStat, type LocalTestVFS,
} from './helpers-localfs';

const SUITE = 'dir-ops';

describe('Directory — create', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('creates a real directory on disk', async () => {
        await vfs.fs.createDirectory({ name: 'docs', parentIdOrPath: null });

        const stat = await diskStat(vfs.moduleDir, 'docs');
        expect(stat?.isDirectory()).toBe(true);
    });

    it('appears in getChildren after creation', async () => {
        await vfs.fs.createDirectory({ name: 'projects', parentIdOrPath: null });

        const children = await vfs.fs.getChildren('/');
        expect(children.map(c => c.name)).toContain('projects');
    });

    it('creates nested directories (recursive path)', async () => {
        await vfs.fs.createFile({
            name:           'note.md',
            parentIdOrPath: '/a/b/c',
            content:        'deep',
            recursive:      true,
        });

        expect(await diskExists(vfs.moduleDir, 'a/b/c/note.md')).toBe(true);
        expect(await diskStat(vfs.moduleDir, 'a/b')).not.toBeNull();
    });

    it('createDirectory is idempotent (existing dir)', async () => {
        await vfs.fs.createDirectory({ name: 'dup', parentIdOrPath: null });
        // Second call should not throw
        await expect(
            vfs.fs.createDirectory({ name: 'dup', parentIdOrPath: null })
        ).resolves.not.toThrow();
    });
});

describe('Directory — list', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('getChildren lists pre-existing disk files and dirs', async () => {
        // Write directly to disk before VFS sees them
        await fsp.writeFile(join(vfs.moduleDir, 'pre.md'), 'hello');
        await fsp.mkdir(join(vfs.moduleDir, 'pre-dir'), { recursive: true });

        const children = await vfs.fs.getChildren('/');
        const names = children.map(c => c.name);
        expect(names).toContain('pre.md');
        expect(names).toContain('pre-dir');
    });

    it('getChildren is lazy — subdirectory contents not pre-loaded', async () => {
        await vfs.fs.createDirectory({ name: 'sub', parentIdOrPath: null });
        await vfs.fs.createFile({ name: 'child.txt', parentIdOrPath: '/sub', content: 'x' });

        const children = await vfs.fs.getChildren('/');
        const sub = children.find(n => n.name === 'sub');
        expect(sub?.children).toBeUndefined();  // lazy sentinel

        // Expand sub explicitly
        const subChildren = await vfs.fs.getChildren(sub!.id);
        expect(subChildren.map(c => c.name)).toContain('child.txt');
    });

    it('getChildren returns type=directory for directories', async () => {
        await vfs.fs.createDirectory({ name: 'mydir', parentIdOrPath: null });
        const children = await vfs.fs.getChildren('/');
        const dir = children.find(n => n.name === 'mydir');
        expect(dir?.type).toBe('directory');
    });
});

describe('Directory — delete', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('delete removes empty directory from disk', async () => {
        await vfs.fs.createDirectory({ name: 'empty', parentIdOrPath: null });
        const node = await vfs.fs.getNode('/empty');

        await vfs.fs.delete([node!.id]);

        expect(await diskExists(vfs.moduleDir, 'empty')).toBe(false);
        expect(await vfs.fs.exists('/empty')).toBe(false);
    });

    it('delete with recursive removes directory tree from disk', async () => {
        await vfs.fs.createDirectory({ name: 'tree', parentIdOrPath: null });
        await vfs.fs.createFile({ name: 'file.md', parentIdOrPath: '/tree', content: 'c' });
        await vfs.fs.createDirectory({ name: 'sub', parentIdOrPath: '/tree' });

        const node = await vfs.fs.getNode('/tree');
        await vfs.fs.delete([node!.id], { recursive: true });

        expect(await diskExists(vfs.moduleDir, 'tree')).toBe(false);
    });
});

describe('Directory — rename / move', () => {
    let vfs: LocalTestVFS;
    beforeEach(async () => { vfs = await setupLocalVFS(SUITE); });
    afterEach(async  () => { await vfs.dispose(); });

    it('rename renames directory on disk', async () => {
        await vfs.fs.createDirectory({ name: 'alpha', parentIdOrPath: null });
        await vfs.fs.rename('/alpha', 'beta');

        expect(await diskExists(vfs.moduleDir, 'alpha')).toBe(false);
        expect(await diskExists(vfs.moduleDir, 'beta')).toBe(true);
        expect((await diskStat(vfs.moduleDir, 'beta'))?.isDirectory()).toBe(true);
    });

    it('rename preserves directory contents', async () => {
        await vfs.fs.createDirectory({ name: 'src', parentIdOrPath: null });
        await vfs.fs.createFile({ name: 'index.ts', parentIdOrPath: '/src', content: 'export {}' });

        await vfs.fs.rename('/src', 'lib');

        expect(await diskExists(vfs.moduleDir, 'lib/index.ts')).toBe(true);
        expect(await diskRead(vfs.moduleDir, 'lib/index.ts')).toBe('export {}');
    });

    it('move directory into another directory', async () => {
        await vfs.fs.createDirectory({ name: 'target', parentIdOrPath: null });
        await vfs.fs.createDirectory({ name: 'movable', parentIdOrPath: null });

        const node = await vfs.fs.getNode('/movable');
        await vfs.fs.move([node!.id], '/target');

        expect(await diskExists(vfs.moduleDir, 'movable')).toBe(false);
        expect(await diskExists(vfs.moduleDir, 'target/movable')).toBe(true);
    });
});

// ── helper re-export for this file's assertions ────────────────────────────────

async function diskRead(rootDir: string, rel: string): Promise<string> {
    return fsp.readFile(join(rootDir, rel), 'utf-8');
}
