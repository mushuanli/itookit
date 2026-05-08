/**
 * Multi-backend mount:
 * - Mount a second driver (MemoryBackend / IndexedDB) to a sub-path
 * - Verify files land in the correct backend
 * - Test cross-mount isolation
 * - VFSManager module lifecycle (mount/unmount/getEngine)
 * - System-level readBySystemPath
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshIDB, freshMem, setupDualMountVFS, setupVFS, readText, type TestVFS } from './helpers';
import { createVFS } from '../src/factory';

// ─────────────────────────────────────────────────────────────────────────────
// Module lifecycle tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Module lifecycle (IndexedDB backend)', () => {
    let vfs: TestVFS;
    beforeEach(async () => { vfs = await setupVFS(); });
    afterEach(async () => { await vfs.dispose(); });

    it('mount() registers a module', async () => {
        await vfs.manager.mount('wiki');
        const info = vfs.manager.getModule('wiki');
        expect(info).not.toBeNull();
        expect(info?.name).toBe('wiki');
    });

    it('mount() is idempotent', async () => {
        await vfs.manager.mount('blog');
        await expect(vfs.manager.mount('blog')).resolves.not.toThrow();
    });

    it('getEngine returns IModuleFS for mounted module', async () => {
        await vfs.manager.mount('engine-test');
        const fs = vfs.manager.getEngine('engine-test');
        expect(fs).toBeDefined();
        expect(typeof fs.driver.createFile).toBe('function');
    });

    it('getEngine throws for unmounted module', () => {
        expect(() => vfs.manager.getEngine('ghost-module')).toThrow();
    });

    it('getAllModules lists all mounted modules', async () => {
        await vfs.manager.mount('m1');
        await vfs.manager.mount('m2');
        const modules = vfs.manager.getAllModules();
        const names = modules.map(m => m.name);
        expect(names).toContain('m1');
        expect(names).toContain('m2');
        expect(names).toContain('test'); // pre-mounted in setupVFS
    });

    it('unmount removes module from list', async () => {
        await vfs.manager.mount('temp');
        await vfs.manager.unmount('temp');
        expect(vfs.manager.getModule('temp')).toBeNull();
    });

    it('modules are isolated — files in test module are invisible to docs module', async () => {
        await vfs.manager.mount('docs');
        const testFS = vfs.manager.getEngine('test');
        const docsFS = vfs.manager.getEngine('docs');
        await docsFS.init();

        await testFS.createFile({ name: 'secret.txt', parentIdOrPath: null, content: 'hidden' });
        const children = await docsFS.getChildren('/');
        const names = children.map(c => c.name);
        expect(names).not.toContain('secret.txt');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Secondary backend mount tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Secondary backend mount (IDB root + Memory extra)', () => {
    it('mounting MemoryBackend at /module/extra routes writes there', async () => {
        const { manager, dispose } = await setupDualMountVFS({
            rootBackend: freshIDB('root'),
            extraBackend: freshMem(),
            extraPath: '/module/extra',
        });

        try {
            const extraFS = manager.getEngine('extra');
            await extraFS.init();

            await extraFS.createFile({ name: 'extra.txt', parentIdOrPath: null, content: 'in-extra' });
            const text = await extraFS.readContent('/extra.txt', { encoding: 'utf-8' });
            expect(text).toBe('in-extra');

            // File in extra module is not visible in test module
            const testFS = manager.getEngine('test');
            expect(await testFS.exists('/extra.txt')).toBe(false);
        } finally {
            await dispose();
        }
    });

    it('cross-module data stays isolated with different backends', async () => {
        const rootIDB = freshIDB('isolate-root');
        const extraMem = freshMem();
        const { manager, dispose } = await setupDualMountVFS({
            rootBackend: rootIDB,
            extraBackend: extraMem,
            extraPath: '/module/extra',
        });

        try {
            const testFS = manager.getEngine('test');
            const extraFS = manager.getEngine('extra');
            await testFS.init();
            await extraFS.init();

            await testFS.createFile({ name: 'idb.txt', parentIdOrPath: null, content: 'idb-data' });
            await extraFS.createFile({ name: 'mem.txt', parentIdOrPath: null, content: 'mem-data' });

            expect(await testFS.exists('/mem.txt')).toBe(false);
            expect(await extraFS.exists('/idb.txt')).toBe(false);
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
        const rootIDB = freshIDB('sub-root');
        const subMem = freshMem();

        const { manager } = await createVFS({
            rootBackend: rootIDB,
            modules: [{ name: 'data' }],
        });

        // Mount secondary backend at /module/data/attachments
        await manager.mounts.mountBackend('/module/data/attachments', subMem);

        const dataFS = manager.getEngine('data');
        await dataFS.init();

        // Writing to /attachments in data module goes to subMem
        await dataFS.createDirectory({ name: 'attachments', parentIdOrPath: null, recursive: true });
        await dataFS.createFile({ name: 'file.pdf', parentIdOrPath: '/attachments', content: 'pdf-bytes', recursive: true });

        expect(await dataFS.exists('/attachments/file.pdf')).toBe(true);
        await manager.dispose();
    });

    it('two IDB backends mounted in parallel stay independent', async () => {
        const idb1 = freshIDB('idb1');
        const idb2 = freshIDB('idb2');

        const { manager } = await createVFS({
            rootBackend: idb1,
            modules: [{ name: 'mod1' }],
        });
        await manager.mounts.mountBackend('/module/mod2', idb2);
        await manager.mount('mod2');

        const fs1 = manager.getEngine('mod1');
        const fs2 = manager.getEngine('mod2');
        await fs1.init();
        await fs2.init();

        await fs1.createFile({ name: 'from1.txt', parentIdOrPath: null, content: 'idb1' });
        await fs2.createFile({ name: 'from2.txt', parentIdOrPath: null, content: 'idb2' });

        expect(await readText(fs1, '/from1.txt')).toBe('idb1');
        expect(await readText(fs2, '/from2.txt')).toBe('idb2');
        expect(await fs1.exists('/from2.txt')).toBe(false);
        expect(await fs2.exists('/from1.txt')).toBe(false);

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
        await fs.driver.createFile({ name: 'sys.txt', parentIdOrPath: null, content: 'sys-data' });
        // System path uses real VFS path: /module/test/sys.txt
        const content = await manager.readBySystemPath('/module/test/sys.txt');
        expect(typeof content === 'string' || content instanceof ArrayBuffer).toBe(true);
    });

    it('manager.read convenience method reads file content', async () => {
        const { fs, manager } = vfs;
        await fs.driver.createFile({ name: 'mgr.txt', parentIdOrPath: null, content: 'mgr-data' });
        const content = await manager.read('test', '/mgr.txt');
        // FileContent can be string | ArrayBuffer | Uint8Array
        const text = typeof content === 'string'
            ? content
            : new TextDecoder().decode(content as ArrayBuffer);
        expect(text).toBe('mgr-data');
    });

    it('manager.write creates file if it does not exist', async () => {
        const { manager } = vfs;
        await manager.write('test', '/created-by-mgr.txt', 'mgr-content');
        const fs = manager.getEngine('test');
        expect(await fs.driver.exists('/created-by-mgr.txt')).toBe(true);
    });

    it('manager.exists works across modules', async () => {
        const { fs, manager } = vfs;
        await fs.driver.createFile({ name: 'check.txt', parentIdOrPath: null, content: '' });
        expect(await manager.exists('test', '/check.txt')).toBe(true);
        expect(await manager.exists('test', '/no-such.txt')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mount capabilities
// ─────────────────────────────────────────────────────────────────────────────

describe('Mount point capabilities', () => {
    it('getMountForPath returns root mount for root paths', async () => {
        const { manager, dispose } = await setupDualMountVFS();
        try {
            const mp = manager.mounts.getMountForPath('/module/test');
            expect(mp).toBeDefined();
            expect(mp.mountPath).toBe('/');
        } finally {
            await dispose();
        }
    });

    it('getMountForPath returns sub-mount for sub-paths', async () => {
        const { manager, dispose } = await setupDualMountVFS({
            extraPath: '/module/extra',
        });
        try {
            const mp = manager.mounts.getMountForPath('/module/extra/foo.txt');
            expect(mp.mountPath).toBe('/module/extra');
        } finally {
            await dispose();
        }
    });
});
