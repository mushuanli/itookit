import { afterEach, expect, it } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { Kernel } from '@itookit/durable-kernel';
import { SessionDirectoryStorageResolver, SessionRepository, sessionDirectoryStorage } from '@itookit/llm-session';
import { SessionLifecycleService } from '../src/files/session-browser';

let cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup = []; });

async function setup() {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() }); cleanup.push(() => manager.dispose());
    const fs = await manager.openFileSystem('/');
    const repository = new SessionRepository(fs); await repository.init(); cleanup.push(() => repository.dispose());
    const startKernel = async () => {
        const kernel = new Kernel({ catalog: { fs, rootPath: '/var/lib/kernel' } });
        kernel.registerStorageResolver(new SessionDirectoryStorageResolver(fs));
        await kernel.initialize();
        cleanup.push(async () => { kernel.dispose(); await kernel.waitIdle(); });
        return kernel;
    };
    const kernel = await startKernel();
    return {
        fs, repository, kernel,
        lifecycle: new SessionLifecycleService({ repository, kernel }),
        async restart() {
            kernel.dispose(); await kernel.waitIdle();
            const next = await startKernel();
            return { kernel: next, lifecycle: new SessionLifecycleService({ repository, kernel: next }) };
        },
    };
}

it('keeps every record when the Kernel layout still blocks the physical delete', async () => {
    const f = await setup();
    const id = await f.repository.createSession('Guarded');
    await f.repository.writeDocument(id, 'round-r1.json', JSON.stringify({ id: 'r1', input: [], output: [] }));
    await f.kernel.createSession({ id, storage: sessionDirectoryStorage(id) });

    await expect(f.repository.deleteSession(id)).rejects.toMatchObject({ code: 'EBUSY' });
    expect((await f.repository.getManifest(id)).id).toBe(id);
    expect(await f.repository.readDocument(id, 'round-r1.json')).toContain('r1');
});

it('deletes through the lifecycle service: close, remove Kernel state, then records', async () => {
    const f = await setup();
    const id = await f.repository.createSession('Disposable');
    await f.repository.writeDocument(id, 'round-r1.json', JSON.stringify({ id: 'r1', input: [], output: [] }));
    await f.kernel.createSession({ id, storage: sessionDirectoryStorage(id) });

    await f.lifecycle.deleteSession(id);
    await expect(f.repository.getManifest(id)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.fs.driver.exists(`/var/lib/sessions/${id}`)).toBe(false);
    const ids: string[] = []; for await (const record of f.kernel.listSessions()) ids.push(record.id);
    expect(ids).not.toContain(id);
});

it('deletes a Session that never reached the Kernel', async () => {
    const f = await setup();
    const id = await f.repository.createSession('Never ran');
    await f.lifecycle.deleteSession(id);
    await expect(f.repository.getManifest(id)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('resumes an interrupted deletion after a Kernel restart', async () => {
    const f = await setup();
    const id = await f.repository.createSession('Interrupted');
    await f.repository.writeDocument(id, 'round-r1.json', JSON.stringify({ id: 'r1', input: [], output: [] }));
    const session = await f.kernel.createSession({ id, storage: sessionDirectoryStorage(id) });
    await session.setShared('stale', 'value');
    await f.kernel.closeSession(id, true);
    // Interrupted removal: Kernel storage gone, records and catalog entry remain.
    await f.fs.driver.updateMetadata(`/var/lib/sessions/${id}/kernel`, { vfsFixedLayout: false });
    await f.fs.driver.delete([`/var/lib/sessions/${id}/kernel`], { recursive: true });

    const restarted = await f.restart();
    await restarted.lifecycle.deleteSession(id);

    await expect(f.repository.getManifest(id)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.fs.driver.exists(`/var/lib/sessions/${id}`)).toBe(false);
    const ids: string[] = []; for await (const record of restarted.kernel.listSessions()) ids.push(record.id);
    expect(ids).not.toContain(id);
});
