import { it, expect, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { ProjectExecutionStore } from '../src/projects/execution/store';
import { ProjectExecutionService } from '../src/projects/execution/service';
import type { ProjectRemoteMountService } from '../src/projects/remote-mounts';
async function fixture() {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    const mounts = [{ mountId: 'root', connectionId: 'c', at: '/', alias: 'docs', root: '/', access: 'rw' as const,
        credentialRef: 'secret', endpoint: 'http://localhost' }];
    const caps = { serverId: 'node', process: { exec: true }, terminal: { pty: false }, executionModel: 'trusted-cooperative-host',
        workspaceConsistency: 'cooperative', readOnlyEnforcement: 'best-effort' };
    const remote = { list: () => structuredClone(mounts), executionCapabilities: async () => caps,
        connection: () => ({ id: 'c', endpoint: 'http://localhost', credentialRef: 'secret' }) } as unknown as ProjectRemoteMountService;
    const release = vi.fn(async () => {}), acquire = vi.fn(async () => ({ cwd: '/workspace', nativeShell: {} as never, release }));
    const store = new ProjectExecutionStore(fs), service = new ProjectExecutionService(store, remote, async () => {}, async () => {}, { acquire });
    const target = { connectionId: 'c', serverId: 'node', requiredIsolation: 'trusted-cooperative-host' as const };
    return { manager, fs, mounts, caps, release, acquire, store, service, target };
}
it('persists an explicit target and supplies the same context for Session and scope consumers', async () => {
    const f = await fixture();
    try {
        expect(await f.service.acquire('p', 'session')).toBeUndefined();
        await f.service.bind('p', f.target);
        expect((await new ProjectExecutionStore(f.fs).read('p')).binding).toMatchObject(f.target);
        await f.service.acquire('p', 'session', 'scope');
        expect(f.acquire).toHaveBeenCalledWith(expect.objectContaining({ scopeId: 'scope', binding: expect.objectContaining({ mode: 'managed-copy' }) }));
        await f.service.clear('p'); expect(await f.service.get('p')).toBeNull();
    } finally { await f.manager.dispose(); }
});
it('rejects changed node identities and grants without invoking the process provider', async () => {
    const f = await fixture();
    try {
        await f.service.bind('p', f.target); f.caps.serverId = 'replacement';
        await expect(f.service.acquire('p', 's')).rejects.toMatchObject({ code: 'ECONFLICT' });
        f.caps.serverId = 'node'; f.mounts[0].root = '/other';
        await expect(f.service.acquire('p', 's')).rejects.toMatchObject({ code: 'ECONFLICT' });
        expect(f.acquire).not.toHaveBeenCalled();
    } finally { await f.manager.dispose(); }
});
it('does not equate command support to sandbox support or allow mixed execution nodes', async () => {
    const f = await fixture();
    try {
        await expect(f.service.bind('p', { ...f.target, requiredIsolation: 'sandbox' })).rejects.toMatchObject({ code: 'ECAPABILITY' });
        f.mounts.push({ ...f.mounts[0], at: '/ref', connectionId: 'other' });
        await expect(f.service.bind('p', f.target)).rejects.toMatchObject({ code: 'EXMOUNT' });
    } finally { await f.manager.dispose(); }
});
it('releases a prepared context when grants change during acquisition', async () => {
    const f = await fixture();
    try {
        await f.service.bind('p', f.target);
        f.acquire.mockImplementationOnce(async () => { f.mounts[0].root = '/changed'; return { cwd: '/', nativeShell: {} as never, release: f.release }; });
        await expect(f.service.acquire('p', 's')).rejects.toMatchObject({ code: 'ECONFLICT' }); expect(f.release).toHaveBeenCalledOnce();
    } finally { await f.manager.dispose(); }
});

it('validates target types before probing the node or persisting a binding', async () => {
    const f = await fixture();
    try {
        await expect(f.service.bind('p', { ...f.target, connectionId: undefined } as never)).rejects.toMatchObject({ code: 'EINVAL' });
        expect(await f.service.get('p')).toBeNull();
    } finally { await f.manager.dispose(); }
});
it('uses CAS without overwriting a binding saved by another caller', async () => {
    const f = await fixture();
    try {
        await f.service.bind('p', f.target);
        const stale = await f.store.read('p'); await f.service.clear('p');
        await expect(f.store.write('p', stale.raw, stale.binding)).rejects.toMatchObject({ code: 'ECONFLICT' });
        expect(await f.service.get('p')).toBeNull();
    } finally { await f.manager.dispose(); }
});
