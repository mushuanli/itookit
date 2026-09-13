import { describe, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionLeaseStore } from '../src/index';
import { recoverSessionsWithLeases } from '../src/runtime/session-recovery';
import { Kernel, SeqFileKernelStore } from '@itookit/durable-kernel';

describe('Session recovery with leases', () => {
    it('inspects and restores multiple leased Sessions before starting any workers', async () => {
        const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
        const fs = await manager.openFileSystem('/');
        const catalog = { fs, rootPath: '/catalog' };
        const resolve = async (ref: { locator: unknown }) => ({ fs, rootPath: String(ref.locator) });
        const store = new SeqFileKernelStore(catalog, resolve);
        await store.initialize();
        for (const id of ['first', 'second', 'busy']) await store.createSession(id, { kind: 'test', locator: `/${id}` });
        const kernel = new Kernel({ catalog, maxConcurrent: 0, pollMs: 0 });
        kernel.registerStorageResolver({ kind: 'test', resolve }); await kernel.initialize();
        const leases = new SessionLeaseStore(fs);
        await leases.acquire('busy', { id: 'other', kind: 'tauri' });
        try {
            const recovery = await recoverSessionsWithLeases(kernel, leases, { id: 'host', kind: 'tauri' }, 10_000,
                async id => { expect(await (await kernel.inspectSession(id)).listTasks()).toEqual([]); });
            expect([...recovery.leases.keys()].sort()).toEqual(['first', 'second']);
            expect((await leases.inspect('busy'))?.ownerId).toBe('other');
            await recovery.release();
        } finally { kernel.dispose(); await kernel.waitIdle(); await manager.dispose(); }
    });
    it('recovers only the Sessions it can lease and reports the rest read-only', async () => {
        const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
        const fs = await manager.openFileSystem('/data');
        try {
            const leaseStore = new SessionLeaseStore(fs);
            // Another host already owns `busy`; a refused lease must not recover it.
            expect(await leaseStore.acquire('busy', { id: 'other-host', kind: 'tauri' })).not.toBeNull();
            const kernel = {
                async *listSessions() { yield { id: 'free' }; yield { id: 'busy' }; },
                recoverSessions: vi.fn(async () => undefined),
            };
            const beforeRecover = vi.fn(async (id: string) => {
                expect((await leaseStore.inspect(id))?.ownerId).toBe('this-host');
                expect(kernel.recoverSessions).not.toHaveBeenCalled();
            });
            const recovery = await recoverSessionsWithLeases(kernel as never, leaseStore,
                { id: 'this-host', kind: 'cli' }, 10_000, beforeRecover);

            expect([...recovery.leases.keys()]).toEqual(['free']);
            expect(kernel.recoverSessions).toHaveBeenCalledTimes(1);
            expect(kernel.recoverSessions).toHaveBeenCalledWith(['free'], { takeover: true });
            expect(beforeRecover).toHaveBeenCalledExactlyOnceWith('free');

            // A Session registered after boot may be leased but cannot be recovered here; the
            // boolean is what the host's write gate uses to keep refused Sessions read-only.
            expect(await recovery.acquireLater('late')).toBe(true);
            expect(await recovery.acquireLater('busy')).toBe(false);
            expect([...recovery.leases.keys()].sort()).toEqual(['free', 'late']);
            expect(kernel.recoverSessions).toHaveBeenCalledTimes(1);

            await recovery.release();
            expect(await leaseStore.acquire('free', { id: 'next-host', kind: 'cli' })).not.toBeNull();
            // Idempotent: a second release must not fail or double-release.
            await recovery.release();
        } finally {
            await manager.dispose();
        }
    });

    it('releases acquired leases and stops recovery when host reconciliation fails', async () => {
        const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
        const fs = await manager.openFileSystem('/data');
        const leaseStore = new SessionLeaseStore(fs);
        const kernel = { async *listSessions() { yield { id: 'free' }; }, recoverSessions: vi.fn() };
        try {
            await expect(recoverSessionsWithLeases(kernel as never, leaseStore, { id: 'first', kind: 'tauri' }, 10_000,
                async () => { throw new Error('workspace reconciliation failed'); })).rejects.toThrow('workspace reconciliation failed');
            expect(kernel.recoverSessions).not.toHaveBeenCalled();
            const next = await leaseStore.acquire('free', { id: 'next', kind: 'tauri' });
            expect(next).not.toBeNull();
            await leaseStore.release(next!);
        } finally { await manager.dispose(); }
    });
});
