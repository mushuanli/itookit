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
    it('executes persisted Tasks after late lease acquisition without restarting the Kernel', async () => {
        const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
        const fs = await manager.openFileSystem('/data'), catalog = { fs, rootPath: '/catalog' };
        const binding = { fs, rootPath: '/session' };
        const store = new SeqFileKernelStore(catalog, async () => binding);
        await store.initialize(); await store.createSession('s', { kind: 'test', locator: null });
        const saved = await store.createTask(binding, 's', { program: { kind: 'echo', version: '1' }, input: 'recovered' });
        const kernel = new Kernel({ catalog, pollMs: 5 });
        kernel.registerStorageResolver({ kind: 'test', async resolve() { return binding; } });
        kernel.registerProgram({ manifest: { kind: 'echo', version: '1' },
            init: input => ({ state: null, next: { type: 'complete', output: input } }), reduce: () => { throw new Error('complete'); } });
        await kernel.initialize();
        let now = 1000;
        const leases = new SessionLeaseStore(fs, { now: () => now, ttlMs: 100 });
        await leases.acquire('s', { id: 'old-tab', kind: 'web' });
        const recovery = await recoverSessionsWithLeases(kernel, leases, { id: 'new-tab', kind: 'web' });
        try {
            expect(recovery.leases.size).toBe(0);
            now += 101;
            expect(await recovery.acquireLater('s')).toBe(true);
            const task = await kernel.attachTask('s', saved.id);
            expect((await task.wait({ timeoutMs: 2000 })).output).toBe('recovered');
        } finally { kernel.dispose(); await kernel.waitIdle(); await recovery.release(); await manager.dispose(); }
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
                recoverSession: vi.fn(async () => undefined),
            };
            const beforeRecover = vi.fn(async (id: string) => {
                expect((await leaseStore.inspect(id))?.ownerId).toBe('this-host');
                if (id === 'free') expect(kernel.recoverSessions).not.toHaveBeenCalled();
            });
            const recovery = await recoverSessionsWithLeases(kernel as never, leaseStore,
                { id: 'this-host', kind: 'cli' }, 10_000, beforeRecover);

            expect([...recovery.leases.keys()]).toEqual(['free']);
            expect(kernel.recoverSessions).toHaveBeenCalledTimes(1);
            expect(kernel.recoverSessions).toHaveBeenCalledWith(['free'], { takeover: true });
            expect(beforeRecover).toHaveBeenCalledExactlyOnceWith('free');

            // Late acquisition must recover before the write gate grants access.
            expect(await recovery.acquireLater('late')).toBe(true);
            expect(kernel.recoverSession).toHaveBeenCalledExactlyOnceWith('late');
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

    it('recovers once after another owner expires and refuses writes after ownership is lost', async () => {
        const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
        const fs = await manager.openFileSystem('/data');
        let now = 1000;
        const store = new SessionLeaseStore(fs, { now: () => now, ttlMs: 100 });
        await store.acquire('s', { id: 'old-tab', kind: 'web' });
        let releaseRecovery!: () => void;
        const gate = new Promise<void>(resolve => { releaseRecovery = resolve; });
        const kernel = { async *listSessions() {}, recoverSessions: vi.fn(), recoverSession: vi.fn(async () => gate) };
        const recovery = await recoverSessionsWithLeases(kernel as never, store, { id: 'new-tab', kind: 'web' });
        try {
            expect(await recovery.acquireLater('s')).toBe(false);
            now += 101;
            const first = recovery.acquireLater('s'), second = recovery.acquireLater('s');
            expect(first).toBe(second);
            await vi.waitFor(() => expect(kernel.recoverSession).toHaveBeenCalledExactlyOnceWith('s'));
            releaseRecovery(); expect(await first).toBe(true);
            expect(await recovery.acquireLater('s')).toBe(true);
            expect(kernel.recoverSession).toHaveBeenCalledTimes(1);
            now += 101;
            await store.acquire('s', { id: 'third-tab', kind: 'web' });
            expect(await recovery.acquireLater('s')).toBe(false);
            expect(recovery.leases.has('s')).toBe(false);
            expect(kernel.recoverSessions).not.toHaveBeenCalled();
        } finally { releaseRecovery(); await recovery.release(); await manager.dispose(); }
    });

    it('does not admit writes when late recovery fails and allows a later retry', async () => {
        const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
        const fs = await manager.openFileSystem('/data'), store = new SessionLeaseStore(fs);
        const kernel = { async *listSessions() {}, recoverSessions: vi.fn(),
            recoverSession: vi.fn().mockRejectedValueOnce(new Error('recovery failed')).mockResolvedValue(undefined) };
        const recovery = await recoverSessionsWithLeases(kernel as never, store, { id: 'host', kind: 'web' });
        try {
            await expect(recovery.acquireLater('s')).rejects.toThrow('recovery failed');
            expect(recovery.leases.has('s')).toBe(false);
            expect(await recovery.acquireLater('s')).toBe(true);
        } finally { await recovery.release(); expect(await recovery.acquireLater('s')).toBe(false); await manager.dispose(); }
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
