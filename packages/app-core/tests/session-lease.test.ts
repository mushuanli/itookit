import { describe, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { SessionLeaseStore } from '../src/index';

describe('SessionLeaseStore', () => {
    it('shares concurrent initialization, then retries once after a failed attempt', async () => {
        const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
        const fs = await manager.openFileSystem('/data');
        try {
            const store = new SessionLeaseStore(fs);
            const exists = vi.spyOn(fs.driver, 'exists').mockRejectedValueOnce(new Error('temporary storage error'));
            const failed = await Promise.allSettled([store.init(), store.init(), store.init()]);
            expect(failed.every(result => result.status === 'rejected')).toBe(true);
            expect(exists).toHaveBeenCalledTimes(1);
            await Promise.all([store.init(), store.init(), store.init()]);
            expect(exists.mock.calls.filter(([path]) => path.endsWith('session-leases.seq'))).toHaveLength(2);
            expect(await store.acquire('s', { id: 'owner', kind: 'cli' })).not.toBeNull();
        } finally { await manager.dispose(); }
    });

    it('initializes the configured lease file and can renew its lease', async () => {
        const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
        const fs = await manager.openFileSystem('/data');
        try {
            const path = '/custom/nested/leases.seq';
            const store = new SessionLeaseStore(fs, { path });
            const lease = (await store.acquire('s', { id: 'owner', kind: 'cli' }))!;
            expect(await fs.driver.exists(path)).toBe(true);
            expect(await fs.driver.exists('/var/lib/kernel/session-leases.seq')).toBe(false);
            expect(await store.renew(lease)).toBeTruthy();
        } finally { await manager.dispose(); }
    });

    it.each([-1, 0.5, NaN, Infinity])('rejects invalid skew allowance %s', skewMs => {
        expect(() => new SessionLeaseStore({} as never, { skewMs })).toThrow('skewMs');
    });

    it('ensures the lease file once per store instead of on every operation', async () => {
        const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
        const fs = await manager.openFileSystem('/data');
        try {
            const exists = vi.spyOn(fs.driver, 'exists');
            const store = new SessionLeaseStore(fs);

            // The 10s heartbeat calls renew(), which re-enters init(): a per-call `exists`
            // is a hot-path round trip on every renew.
            await store.inspect('session-a');
            await store.inspect('session-b');
            await store.acquire('session-a', { id: 'owner', kind: 'cli' });
            await store.release((await store.inspect('session-a'))!);

            const leaseChecks = exists.mock.calls
                .filter(([path]) => String(path).endsWith('session-leases.seq')).length;
            expect(leaseChecks).toBe(1);
        } finally {
            await manager.dispose();
        }
    });

    it('waits out the configured clock-skew budget before taking over a live Session lease', async () => {
        const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
        const fs = await manager.openFileSystem('/data');
        try {
            let now = 0;
            const store = new SessionLeaseStore(fs, { ttlMs: 1_000, skewMs: 5_000, now: () => now });
            const first = (await store.acquire('session-a', { id: 'host-a', kind: 'cli' }))!;
            expect(first.leaseUntil).toBe(1_000);

            // Local time says the lease expired, but a fast clock must not steal it.
            now = 1_001;
            expect(await store.acquire('session-a', { id: 'host-b', kind: 'cli' })).toBeNull();
            expect((await store.inspect('session-a'))?.ownerId).toBe('host-a');
            now = 6_000;
            const takeover = (await store.acquire('session-a', { id: 'host-b', kind: 'cli' }))!;
            expect(takeover).toMatchObject({ ownerId: 'host-b', fencingToken: 2 });
        } finally {
            await manager.dispose();
        }
    });

    it('keeps takeover immediate when no skew budget is configured', async () => {
        const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
        const fs = await manager.openFileSystem('/data');
        try {
            let now = 0;
            const store = new SessionLeaseStore(fs, { ttlMs: 1_000, now: () => now });
            await store.acquire('session-a', { id: 'host-a', kind: 'cli' });
            now = 1_001;
            expect(await store.acquire('session-a', { id: 'host-b', kind: 'cli' })).toMatchObject({ ownerId: 'host-b' });
        } finally {
            await manager.dispose();
        }
    });
});
