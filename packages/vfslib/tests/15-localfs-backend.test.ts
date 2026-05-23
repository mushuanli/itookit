/**
 * Integration tests: vfslib mount routing + LocalFSBackend (Node.js)
 *
 * Verifies that when LocalFSBackend is mounted at /module/home:
 *  - Pre-existing disk files are auto-discovered via getChildren
 *  - createFile writes a real file to disk
 *  - readContent reads from the real file on disk
 *  - writeContent updates the real file on disk
 *  - rename renames the real file on disk
 *  - delete removes the real file from disk
 *  - Nested directories are listed correctly
 *  - Data is isolated from other modules (IndexedDB root backend)
 *  - Node IDs carry the correct mountId (mount_1, not mount_0)
 *  - VFSModuleEngine.getChildren('/') returns the real filesystem tree
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalFSBackend } from '@itookit/vfsdriver-localfs';
import { createVFS } from '../src/factory';
import { VFSModuleEngine } from '../src/adapter-session/VFSModuleEngine';
import { freshIDB } from './helpers';

// ── Temp directory helpers ─────────────────────────────────────────────────

let _seq = 0;

interface TmpSetup {
    rootDir:    string;  // exposed to VFS as /module/home
    sidecarDir: string;  // private sidecar (SQLite + staging), outside rootDir
    cleanup:    () => Promise<void>;
}

async function makeTmp(): Promise<TmpSetup> {
    const id = `vfstest-localfs-${Date.now()}-${++_seq}`;
    const base       = join(tmpdir(), id);
    const rootDir    = join(base, 'home');
    const sidecarDir = join(base, 'sidecar');
    await fsp.mkdir(rootDir,    { recursive: true });
    await fsp.mkdir(sidecarDir, { recursive: true });
    return {
        rootDir,
        sidecarDir,
        cleanup: () => fsp.rm(base, { recursive: true, force: true }),
    };
}

// ── VFS factory helper ─────────────────────────────────────────────────────

interface TestCtx {
    rootDir:  string;
    manager:  Awaited<ReturnType<typeof createVFS>>['manager'];
    homeFS:   ReturnType<typeof manager.getEngine>;
    testFS:   ReturnType<typeof manager.getEngine>;
    cleanup:  () => Promise<void>;
}

async function setupCtx(): Promise<TestCtx> {
    const tmp = await makeTmp();

    const homeBackend = await openLocalFSBackend({
        rootDir:    tmp.rootDir,
        sidecarDir: tmp.sidecarDir,
    });

    const { manager } = await createVFS({
        rootBackend:      freshIDB(),
        additionalMounts: [{ path: '/module/home', backend: homeBackend }],
        modules: [
            { name: 'home' },
            { name: 'test' },   // second module backed by root IndexedDB
        ],
    });

    const homeFS = manager.getEngine('home');
    const testFS = manager.getEngine('test');
    await homeFS.init();
    await testFS.init();

    return {
        rootDir: tmp.rootDir,
        manager,
        homeFS,
        testFS,
        cleanup: async () => {
            await manager.dispose();
            await tmp.cleanup();
        },
    };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function text(content: string): ArrayBuffer {
    return new TextEncoder().encode(content).buffer as ArrayBuffer;
}

async function readDisk(rootDir: string, rel: string): Promise<string> {
    const data = await fsp.readFile(join(rootDir, rel), 'utf-8');
    return data;
}

async function existsDisk(rootDir: string, rel: string): Promise<boolean> {
    return fsp.access(join(rootDir, rel)).then(() => true).catch(() => false);
}

// ═══════════════════════════════════════════════════════════════════════════
// Test suites
// ═══════════════════════════════════════════════════════════════════════════

describe('LocalFSBackend — pre-existing files are auto-discovered', () => {
    let ctx: TestCtx;
    beforeEach(async () => { ctx = await setupCtx(); });
    afterEach(async ()  => { await ctx.cleanup(); });

    it('files written to disk before mounting appear in getChildren', async () => {
        // Write files BEFORE mounting (simulate user files already on disk)
        const tmp2 = await makeTmp();
        await fsp.writeFile(join(tmp2.rootDir, 'existing.md'), 'hello from disk');
        await fsp.writeFile(join(tmp2.rootDir, 'notes.txt'), 'notes');

        const backend2 = await openLocalFSBackend({
            rootDir:    tmp2.rootDir,
            sidecarDir: tmp2.sidecarDir,
        });
        const { manager: mgr2 } = await createVFS({
            rootBackend:      freshIDB('pre-existing'),
            additionalMounts: [{ path: '/module/home', backend: backend2 }],
            modules: [{ name: 'home' }],
        });
        const fs2 = mgr2.getEngine('home');
        await fs2.init();

        try {
            const children = await fs2.getChildren('/');
            const names = children.map(c => c.name);
            expect(names).toContain('existing.md');
            expect(names).toContain('notes.txt');
        } finally {
            await mgr2.dispose();
            await tmp2.cleanup();
        }
    });

    it('VFSModuleEngine.getChildren('/') is shallow — directories have no children loaded', async () => {
        await fsp.writeFile(join(ctx.rootDir, 'readme.md'),  'Read me');
        await fsp.writeFile(join(ctx.rootDir, 'config.json'), '{}');
        await fsp.mkdir(join(ctx.rootDir, 'docs'), { recursive: true });
        await fsp.writeFile(join(ctx.rootDir, 'docs', 'guide.md'), '# Guide');

        const engine = new VFSModuleEngine('home', ctx.manager);
        await engine.init();
        const tree = await engine.getChildren('/');

        // getChildren('/') only returns the first level
        const topNames = tree.map(n => n.name);
        expect(topNames).toContain('readme.md');
        expect(topNames).toContain('config.json');
        expect(topNames).toContain('docs');

        // 'docs' directory has no children yet (lazy sentinel)
        const docsNode = tree.find(n => n.name === 'docs');
        expect(docsNode?.type).toBe('directory');
        expect(docsNode?.children).toBeUndefined();

        // guide.md is NOT in the top-level tree — must be loaded lazily
        expect(topNames).not.toContain('guide.md');
    });

    it('VFSModuleEngine.getChildren lazily loads a directory', async () => {
        await fsp.mkdir(join(ctx.rootDir, 'notes'), { recursive: true });
        await fsp.writeFile(join(ctx.rootDir, 'notes', 'a.md'), 'A');
        await fsp.writeFile(join(ctx.rootDir, 'notes', 'b.md'), 'B');

        const engine = new VFSModuleEngine('home', ctx.manager);
        await engine.init();
        const tree = await engine.getChildren('/');

        const notesNode = tree.find(n => n.name === 'notes')!;
        expect(notesNode?.children).toBeUndefined();

        // Lazy load via getChildren
        const children = await engine.getChildren(notesNode.id);
        const childNames = children.map(c => c.name);
        expect(childNames).toContain('a.md');
        expect(childNames).toContain('b.md');
    });
});

describe('LocalFSBackend — createFile writes to disk', () => {
    let ctx: TestCtx;
    beforeEach(async () => { ctx = await setupCtx(); });
    afterEach(async ()  => { await ctx.cleanup(); });

    it('createFile creates a real file', async () => {
        await ctx.homeFS.createFile({ name: 'hello.md', parentPath: null, content: 'world' });
        expect(await existsDisk(ctx.rootDir, 'hello.md')).toBe(true);
        expect(await readDisk(ctx.rootDir, 'hello.md')).toBe('world');
    });

    it('createFile with nested directory (recursive)', async () => {
        await ctx.homeFS.createFile({
            name: 'note.md',
            parentPath: '/drafts',
            content: 'draft content',
            recursive: true,
        });
        expect(await existsDisk(ctx.rootDir, 'drafts/note.md')).toBe(true);
        expect(await readDisk(ctx.rootDir, 'drafts/note.md')).toBe('draft content');
    });

    it('createDirectory creates a real directory', async () => {
        await ctx.homeFS.createDirectory({ name: 'projects', parentPath: null });
        const stat = await fsp.stat(join(ctx.rootDir, 'projects'));
        expect(stat.isDirectory()).toBe(true);
    });

    it('created file is visible in getChildren', async () => {
        await ctx.homeFS.createFile({ name: 'visible.txt', parentPath: null, content: '' });
        const children = await ctx.homeFS.getChildren('/');
        expect(children.map(c => c.name)).toContain('visible.txt');
    });
});

describe('LocalFSBackend — readContent reads from disk', () => {
    let ctx: TestCtx;
    beforeEach(async () => { ctx = await setupCtx(); });
    afterEach(async ()  => { await ctx.cleanup(); });

    it('reads content written via VFS', async () => {
        await ctx.homeFS.createFile({ name: 'data.txt', parentPath: null, content: 'vfs content' });
        const result = await ctx.homeFS.readContent('/data.txt', { encoding: 'utf-8' });
        expect(result).toBe('vfs content');
    });

    it('reads content from pre-existing disk file', async () => {
        await fsp.writeFile(join(ctx.rootDir, 'pre.txt'), 'disk content');
        const result = await ctx.homeFS.readContent('/pre.txt', { encoding: 'utf-8' });
        expect(result).toBe('disk content');
    });

    it('reads binary content correctly', async () => {
        const bytes = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
        await ctx.homeFS.createFile({
            name: 'bin.dat',
            parentPath: null,
            content: bytes.buffer as ArrayBuffer,
        });
        const result = await ctx.homeFS.readContent('/bin.dat', { encoding: 'binary' }) as ArrayBuffer;
        expect(new Uint8Array(result)).toEqual(bytes);
    });
});

describe('LocalFSBackend — writeContent updates disk', () => {
    let ctx: TestCtx;
    beforeEach(async () => { ctx = await setupCtx(); });
    afterEach(async ()  => { await ctx.cleanup(); });

    it('writeContent overwrites disk file', async () => {
        await ctx.homeFS.createFile({ name: 'log.txt', parentPath: null, content: 'v1' });
        await ctx.homeFS.writeContent('/log.txt', 'v2');
        expect(await readDisk(ctx.rootDir, 'log.txt')).toBe('v2');
    });

    it('writeContent append mode appends to disk file', async () => {
        await ctx.homeFS.createFile({ name: 'append.txt', parentPath: null, content: 'AAA' });
        await ctx.homeFS.writeContent('/append.txt', 'BBB', { mode: 'append' });
        const onDisk = await readDisk(ctx.rootDir, 'append.txt');
        expect(onDisk).toBe('AAABBB');
    });
});

describe('LocalFSBackend — rename updates disk', () => {
    let ctx: TestCtx;
    beforeEach(async () => { ctx = await setupCtx(); });
    afterEach(async ()  => { await ctx.cleanup(); });

    it('rename moves file on disk', async () => {
        await ctx.homeFS.createFile({ name: 'old.md', parentPath: null, content: 'data' });
        await ctx.homeFS.rename('/old.md', 'new.md');

        expect(await existsDisk(ctx.rootDir, 'old.md')).toBe(false);
        expect(await existsDisk(ctx.rootDir, 'new.md')).toBe(true);
        expect(await readDisk(ctx.rootDir, 'new.md')).toBe('data');
    });

    it('renamed file is visible under new name in getChildren', async () => {
        await ctx.homeFS.createFile({ name: 'alpha.txt', parentPath: null, content: '' });
        await ctx.homeFS.rename('/alpha.txt', 'beta.txt');

        const names = (await ctx.homeFS.getChildren('/')).map(c => c.name);
        expect(names).toContain('beta.txt');
        expect(names).not.toContain('alpha.txt');
    });
});

describe('LocalFSBackend — delete removes from disk', () => {
    let ctx: TestCtx;
    beforeEach(async () => { ctx = await setupCtx(); });
    afterEach(async ()  => { await ctx.cleanup(); });

    it('delete removes the real file', async () => {
        await ctx.homeFS.createFile({ name: 'gone.txt', parentPath: null, content: 'bye' });
        expect(await existsDisk(ctx.rootDir, 'gone.txt')).toBe(true);

        const node = await ctx.homeFS.getNode('/gone.txt');
        await ctx.homeFS.delete([node!.id]);
        expect(await existsDisk(ctx.rootDir, 'gone.txt')).toBe(false);
    });

    it('deleted file disappears from getChildren', async () => {
        await ctx.homeFS.createFile({ name: 'temp.md', parentPath: null, content: '' });
        const node = await ctx.homeFS.getNode('/temp.md');
        await ctx.homeFS.delete([node!.id]);

        const names = (await ctx.homeFS.getChildren('/')).map(c => c.name);
        expect(names).not.toContain('temp.md');
    });

    it('delete directory recursively removes from disk', async () => {
        await ctx.homeFS.createDirectory({ name: 'subdir', parentPath: null });
        await ctx.homeFS.createFile({ name: 'child.txt', parentPath: '/subdir', content: 'c' });

        const dir = await ctx.homeFS.getNode('/subdir');
        await ctx.homeFS.delete([dir!.id], { recursive: true });
        expect(await existsDisk(ctx.rootDir, 'subdir')).toBe(false);
    });
});

describe('LocalFSBackend — cross-backend isolation', () => {
    let ctx: TestCtx;
    beforeEach(async () => { ctx = await setupCtx(); });
    afterEach(async ()  => { await ctx.cleanup(); });

    it('home (LocalFS) file not visible in test (IndexedDB) module', async () => {
        await ctx.homeFS.createFile({ name: 'home-only.md', parentPath: null, content: 'home' });
        expect(await ctx.testFS.exists('/home-only.md')).toBe(false);
    });

    it('test (IndexedDB) file not visible in home (LocalFS) module', async () => {
        await ctx.testFS.createFile({ name: 'idb-only.txt', parentPath: null, content: 'idb' });
        expect(await ctx.homeFS.exists('/idb-only.txt')).toBe(false);
    });

    it('same filename in both modules stays independent', async () => {
        await ctx.homeFS.createFile({ name: 'shared-name.md', parentPath: null, content: 'localfs' });
        await ctx.testFS.createFile({ name: 'shared-name.md', parentPath: null, content: 'indexeddb' });

        const homeText = await ctx.homeFS.readContent('/shared-name.md', { encoding: 'utf-8' });
        const testText = await ctx.testFS.readContent('/shared-name.md', { encoding: 'utf-8' });

        expect(homeText).toBe('localfs');
        expect(testText).toBe('indexeddb');
    });
});

describe('LocalFSBackend — node ID and mountId', () => {
    let ctx: TestCtx;
    beforeEach(async () => { ctx = await setupCtx(); });
    afterEach(async ()  => { await ctx.cleanup(); });

    it('home module nodes carry mount_1 prefix', async () => {
        await ctx.homeFS.createFile({ name: 'file.txt', parentPath: null, content: 'x' });
        const [node] = await ctx.homeFS.getChildren('/');
        // mount_0 = root IndexedDB, mount_1 = LocalFSBackend at /module/home
        expect(node.id).toMatch(/^mount_1:/);
    });

    it('test module nodes carry mount_0 prefix', async () => {
        await ctx.testFS.createFile({ name: 'file.txt', parentPath: null, content: 'x' });
        const [node] = await ctx.testFS.getChildren('/');
        expect(node.id).toMatch(/^mount_0:/);
    });

    it('getNode by id round-trips correctly', async () => {
        await ctx.homeFS.createFile({ name: 'roundtrip.md', parentPath: null, content: 'rt' });
        const [node] = await ctx.homeFS.getChildren('/');

        const fetched = await ctx.homeFS.getNode(node.id);
        expect(fetched).not.toBeNull();
        expect(fetched!.name).toBe('roundtrip.md');
    });
});

describe('LocalFSBackend — move', () => {
    let ctx: TestCtx;
    beforeEach(async () => { ctx = await setupCtx(); });
    afterEach(async ()  => { await ctx.cleanup(); });

    it('move file into subdirectory updates disk', async () => {
        await ctx.homeFS.createDirectory({ name: 'sub', parentPath: null });
        await ctx.homeFS.createFile({ name: 'moveme.txt', parentPath: null, content: 'move' });

        const node = await ctx.homeFS.getNode('/moveme.txt');
        await ctx.homeFS.move([node!.id], '/sub');

        expect(await existsDisk(ctx.rootDir, 'moveme.txt')).toBe(false);
        expect(await existsDisk(ctx.rootDir, 'sub/moveme.txt')).toBe(true);
    });
});
