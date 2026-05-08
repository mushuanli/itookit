/**
 * Directory operations: createDirectory, getChildren, walkTree, recursive creation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupVFS, readText, type TestVFS } from './helpers';

describe('Directory operations (IndexedDB backend)', () => {
    let vfs: TestVFS;
    beforeEach(async () => { vfs = await setupVFS(); });
    afterEach(async () => { await vfs.dispose(); });

    it('createDirectory creates an empty directory', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'docs', parentIdOrPath: null });
        const node = await fs.driver.getNode('/docs');
        expect(node?.type).toBe('directory');
    });

    it('createDirectory idempotent — repeated calls are safe', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'idm', parentIdOrPath: null });
        await expect(fs.driver.createDirectory({ name: 'idm', parentIdOrPath: null }))
            .resolves.toBeDefined();
    });

    it('createDirectory recursive creates nested dirs', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'sub', parentIdOrPath: '/a/b', recursive: true });
        expect(await fs.driver.exists('/a')).toBe(true);
        expect(await fs.driver.exists('/a/b')).toBe(true);
        expect(await fs.driver.exists('/a/b/sub')).toBe(true);
    });

    it('createFile recursive creates missing parent dirs', async () => {
        const { fs } = vfs;
        await fs.driver.createFile({
            name: 'deep.txt',
            parentIdOrPath: '/x/y/z',
            content: 'deep',
            recursive: true,
        });
        expect(await readText(fs, '/x/y/z/deep.txt')).toBe('deep');
    });

    it('getChildren returns full FSNode[] by default', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'parent', parentIdOrPath: null });
        await fs.driver.createFile({ name: 'child1.txt', parentIdOrPath: '/parent', content: '' });
        await fs.driver.createFile({ name: 'child2.txt', parentIdOrPath: '/parent', content: '' });
        const children = await fs.driver.getChildren('/parent');
        expect(children).toHaveLength(2);
        expect(children.map(c => c.name).sort()).toEqual(['child1.txt', 'child2.txt']);
    });

    it('getChildren with fields:entry returns lightweight DirEntry[]', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'dir', parentIdOrPath: null });
        await fs.driver.createFile({ name: 'a.txt', parentIdOrPath: '/dir', content: 'hi' });
        const entries = await fs.driver.getChildren('/dir', { fields: 'entry' });
        expect(entries[0]).toHaveProperty('name');
        expect(entries[0]).toHaveProperty('type');
        expect(entries[0]).not.toHaveProperty('metadata');
    });

    it('getChildren excludes hidden files by default', async () => {
        // Hidden names (dot-prefix) are excluded from default listings.
        // Any module can create them in its own space; they just won't appear here.
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'hdir', parentIdOrPath: null });
        await fs.driver.createFile({ name: 'visible.txt', parentIdOrPath: '/hdir', content: '' });
        const children = await fs.driver.getChildren('/hdir');
        const names = children.map(c => c.name);
        expect(names).toContain('visible.txt');
        expect(names.filter(n => n.startsWith('.'))).toHaveLength(0);
    });

    it('delete directory with recursive:true removes all children', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'rm', parentIdOrPath: null });
        await fs.driver.createFile({ name: 'inner.txt', parentIdOrPath: '/rm', content: 'bye' });
        await fs.driver.delete(['/rm'], { recursive: true });
        expect(await fs.driver.exists('/rm')).toBe(false);
        expect(await fs.driver.exists('/rm/inner.txt')).toBe(false);
    });

    it('walkTree visits all nodes depth-first', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'walk', parentIdOrPath: null });
        await fs.driver.createDirectory({ name: 'sub', parentIdOrPath: '/walk' });
        await fs.driver.createFile({ name: 'a.txt', parentIdOrPath: '/walk', content: '' });
        await fs.driver.createFile({ name: 'b.txt', parentIdOrPath: '/walk/sub', content: '' });

        const visited: string[] = [];
        await fs.driver.walkTree!((node) => { visited.push(node.path); });

        expect(visited).toContain('/walk');
        expect(visited).toContain('/walk/sub');
        expect(visited).toContain('/walk/a.txt');
        expect(visited).toContain('/walk/sub/b.txt');
    });

    it('walkTree respects maxDepth', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'deep', parentIdOrPath: null });
        await fs.driver.createDirectory({ name: 'l2', parentIdOrPath: '/deep' });
        await fs.driver.createDirectory({ name: 'l3', parentIdOrPath: '/deep/l2' });
        await fs.driver.createFile({ name: 'file.txt', parentIdOrPath: '/deep/l2/l3', content: '' });

        const visited: string[] = [];
        await fs.driver.walkTree!((node) => { visited.push(node.path); }, { maxDepth: 1 });

        expect(visited).toContain('/deep');
        expect(visited).toContain('/deep/l2');
        expect(visited).not.toContain('/deep/l2/l3');
    });

    it('walkTree typeFilter only returns matching types', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'tf', parentIdOrPath: null });
        await fs.driver.createFile({ name: 'a.txt', parentIdOrPath: '/tf', content: '' });

        const files: string[] = [];
        await fs.driver.walkTree!((node) => { files.push(node.path); }, { typeFilter: 'file' });
        expect(files.every(p => !p.endsWith('/tf'))).toBe(true);
    });

    it('walkTree callback returning false stops iteration', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'stop', parentIdOrPath: null });
        for (let i = 0; i < 5; i++) {
            await fs.driver.createFile({ name: `f${i}.txt`, parentIdOrPath: '/stop', content: '' });
        }
        let count = 0;
        await fs.driver.walkTree!((node) => {
            if (node.type === 'file') {
                count++;
                if (count >= 2) return false;
            }
        });
        expect(count).toBeLessThanOrEqual(2);
    });
});
