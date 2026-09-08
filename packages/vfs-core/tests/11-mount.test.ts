/**
 * Multi-backend mount:
 * - Mount a second driver (MemoryBackend / IndexedDB) to a sub-path
 * - Verify files land in the correct backend
 * - Test cross-mount isolation
 * - System-level readBySystemPath
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshMem, setupDualMountVFS, setupVFS, readText, type TestVFS } from './helpers';
import { createVFS } from '../src/impl/factory';
import type { VFSEngine } from '../src';

// ─────────────────────────────────────────────────────────────────────────────
// Module lifecycle tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Secondary backend mount (Memory root + Memory extra)', () => {
    it('mounting MemoryBackend at /data/extra routes writes there', async () => {
        const { manager, dispose } = await setupDualMountVFS({
            rootBackend: freshMem(),
            extraBackend: freshMem(),
            extraPath: '/data/extra',
        });

        try {
            const extraFS = await manager.openFileSystem('/data/extra');

            await extraFS.driver.createFile({ name: 'extra.txt', parentPath: null, content: 'in-extra' });
            const text = await extraFS.driver.readContent('/extra.txt', { encoding: 'utf-8' });
            expect(text).toBe('in-extra');

            // File in extra module is not visible in test module
            const testFS = await manager.openFileSystem('/data/test');
            expect(await testFS.driver.exists('/extra.txt')).toBe(false);
        } finally {
            await dispose();
        }
    });

    it('cross-module data stays isolated with different backends', async () => {
        const rootMem = freshMem();
        const extraMem = freshMem();
        const { manager, dispose } = await setupDualMountVFS({
            rootBackend: rootMem,
            extraBackend: extraMem,
            extraPath: '/data/extra',
        });

        try {
            const testFS = await manager.openFileSystem('/data/test');
            const extraFS = await manager.openFileSystem('/data/extra');

            await testFS.driver.createFile({ name: 'idb.txt', parentPath: null, content: 'idb-data' });
            await extraFS.driver.createFile({ name: 'mem.txt', parentPath: null, content: 'mem-data' });

            expect(await testFS.driver.exists('/mem.txt')).toBe(false);
            expect(await extraFS.driver.exists('/idb.txt')).toBe(false);
            expect(await readText(testFS, '/idb.txt')).toBe('idb-data');
            expect(await readText(extraFS, '/mem.txt')).toBe('mem-data');
        } finally {
            await dispose();
        }
    });

    it('mounts.listMounts returns all mounted backends', async () => {
        const { manager, dispose } = await setupDualMountVFS();
        try {
            const mounts = manager.mounts.listMounts();
            expect(mounts.length).toBeGreaterThanOrEqual(2); // root + extra
        } finally {
            await dispose();
        }
    });

    it('mountBackend at sub-path routes writes to secondary', async () => {
        const rootMem = freshMem();
        const subMem = freshMem();

        const { manager } = await createVFS({
            rootBackend: rootMem,
        });

        // Mount secondary backend at /data/data/attachments
        await manager.mounts.mountBackend('/data/data/attachments', subMem);

        const dataFS = await manager.openFileSystem('/data/data');

        // Writing to /attachments in data module goes to subMem
        await dataFS.driver.createDirectory({ name: 'attachments', parentPath: null, recursive: true });
        await dataFS.driver.createFile({ name: 'file.pdf', parentPath: '/attachments', content: 'pdf-bytes', recursive: true });

        expect(await dataFS.driver.exists('/attachments/file.pdf')).toBe(true);
        await manager.dispose();
    });

    it('two memory backends mounted in parallel stay independent', async () => {
        const mem1 = freshMem();
        const mem2 = freshMem();

        const { manager } = await createVFS({
            rootBackend: mem1,
        });
        await manager.mounts.mountBackend('/data/mod2', mem2);
        const fs1 = await manager.openFileSystem('/data/mod1');
        const fs2 = await manager.openFileSystem('/data/mod2');

        await fs1.driver.createFile({ name: 'from1.txt', parentPath: null, content: 'idb1' });
        await fs2.driver.createFile({ name: 'from2.txt', parentPath: null, content: 'idb2' });

        expect(await readText(fs1, '/from1.txt')).toBe('idb1');
        expect(await readText(fs2, '/from2.txt')).toBe('idb2');
        expect(await fs1.driver.exists('/from2.txt')).toBe(false);
        expect(await fs2.driver.exists('/from1.txt')).toBe(false);

        await manager.dispose();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// System-level access
// ─────────────────────────────────────────────────────────────────────────────

describe('System-level readBySystemPath', () => {
    let vfs: TestVFS;
    beforeEach(async () => { vfs = await setupVFS(); });
    afterEach(async () => { await vfs.dispose(); });

    it('readBySystemPath reads file via absolute VFS path', async () => {
        const { fs, manager } = vfs;
        await fs.driver.createFile({ name: 'sys.txt', parentPath: null, content: 'sys-data' });
        // System path uses real VFS path: /data/test/sys.txt
        const content = await manager.readBySystemPath('/data/test/sys.txt');
        expect(typeof content === 'string' || content instanceof ArrayBuffer).toBe(true);
    });

});

describe('Mount point capabilities', () => {
    it('getMountForPath returns root mount for root paths', async () => {
        const { manager, dispose } = await setupDualMountVFS();
        try {
            const mp = manager.mounts.getMountForPath('/data/test');
            expect(mp).toBeDefined();
            expect(mp.mountPath).toBe('/');
        } finally {
            await dispose();
        }
    });

    it('getMountForPath returns sub-mount for sub-paths', async () => {
        const { manager, dispose } = await setupDualMountVFS({
            extraPath: '/data/extra',
        });
        try {
            const mp = manager.mounts.getMountForPath('/data/extra/foo.txt');
            expect(mp.mountPath).toBe('/data/extra');
        } finally {
            await dispose();
        }
    });
});

describe('same-backend mount shadowing', () => {
    it('returns indexed tags only from the mount that owns the resolved path', async () => {
        const backend = freshMem();
        const { manager } = await createVFS({ rootBackend: backend });
        try {
            await backend.write('/nested/hidden.md', new Uint8Array());
            await backend.setTags('/nested/hidden.md', ['hidden']);
            await manager.mounts.mountBackend('/nested', backend);

            const engine = (manager as unknown as { _engine: VFSEngine })._engine;
            expect(await engine.listTagEntries('/')).toEqual([
                { path: '/nested/nested/hidden.md', tag: 'hidden' },
            ]);

            await engine.writeContent('/nested/visible.md', 'visible');
            expect(new TextDecoder().decode(await backend.read('/visible.md'))).toBe('visible');
            expect(await backend.stat('/nested/visible.md')).toBeNull();
        } finally {
            await manager.dispose();
        }
    });
});

