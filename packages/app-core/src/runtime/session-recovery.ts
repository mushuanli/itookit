import { traceBoot } from '@itookit/common';
import type { Kernel } from '@itookit/durable-kernel';
import { SessionLeaseStore, type SessionLeaseRecord, type SessionOwnerKind } from '../kernel/session-lease';

/** A refused lease is the only reason a Session stays read-only; name the holder and its expiry. */
async function describeHolder(leaseStore: SessionLeaseStore, sessionId: string): Promise<string> {
    const held = await leaseStore.inspect(sessionId).catch(() => null);
    if (!held) return 'another host';
    const remaining = Math.max(0, held.leaseUntil - Date.now());
    return `${held.ownerKind}:${held.ownerId} until ${new Date(held.leaseUntil).toISOString()} (${Math.ceil(remaining / 1000)}s left)`;
}

export interface SessionRecovery {
    /** Leases this host holds; the heartbeat renews exactly this set. */
    leases: Map<string, SessionLeaseRecord>;
    /**
     * Take a lease for a Session registered after boot; its writes still need a restart.
     * Returns whether this host holds the lease afterwards (false when another host does).
     */
    acquireLater(sessionId: string): Promise<boolean>;
    /** Stop the heartbeat and release every held lease (idempotent). */
    release(): Promise<void>;
}

/**
 * Acquire Session leases, recover the selected batch, and keep its leases alive on a heartbeat.
 *
 * Recovery (and therefore writability) is decided at boot: a Session whose lease is
 * refused stays read-only, and a lease acquired later only reports that a restart is
 * required instead of looking healthy. The returned `release()` must run before the
 * host closes storage.
 */
export async function recoverSessionsWithLeases(
    kernel: Pick<Kernel, 'listSessions' | 'recoverSessions'>,
    leaseStore: SessionLeaseStore,
    owner: { id: string; kind: SessionOwnerKind },
    heartbeatMs = 10_000,
    beforeRecover?: (sessionId: string) => Promise<void>,
): Promise<SessionRecovery> {
    const leases = new Map<string, SessionLeaseRecord>();
    const heartbeat = setInterval(() => {
        for (const lease of leases.values()) {
            // Losing a lease silently would turn this Session read-only or hand it to
            // another host without any signal; make the failure observable.
            void leaseStore.renew(lease).catch(error => console.warn(
                `[Lease] renew failed for Session ${lease.sessionId}; it may be taken over by another host`, error));
        }
    }, heartbeatMs);

    const acquireLater = async (sessionId: string): Promise<boolean> => {
        if (leases.has(sessionId)) return true;
        const lease = await leaseStore.acquire(sessionId, { id: owner.id, kind: owner.kind });
        if (!lease) {
            console.warn(`[Shell] Session ${sessionId} is owned by ${await describeHolder(leaseStore, sessionId)}; leaving it read-only`);
            return false;
        }
        leases.set(sessionId, lease);
        console.warn(`[Shell] Session ${sessionId} lease acquired after boot (fencingToken=${lease.fencingToken}); restart to recover its writes`);
        return true;
    };

    try { for await (const session of kernel.listSessions()) {
        const lease = await leaseStore.acquire(session.id, { id: owner.id, kind: owner.kind });
        if (!lease) {
            console.warn(`[Boot] Session ${session.id} is owned by ${await describeHolder(leaseStore, session.id)}; leaving it read-only`);
            continue;
        }
        leases.set(session.id, lease);
        await beforeRecover?.(session.id);
    }
        if (leases.size) await traceBoot('recoverLeasedSessions', () => kernel.recoverSessions([...leases.keys()], { takeover: true }));
    } catch (error) {
        clearInterval(heartbeat);
        const closed = await Promise.allSettled([...leases.values()].map(lease => leaseStore.release(lease)));
        const errors = closed.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length) throw new AggregateError([error, ...errors], 'Session recovery and lease cleanup failed');
        throw error;
    }

    let released = false;
    return {
        leases,
        acquireLater,
        release: async () => {
            if (released) return;
            released = true;
            clearInterval(heartbeat);
            for (const lease of leases.values()) await leaseStore.release(lease).catch(() => false);
        },
    };
}
