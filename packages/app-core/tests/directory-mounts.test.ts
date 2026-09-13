import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionRepository } from '@itookit/llm-session';
import { SessionFilesService } from '@itookit/app-core';
import { createSessionAttachmentMounts } from '@itookit/app-core';
import { DirectoryMountService } from '@itookit/app-core';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup() {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() }); cleanup.push(() => manager.dispose());
    const root = await manager.openFileSystem('/');
    const repo = new SessionRepository(root); await repo.init(); cleanup.push(() => repo.dispose());
    const a = await repo.createSession('A'), b = await repo.createSession('B');
    const attachments = createSessionAttachmentMounts(repo); cleanup.push(() => attachments.dispose());
    const files = new SessionFilesService(root, id => attachments.forSession(id)); await files.initialize(); cleanup.push(() => files.dispose());
    files.registerSource('admin-home', await manager.openFileSystem('/home/admin'));
    await root.driver.createFile({ parentPath: '/home/admin/projects/demo', name: 'a.md', content: 'allowed', recursive: true });
    await root.driver.createFile({ parentPath: '/home/admin/notes', name: 'secret.md', content: 'unmounted', recursive: true });
    const after = vi.fn(async () => {}), before = vi.fn(async () => {});
    const mounts = new DirectoryMountService(root, files, undefined, before, after); await mounts.init();
    const acquire = async (id: string) => { const owner = await files.acquireFiles(id); cleanup.push(() => owner.release()); return owner.context; };
    return { root, files, mounts, a, b, acquire, after, before };
}
it('only grants attachments until the default directory is explicitly mounted', async () => {
    const f = await setup(); const empty = await f.acquire(f.a);
    expect((await empty.fs.driver.getChildren('/')).map(n => n.name)).toEqual(['attachments']);
    expect(empty.cwd).toBe('/');
    await f.mounts.setHome('~/projects/demo'); expect(await f.files.inspect(f.a)).toBeNull();
    const reopened = new DirectoryMountService(f.root, f.files); await reopened.init();
    expect(reopened.getHome()).toBe('/home/admin/projects/demo');
    await f.mounts.mountHome(f.a);
    const active = await f.acquire(f.a); expect(active.cwd).toBe('/workspace');
    expect(await active.fs.driver.readContent('/workspace/a.md', { encoding: 'utf-8' })).toBe('allowed');
    await expect(active.fs.driver.readContent('/home/admin/notes/secret.md')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await (await f.acquire(f.b)).fs.driver.getChildren('/')).map(n => n.name)).toEqual(['attachments']);
    await expect(empty.fs.driver.getChildren('/')).rejects.toMatchObject({ code: 'EACCES' });
});
it('defaults to read-write, attenuates explicit read-only, and removes grants without deleting data', async () => {
    const f = await setup(); await f.mounts.addDirectory(f.a, '~/projects/demo');
    expect((await f.files.inspect(f.a))?.mounts[0]).toMatchObject({ at: '/demo', access: 'rw' });
    const first = await f.acquire(f.a); await first.fs.driver.writeContent('/demo/a.md', 'changed');
    await f.mounts.addDirectory(f.a, '~/projects/demo', 'ro');
    const current = await f.acquire(f.a);
    await expect(first.fs.driver.readContent('/demo/a.md')).rejects.toMatchObject({ code: 'EACCES' });
    await expect(current.fs.driver.writeContent('/demo/a.md', 'no')).rejects.toMatchObject({ code: 'EROFS' });
    const mount = (await f.files.inspect(f.a))!.mounts[0]; await f.mounts.remove(f.a, mount.mountId);
    expect(await f.root.driver.readContent('/home/admin/projects/demo/a.md', { encoding: 'utf-8' })).toBe('changed');
    expect((await (await f.acquire(f.a)).fs.driver.getChildren('/')).map(n => n.name)).toEqual(['attachments']);
});
it('rejects reserved mount points, absent directories, and changes while the host guard refuses', async () => {
    const f = await setup();
    await expect(f.mounts.addDirectory(f.a, '~/projects/demo', 'rw', '/attachments')).rejects.toThrow('Reserved');
    await expect(f.mounts.addDirectory(f.a, '~/missing')).rejects.toThrow('不存在');
    f.before.mockRejectedValueOnce(new Error('Task active'));
    await expect(f.mounts.addDirectory(f.a, '~/projects/demo')).rejects.toThrow('Task active');
    expect(await f.files.inspect(f.a)).toBeNull(); expect(f.after).not.toHaveBeenCalled();
});
it('retains unavailable mounts, keeps attachments usable, and reconnects without changing the granted path', async () => {
    const f = await setup();
    await f.mounts.addDirectory(f.a, '~/projects/demo');
    const restarted = new SessionFilesService(f.root, async id => {
        const fs = (await f.acquire(id)).fs;
        return [{ mountId: 'attachments', at: '/attachments', root: '/attachments', fs, access: 'rw' }];
    });
    await restarted.initialize(); cleanup.push(() => restarted.dispose());
    const old = await restarted.acquireFiles(f.a); cleanup.push(() => old.release());
    expect((await old.context.fs.driver.getChildren('/')).map(n => n.name).sort()).toEqual(['attachments', 'demo']);
    await old.context.fs.driver.createFile({ parentPath: '/attachments', name: 'new.txt', content: 'own' });
    await expect(old.context.fs.driver.readContent('/demo/a.md')).rejects.toMatchObject({ code: 'EACCES' });
    // Registering the same identity restores the original config, not a different default directory.
    const { createFileSystemView } = await import('@itookit/vfs-core');
    const homeContext = createFileSystemView({ viewId: 'reconnected-home', mounts: [{ mountId: 'home', at: '/', root: '/home/admin', fs: f.root, access: 'rw' }] });
    cleanup.push(() => homeContext.dispose());
    restarted.registerSource('admin-home', homeContext);
    const current = await restarted.acquireFiles(f.a); cleanup.push(() => current.release());
    expect(await current.context.fs.driver.readContent('/demo/a.md', { encoding: 'utf-8' })).toBe('allowed');
    await expect(old.context.fs.driver.getChildren('/')).rejects.toMatchObject({ code: 'EACCES' });
});
