import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createVFS, createFileSystemView } from '@itookit/vfs-core';
import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { SessionFilesService } from '../src/files/session-files';
import { createSessionAttachmentMounts } from '../src/files/session-attachments';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup() {
    const { manager } = await createVFS({ rootBackend: new IndexedDBBackend({ dbName: `session-files-${crypto.randomUUID()}` }) });
    cleanup.push(() => manager.dispose());
    const root = await manager.openFileSystem('/');
    const store = await manager.openFileSystem('/');
    const home = await manager.openFileSystem('/home/admin');
    await home.driver.createFile({ name: 'same.md', parentPath: '/a', content: 'A', recursive: true });
    await home.driver.createFile({ name: 'same.md', parentPath: '/b', content: 'B', recursive: true });
    const make = async () => {
        const service = new SessionFilesService(store, async id => [{ mountId: 'attachments', at: '/attachments', fs: await manager.openFileSystem(`/var/lib/sessions/${id}/attachments`), access: 'rw' }]);
        await service.initialize();
        service.registerSource('home', home);
        cleanup.push(() => service.dispose());
        return service;
    };
    return { root, home, store, service: await make(), make };
}
const mount = (root: string, access: 'ro' | 'rw' = 'rw') => [{ mountId: 'work', at: '/workspace', sourceId: 'home', root, access }];

describe('Session file contexts', () => {
    it('routes exact paths independently, persists revisions, and has no basename fallback', async () => {
        const { service, make } = await setup();
        await service.configure('a', { mounts: mount('/a'), cwd: '/workspace' }, 0);
        await service.configure('b', { mounts: mount('/b', 'ro'), cwd: '/workspace' }, 0);
        const a = await service.acquire('a'), b = await service.acquire('b');
        expect(await a.vfs.readFile('same.md')).toBe('A');
        expect(await b.vfs.readFile('same.md')).toBe('B');
        await expect(a.vfs.readFile('/missing/same.md')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(a.vfs.readFile('../b/same.md')).rejects.toThrow('Invalid virtual');
        await expect(b.vfs.writeFile('same.md', 'bad')).rejects.toMatchObject({ code: 'EROFS' });
        await expect(service.configure('a', { mounts: mount('/b'), cwd: '/workspace' }, 0)).rejects.toMatchObject({ code: 'ECONFLICT' });
        await service.dispose();
        const reopened = await make();
        expect((await reopened.inspect('a'))?.revision).toBe(1);
        expect(await (await reopened.acquire('a')).vfs.readFile('same.md')).toBe('A');
    });

    it('revokes pinned file and tool handles, and closes released scopes', async () => {
        const { service, home } = await setup();
        await service.configure('a', { mounts: mount('/a'), cwd: '/workspace' }, 0);
        const tools = await service.acquire('a');
        const owner = await service.acquireFiles('a');
        const file = owner.context.fs.openFile('/workspace/same.md');
        await service.configure('a', { mounts: mount('/b'), cwd: '/workspace' }, 1);
        await expect(file.read()).rejects.toMatchObject({ code: 'EACCES' });
        await expect(tools.vfs.readFile('same.md')).rejects.toMatchObject({ code: 'EACCES' });
        expect(await (await service.acquire('a')).vfs.readFile('same.md')).toBe('B');
        await tools.release();
        await expect(tools.vfs.readFile('same.md')).rejects.toMatchObject({ code: 'EACCES' });
        await owner.release();
        const active = await service.acquire('a');
        await service.disable('a', 2);
        await expect(active.vfs.readFile('same.md')).rejects.toMatchObject({ code: 'EACCES' });
        expect(await home.driver.readContent('/b/same.md', { encoding: 'utf-8' })).toBe('B');
        await service.dispose();
        await expect(service.acquire('new')).rejects.toMatchObject({ code: 'EACCES' });
    });

    it('exposes only attachments without system directories, kernel records, or another Session', async () => {
        const { service, root } = await setup();
        for (const [parentPath, name, content] of [
            ['/etc/public', 'app.json', 'public'], ['/etc/llm', 'secret.json', 'credential'],
            ['/var/lib/sessions/a/conversation', 'manifest.json', 'own'],
            ['/var/lib/sessions/b/conversation', 'manifest.json', 'other'],
            ['/var/lib/kernel', 'ipc.seq', 'private'],
        ]) await root.driver.createFile({ parentPath, name, content, recursive: true });
        const owner = await service.acquireFiles('a', '/');
        const fs = owner.context.fs;
        expect((await fs.driver.getChildren('/')).map(n => n.name).sort()).toEqual(['attachments']);
        await expect(fs.driver.readContent('/etc/public/app.json')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.driver.readContent('/var/lib/sessions/a/conversation/manifest.json')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.driver.readContent('/etc/llm/secret.json')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.driver.readContent('/var/lib/sessions/b/conversation/manifest.json')).rejects.toMatchObject({ code: 'ENOENT' });
        expect((await fs.driver.search({ text: 'credential' })).nodes).toEqual([]);
        await expect(service.configure('a', { mounts: [{ ...mount('/a')[0], at: '//etc/public' }], cwd: '/workspace' }, 0)).rejects.toMatchObject({ code: 'EACCES' });
        await owner.release();
    });

    it('keeps interrupted reconfiguration disabled until explicitly recovered', async () => {
        const { service, store } = await setup();
        await service.configure('a', { mounts: mount('/a'), cwd: '/workspace' }, 0);
        await store.meta.seq!.setEntry('/var/lib/sessions/a/session.seq', 'files', JSON.stringify({ revision: 1, state: 'draining', mounts: mount('/a'), cwd: '/workspace' }));
        await expect(service.acquire('a')).rejects.toMatchObject({ code: 'EBUSY' });
        await service.configure('a', { mounts: mount('/b'), cwd: '/workspace' }, 1);
        expect(await (await service.acquire('a')).vfs.readFile('same.md')).toBe('B');
    });
});

it('maps granted Session attachments without history and revokes derived maps', async () => {
    const { SessionRepository } = await import('@itookit/llm-session');
    const { manager } = await createVFS({ rootBackend: new IndexedDBBackend({ dbName: crypto.randomUUID() }) });
    cleanup.push(() => manager.dispose());
    const root = await manager.openFileSystem('/');
    const repository = new SessionRepository(root); await repository.init(); cleanup.push(() => repository.dispose());
    const a = await repository.createSession('A'), b = await repository.createSession('B');
    const system = createSessionAttachmentMounts(repository); cleanup.push(() => system.dispose());
    const service = new SessionFilesService(root, id => system.forSession(id)); await service.initialize(); cleanup.push(() => service.dispose());
    await repository.writeDocument(a, 'round-a.json', '{"message":"A"}');
    await repository.writeAttachment(a, 'one.bin', new Uint8Array([0, 255]).buffer);
    const source = await service.acquireFiles(a, '/'); cleanup.push(() => source.release());
    const editorAssets = createFileSystemView({ viewId: 'editor-assets', mounts: [{ mountId: 'assets', at: '/', root: '/attachments', fs: source.context.fs, access: 'rw' }] });
    cleanup.push(() => editorAssets.dispose());
    service.registerSource('session-a', source.context.fs);
    await service.configure(b, { mounts: [{ mountId: 'other', at: '/other', sourceId: 'session-a', root: '/', access: 'ro' }], cwd: '/' }, 0);
    const target = await service.acquireFiles(b, '/'); cleanup.push(() => target.release());
    await expect(target.context.fs.driver.readContent('/other/history/round-a.json')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(new Uint8Array(await target.context.fs.driver.readContent('/other/attachments/one.bin', { encoding: 'binary' }))).toEqual(new Uint8Array([0, 255]));
    await expect(target.context.fs.driver.writeContent('/other/attachments/one.bin', 'no')).rejects.toMatchObject({ code: 'EROFS' });
    await expect(target.context.fs.driver.readContent(`/var/lib/sessions/${a}/history.seq`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(service.configure(b, { mounts: [{ mountId: 'override', at: '/history', sourceId: 'session-a', access: 'rw' }], cwd: '/workspace' }, 1)).rejects.toMatchObject({ code: 'EACCES' });
    await repository.writeDocument(a, 'round-a.json', '{"message":"latest"}');
    await expect(target.context.fs.driver.readContent('/other/history/round-a.json')).rejects.toMatchObject({ code: 'ENOENT' });
    await service.disable(a, 0);
    await expect(editorAssets.driver.readContent('/one.bin')).rejects.toMatchObject({ code: 'EACCES' });
    await expect(editorAssets.driver.createFile({ name: 'after.bin', parentPath: '/', content: 'no' })).rejects.toMatchObject({ code: 'EACCES' });
    await expect(target.context.fs.driver.readContent('/other/attachments/one.bin')).rejects.toMatchObject({ code: 'EACCES' });
});
