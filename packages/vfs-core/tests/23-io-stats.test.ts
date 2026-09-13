import { describe, expect, it } from 'vitest';
import { IO_OPERATIONS } from '../src/protocol';
import { freshMem, setupVFS } from './helpers';

describe('VFS IO statistics', () => {
    it('exposes a public snapshot of backend operations and resets on demand', async () => {
        const vfs = await setupVFS(freshMem());
        try {
            // Hosts previously reached into the engine (`(vfs as any)._engine.ioStats`)
            // to attribute redundant work; this is the supported entry point.
            expect(Object.keys(vfs.manager.ioStats).sort()).toEqual([...IO_OPERATIONS].sort());

            await vfs.fs.driver.createFile({ name: 'note.md', parentPath: '/', content: 'hello' });
            await vfs.fs.driver.readContent('/note.md', { encoding: 'utf-8' });
            expect(vfs.manager.ioStats.write).toBeGreaterThan(0);
            expect(vfs.manager.ioStats.stat).toBeGreaterThan(0);

            const snapshot = vfs.manager.ioStats;
            (snapshot as Record<string, number>).stat = 0;
            expect(vfs.manager.ioStats.stat).toBeGreaterThan(0);

            vfs.manager.resetIOStats();
            expect(vfs.manager.ioStats).toMatchObject({ stat: 0, list: 0, read: 0, write: 0 });
        } finally {
            await vfs.dispose();
        }
    });
});
