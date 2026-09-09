import { afterEach, describe, expect, it } from 'vitest';
import { createVFS, MemoryBackend, type IFileSystem } from '@itookit/vfs-core';
import { createVFSToolContext } from '../src/files/tool-context';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function openFs(): Promise<IFileSystem> {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    cleanup.push(() => manager.dispose());
    return manager.openFileSystem('/');
}

describe('createVFSToolContext.stat', () => {
    it('reports the node type without walking the subtree', async () => {
        const fs = await openFs();
        await fs.driver.createFile({ name: 'notes.md', parentPath: '/', content: 'hello' });
        await fs.driver.createDirectory({ name: 'work', parentPath: '/' });
        const context = createVFSToolContext({ fs, cwd: '/', sessionId: 's1' });

        expect(await context.stat?.('/notes.md')).toBe('file');
        expect(await context.stat?.('/work')).toBe('directory');
        expect(await context.stat?.('/missing')).toBeNull();

        // The guard exists for existence checks; a recursive listFiles() on a large
        // tree is exactly the cost it must avoid.
        const children = fs.driver.getChildren;
        fs.driver.getChildren = async () => { throw new Error('stat must not enumerate children'); };
        try {
            expect(await context.stat?.('/work')).toBe('directory');
        } finally { fs.driver.getChildren = children; }
    });

    it('resolves relative paths against cwd', async () => {
        const fs = await openFs();
        await fs.driver.createFile({ name: 'child.yml', parentPath: '/work', recursive: true, content: 'x' });
        const context = createVFSToolContext({ fs, cwd: '/work', sessionId: 's1' });

        expect(await context.stat?.('child.yml')).toBe('file');
        expect(await context.stat?.('/work/child.yml')).toBe('file');
    });
});
