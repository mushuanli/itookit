import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { Kernel } from './application/kernel';
import { ManagedResourceStore } from './infrastructure/seqfile/managed-resources';
import { DurablePoller } from './runtime/durable-poller';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('reuses binding listeners without recreating layout and still validates current records', async () => {
    vi.useFakeTimers();
    const backend = new MemoryBackend();
    const { manager } = await createVFS({ rootBackend: backend });
    const fs = await manager.openFileSystem('/');
    const kernel = new Kernel({ catalog: { fs, rootPath: '/catalog' }, maxConcurrent: 0, pollMs: 0 });
    const storage = { kind: 'test', locator: '/session' };
    kernel.registerStorageResolver({ kind: 'test', async resolve() { return { fs, rootPath: '/session' }; } });
    try {
        await kernel.initialize(); await kernel.createSession({ id: 's', storage });
        const metadata = vi.spyOn(fs.driver, 'updateMetadata'), create = vi.spyOn(fs.driver, 'createFile');
        const start = vi.spyOn(DurablePoller.prototype, 'start');
        await kernel.openSession('s', storage); await kernel.openSession('s', storage);
        expect(metadata).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
        expect(start.mock.calls.flat()).not.toContain('session:s');
        await expect(kernel.openSession('s', { kind: 'other', locator: null })).rejects.toThrow('binding conflict');
        const record = JSON.parse((await fs.meta.seq!.getEntry('/session/session.seq', 'record'))!);
        await fs.meta.seq!.setEntry('/session/session.seq', 'record', JSON.stringify({ ...record, layout: { ...record.layout, layoutVersion: 999 } }));
        await expect(kernel.openSession('s', storage)).rejects.toThrow();
        // Simulate external removal, bypassing VFS's fixed-layout protection.
        await backend.delete('/session', { recursive: true });
        await expect(kernel.openSession('s', storage)).rejects.toThrow();
        expect(create).not.toHaveBeenCalled(); expect(metadata).not.toHaveBeenCalled();
    } finally { kernel.dispose(); await kernel.waitIdle(); await manager.dispose(); }
});

it('scans idle managed resources once and returns the deadline from the same transaction', async () => {
    const backend = new MemoryBackend();
    const { manager } = await createVFS({ rootBackend: backend });
    const fs = await manager.openFileSystem('/');
    const binding = { fs, rootPath: '/kernel' };
    const resources = new ManagedResourceStore(binding, async () => binding);
    try {
        await resources.initialize();
        const transaction = vi.spyOn(backend.records, 'transaction');
        const walk = vi.spyOn(backend.records, 'walkRecordFields');
        expect(await resources.sweep('kernel')).toBeUndefined();
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(walk.mock.calls.map(call => call[2]?.prefix)).toEqual(['managed/resource/', 'managed/request/', 'managed/cleanup/'].map(prefix => `__vfs_seq__:${prefix}`));
    } finally { resources.dispose(); await manager.dispose(); }
});

it('uses the deadline returned by a poll and wakes again on an explicit change', async () => {
    vi.useFakeTimers();
    const poll = vi.fn().mockResolvedValueOnce({ nextDelay: 50 }).mockResolvedValue({ nextDelay: undefined });
    const nextDelay = vi.fn();
    const poller = new DurablePoller({ intervalMs: 0, poll, nextDelay, onError: () => false });
    try {
        poller.start('s'); await vi.advanceTimersByTimeAsync(0);
        expect(poll).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(50); expect(poll).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1000); expect(poll).toHaveBeenCalledTimes(2);
        expect(nextDelay).not.toHaveBeenCalled();
        poller.start('s'); await vi.advanceTimersByTimeAsync(0); expect(poll).toHaveBeenCalledTimes(3);
    } finally { poller.dispose(); }
});
