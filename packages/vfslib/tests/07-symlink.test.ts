/**
 * Symlink operations: symlink creation, readlink, path resolution through symlinks.
 *
 * Symlink targets in module-fs must be either:
 *   - Relative paths (resolved relative to the symlink's directory in real-path space)
 *   - Absolute virtual paths (translated to real paths by module-fs.driver.symlink)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupVFS, readText, type TestVFS } from './helpers';

describe('Symlink operations (IndexedDB backend)', () => {
    let vfs: TestVFS;
    beforeEach(async () => { vfs = await setupVFS(); });
    afterEach(async () => { await vfs.dispose(); });

    it('capabilities.symlinks is true', () => {
        expect(vfs.fs.capabilities.symlinks).toBe(true);
    });

    it('symlink returns a node of type symlink', async () => {
        const { fs } = vfs;
        await fs.driver.createFile({ name: 'target.txt', parentPath: null, content: 'linked' });
        // Use relative path — target is a sibling at root
        const lnk = await fs.driver.symlink('/link.txt', 'target.txt');
        expect(lnk.type).toBe('symlink');
        expect(lnk.name).toBe('link.txt');
    });

    it('readlink returns the stored target path', async () => {
        const { fs } = vfs;
        await fs.driver.createFile({ name: 'real.txt', parentPath: null, content: '' });
        await fs.driver.symlink('/sym.txt', 'real.txt');
        const target = await fs.driver.readlink('/sym.txt');
        expect(target).toBe('real.txt');
    });

    it('readContent through symlink (relative target) reads target content', async () => {
        const { fs } = vfs;
        await fs.driver.createFile({ name: 'data.txt', parentPath: null, content: 'symlink content' });
        await fs.driver.symlink('/link-data.txt', 'data.txt');
        const text = await readText(fs, '/link-data.txt');
        expect(text).toBe('symlink content');
    });

    it('readContent through absolute virtual path symlink reads target', async () => {
        const { fs } = vfs;
        await fs.driver.createFile({ name: 'abs.txt', parentPath: null, content: 'abs-content' });
        // Absolute virtual path — module-fs translates it to the real path
        await fs.driver.symlink('/abs-link.txt', '/abs.txt');
        const text = await readText(fs, '/abs-link.txt');
        expect(text).toBe('abs-content');
    });

    it('writeContent through symlink updates the target file', async () => {
        const { fs } = vfs;
        await fs.driver.createFile({ name: 'mut.txt', parentPath: null, content: 'original' });
        await fs.driver.symlink('/lnk-mut.txt', 'mut.txt');
        await fs.driver.writeContent('/lnk-mut.txt', 'updated');
        expect(await readText(fs, '/mut.txt')).toBe('updated');
    });

    it('getNode on a symlink path follows it to the target node', async () => {
        const { fs } = vfs;
        await fs.driver.createFile({ name: 'orig.txt', parentPath: null, content: '' });
        await fs.driver.symlink('/sym-node.txt', 'orig.txt');
        const node = await fs.driver.getNode('/sym-node.txt');
        expect(node).not.toBeNull();
        expect(node?.type).toBe('file'); // getNode follows symlinks by default
    });

    it('relative symlink resolves correctly', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'sub', parentPath: null });
        await fs.driver.createFile({ name: 'file.txt', parentPath: '/sub', content: 'relative-target' });
        await fs.driver.symlink('/link-rel.txt', 'sub/file.txt');
        const text = await readText(fs, '/link-rel.txt');
        expect(text).toBe('relative-target');
    });

    it('symlink to a directory allows getChildren', async () => {
        const { fs } = vfs;
        await fs.driver.createDirectory({ name: 'realdir', parentPath: null });
        await fs.driver.createFile({ name: 'child.txt', parentPath: '/realdir', content: '' });
        // Absolute virtual path — module-fs translates /realdir → real path
        await fs.driver.symlink('/linkdir', '/realdir');
        const children = await fs.driver.getChildren('/linkdir');
        expect(children.some(c => c.name === 'child.txt')).toBe(true);
    });

    it('exists returns true for a valid symlink pointing to an existing file', async () => {
        const { fs } = vfs;
        await fs.driver.createFile({ name: 'ex.txt', parentPath: null, content: '' });
        await fs.driver.symlink('/sym-ex.txt', 'ex.txt');
        expect(await fs.driver.exists('/sym-ex.txt')).toBe(true);
    });

    it('readlink on a non-symlink throws EINVAL', async () => {
        const { fs } = vfs;
        await fs.driver.createFile({ name: 'plain.txt', parentPath: null, content: '' });
        await expect(fs.driver.readlink('/plain.txt')).rejects.toThrow('EINVAL');
    });
});
