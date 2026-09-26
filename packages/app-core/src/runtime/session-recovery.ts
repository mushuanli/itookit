import { traceBoot } from '@itookit/common';
import type { Kernel } from '@itookit/durable-kernel';
import { SessionLeaseStore, type SessionLeaseRecord, type SessionOwnerKind } from '../kernel/session-lease';

type RecoveryKernel = Pick<Kernel, 'listSessions' | 'recoverSessions' | 'recoverSession'>;
type Owner = { id: string; kind: SessionOwnerKind };
export interface SessionRecovery {
    leases: Map<string, SessionLeaseRecord>;
    /** Acquire and recover before admitting writes; concurrent requests share one recovery. */
    acquireLater(sessionId: string): Promise<boolean>;
    acquireMetadataLease(sessionId: string): Promise<boolean>;
    release(): Promise<void>;
}

class LeasedRecovery implements SessionRecovery {
    readonly leases = new Map<string, SessionLeaseRecord>();
    private readonly ready = new Set<string>();
    private readonly pending = new Map<string, Promise<boolean>>();
    private readonly renewals = new Map<string, Promise<boolean>>();
    private readonly heartbeat: ReturnType<typeof setInterval>;
    private released = false;
    constructor(private kernel: RecoveryKernel, private store: SessionLeaseStore, private owner: Owner,
        heartbeatMs: number, private beforeRecover?: (sessionId: string) => Promise<void>, private excluded = new Set<string>()) {
        this.heartbeat = setInterval(() => {
            for (const id of this.leases.keys()) void this.renew(id).catch(error => console.warn(`[Lease] renew failed for Session ${id}`, error));
        }, heartbeatMs);
    }

    async boot(): Promise<void> {
        for await (const session of this.kernel.listSessions()) {
            if (this.excluded.has(session.id) || !await this.acquire(session.id)) continue;
            await this.beforeRecover?.(session.id);
        }
        if (this.leases.size) await traceBoot('recoverLeasedSessions', () => this.kernel.recoverSessions([...this.leases.keys()], { takeover: true }));
        for (const id of this.leases.keys()) this.ready.add(id);
    }

    async acquireMetadataLease(id: string): Promise<boolean> {
        if (this.released) return false;
        return await this.renew(id) || await this.acquire(id);
    }

    acquireLater(id: string): Promise<boolean> {
        if (this.released || this.excluded.has(id)) return Promise.resolve(false);
        const current = this.pending.get(id);
        if (current) return current;
        const work = this.prepare(id);
        this.pending.set(id, work);
        void work.finally(() => { if (this.pending.get(id) === work) this.pending.delete(id); }).catch(() => {});
        return work;
    }

    private async prepare(id: string): Promise<boolean> {
        if (await this.renew(id) && this.ready.has(id)) return !this.released;
        if (this.released || !await this.acquire(id)) return false;
        try {
            await this.beforeRecover?.(id);
            // Online recovery respects existing Task/Effect leases; it never fences work in other Sessions.
            await this.kernel.recoverSession(id);
            if (this.released || !await this.renew(id)) return false;
            this.ready.add(id);
            return true;
        } catch (error) {
            this.ready.delete(id);
            const lease = this.leases.get(id);
            this.leases.delete(id);
            if (lease) await this.store.release(lease);
            throw error;
        }
    }

    private async acquire(id: string): Promise<boolean> {
        const lease = await this.store.acquire(id, this.owner);
        if (!lease) {
            const held = await this.store.inspect(id);
            console.warn(`[Shell] Session ${id} is owned by ${held?.ownerKind}:${held?.ownerId} until ${held ? new Date(held.leaseUntil).toISOString() : 'unknown'}; leaving it read-only`);
            return false;
        }
        this.leases.set(id, lease);
        return true;
    }

    private renew(id: string): Promise<boolean> {
        const existing = this.renewals.get(id);
        if (existing) return existing;
        const work = this.renewLease(id);
        this.renewals.set(id, work);
        void work.finally(() => { if (this.renewals.get(id) === work) this.renewals.delete(id); }).catch(() => {});
        return work;
    }

    private async renewLease(id: string): Promise<boolean> {
        const lease = this.leases.get(id);
        if (!lease) return false;
        try {
            const renewed = await this.store.renew(lease);
            if (this.leases.get(id)?.fencingToken !== lease.fencingToken) return false;
            if (renewed) { this.leases.set(id, renewed); return true; }
            this.leases.delete(id); this.ready.delete(id);
            console.warn(`[Lease] ownership lost for Session ${id}; writes require reacquisition`);
            return false;
        } catch (error) {
            this.leases.delete(id); this.ready.delete(id);
            throw error;
        }
    }

    async release(): Promise<void> {
        if (this.released) return;
        this.released = true;
        clearInterval(this.heartbeat);
        await Promise.allSettled([...this.pending.values(), ...this.renewals.values()]);
        const results = await Promise.allSettled([...this.leases.values()].map(lease => this.store.release(lease)));
        this.leases.clear(); this.ready.clear();
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length) throw new AggregateError(errors, 'Session lease cleanup failed');
    }
}

/** Boot may take over an idle Kernel; later acquisition recovers only the selected Session online. */
export async function recoverSessionsWithLeases(kernel: RecoveryKernel, leaseStore: SessionLeaseStore, owner: Owner,
    heartbeatMs = 10_000, beforeRecover?: (sessionId: string) => Promise<void>, excluded = new Set<string>()): Promise<SessionRecovery> {
    const recovery = new LeasedRecovery(kernel, leaseStore, owner, heartbeatMs, beforeRecover, excluded);
    try { await recovery.boot(); return recovery; }
    catch (error) {
        try { await recovery.release(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Session recovery and lease cleanup failed'); }
        throw error;
    }
}
