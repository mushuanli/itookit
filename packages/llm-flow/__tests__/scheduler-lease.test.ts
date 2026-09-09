import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireSchedulerLease, isSchedulerOwnershipLost, schedulerOwnerKey } from '../src/flow/scheduler-lease';

/** Minimal versioned shared-state session, enough for the lease protocol. */
function fakeSession() {
    const entries = new Map<string, { value: unknown; version: number }>();
    return {
        entries,
        async getShared(key: string) { return entries.get(key); },
        async setShared(key: string, value: unknown, options?: { expectedVersion?: number | null }) {
            const current = entries.get(key);
            const expected = options?.expectedVersion ?? null;
            if ((current?.version ?? null) !== expected) throw new Error('Shared version conflict');
            entries.set(key, { value, version: (current?.version ?? 0) + 1 });
        },
    };
}

describe('acquireSchedulerLease', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('records ownership and refuses a live owner', async () => {
        const session = fakeSession();
        const first = await acquireSchedulerLease(session as never, 'root', { ownerId: 'host-a', now: () => 1_000 });
        expect(first).toMatchObject({ ownerId: 'host-a', epoch: 1 });
        expect(session.entries.get(schedulerOwnerKey('root'))?.value)
            .toEqual({ version: 1, ownerId: 'host-a', epoch: 1, expiresAt: 31_000 });
        await expect(acquireSchedulerLease(session as never, 'root', { ownerId: 'host-b', now: () => 1_000 }))
            .rejects.toThrow('scheduled by host-a');
        await first.release();
    });

    it('takes over only after the owner lease expires and increments the epoch', async () => {
        const session = fakeSession();
        await acquireSchedulerLease(session as never, 'root', { ownerId: 'host-a', ttlMs: 5_000, now: () => 0 });
        await expect(acquireSchedulerLease(session as never, 'root', { ownerId: 'host-b', now: () => 4_999 }))
            .rejects.toThrow('scheduled by host-a');
        const second = await acquireSchedulerLease(session as never, 'root', { ownerId: 'host-b', now: () => 5_001 });
        expect(second.epoch).toBe(2);
        await second.release();
    });

    it('fences an owner whose epoch was replaced and lets release hand over immediately', async () => {
        const session = fakeSession();
        const first = await acquireSchedulerLease(session as never, 'root', { ownerId: 'host-a', ttlMs: 60_000, now: () => 0 });
        await expect(first.assertOwned()).resolves.toBeUndefined();
        await first.release();
        const second = await acquireSchedulerLease(session as never, 'root', { ownerId: 'host-b', now: () => 1 });
        expect(second.epoch).toBe(2);
        await expect(first.assertOwned()).rejects.toSatisfy(isSchedulerOwnershipLost);
        // Releasing a fenced lease must not disturb the new owner.
        await first.release();
        expect((session.entries.get(schedulerOwnerKey('root'))?.value as { ownerId: string }).ownerId).toBe('host-b');
        await expect(second.assertOwned()).resolves.toBeUndefined();
    });

    it('renews the lease while the host is alive', async () => {
        vi.useFakeTimers();
        let now = 0;
        const session = fakeSession();
        const lease = await acquireSchedulerLease(session as never, 'root',
            { ownerId: 'host-a', ttlMs: 3_000, now: () => now });
        expect((session.entries.get(schedulerOwnerKey('root'))?.value as { expiresAt: number }).expiresAt).toBe(3_000);
        now = 2_500;
        await vi.advanceTimersByTimeAsync(1_000);
        expect((session.entries.get(schedulerOwnerKey('root'))?.value as { expiresAt: number }).expiresAt).toBe(5_500);
        await lease.release();
        const after = session.entries.get(schedulerOwnerKey('root'))?.value as { expiresAt: number };
        expect(after.expiresAt).toBe(0);
    });
});
