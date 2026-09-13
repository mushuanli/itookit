// @file: llm-flow/src/flow/scheduler-lease.ts
// Run 级调度所有权：让同一 Run 在任何时刻只有一个宿主在推进调度。
//
// 记录写在 Session shared `flow.run.<rootTaskId>.scheduler-owner`，带 epoch 与到期时间。
// 接管只在旧租约到期后发生（不能凭“我更快”强夺仍在心跳的拥有者），fencing 由每次调度
// 步进前的 assertOwned 完成：epoch 变化即停止推进，旧拥有者的后续写入不会推进业务状态。

import type { JsonValue, SessionHandle } from '@itookit/durable-kernel';

export interface SchedulerLeaseRecord {
    version: 1;
    ownerId: string;
    /** 每次成功接管递增；同一 owner 续租不变。 */
    epoch: number;
    expiresAt: number;
}

/** 抛给调度循环的哨兵错误：本宿主已不是该 Run 的调度者，应停止推进而不是把 Run 判失败。 */
export class SchedulerOwnershipLostError extends Error {
    constructor(readonly epoch: number) {
        super(`Flow scheduler ownership lost (epoch ${epoch})`);
        this.name = 'SchedulerOwnershipLostError';
    }
}

export function isSchedulerOwnershipLost(error: unknown): error is SchedulerOwnershipLostError {
    return error instanceof SchedulerOwnershipLostError;
}

export interface SchedulerLeaseOptions {
    /** 租约有效期，默认 30s；到期后其他宿主可接管。 */
    ttlMs?: number;
    /**
     * 明确的跨主机时钟误差约束（默认 0，仅本机/同时钟源部署）。
     * 接管要求旧租约到期后再经过 skewMs，避免快时钟宿主抢走慢时钟宿主的活租约。
     */
    skewMs?: number;
    /** 测试或宿主指定身份；默认随机生成。 */
    ownerId?: string;
    /** 时钟注入，便于测试到期与接管。 */
    now?(): number;
}

export interface SchedulerLease {
    readonly ownerId: string;
    readonly epoch: number;
    /** 每次调度步进前调用；租约丢失（被接管/过期）时抛错。 */
    assertOwned(): Promise<void>;
    /** 主动放弃所有权，使后续 resume 无需等待到期。 */
    release(): Promise<void>;
}

/** Session shared key holding the Run's scheduler ownership record. */
export const schedulerOwnerKey = (rootTaskId: string): string => `flow.run.${rootTaskId}.scheduler-owner`;

export async function acquireSchedulerLease(
    session: SessionHandle,
    rootTaskId: string,
    options: SchedulerLeaseOptions = {},
): Promise<SchedulerLease> {
    const key = schedulerOwnerKey(rootTaskId);
    const ttlMs = Math.max(1_000, options.ttlMs ?? 30_000);
    const skewMs = options.skewMs ?? 0;
    if (!Number.isSafeInteger(skewMs) || skewMs < 0) throw new Error('skewMs must be a non-negative safe integer');
    const now = (): number => options.now?.() ?? Date.now();
    const ownerId = options.ownerId ?? createOwnerId();
    for (let attempt = 0; attempt < 5; attempt++) {
        const saved = await session.getShared(key);
        const current = parseRecord(saved?.value);
        if (current && current.ownerId !== ownerId && current.expiresAt > 0 && current.expiresAt + skewMs > now()) {
            const until = new Date(current.expiresAt + skewMs).toISOString();
            throw new Error(`Run is scheduled by ${current.ownerId} until ${until};`
                + (skewMs > 0 ? ` takeover waits for the configured ${skewMs}ms clock skew budget;` : '')
                + ' wait for the lease to expire or stop the other host');
        }
        const record: SchedulerLeaseRecord = {
            version: 1, ownerId, epoch: (current?.epoch ?? 0) + 1, expiresAt: now() + ttlMs,
        };
        try {
            await session.setShared(key, record as unknown as JsonValue, { expectedVersion: saved?.version ?? null });
            return createLease(session, key, record, ttlMs, now);
        } catch (error) {
            // Another host took over between read and write; retry with its epoch.
            if (attempt === 4) throw error;
        }
    }
    throw new Error('Scheduler lease acquisition failed');
}

function createLease(
    session: SessionHandle,
    key: string,
    record: SchedulerLeaseRecord,
    ttlMs: number,
    now: () => number,
): SchedulerLease {
    let released = false;
    const heartbeat = setInterval(() => { void renew(); }, Math.max(250, Math.floor(ttlMs / 3)));
    (heartbeat as unknown as { unref?: () => void }).unref?.();
    const renew = async (): Promise<void> => {
        if (released) return;
        const saved = await session.getShared(key).catch(() => undefined);
        const current = parseRecord(saved?.value);
        if (!current || current.ownerId !== record.ownerId || current.epoch !== record.epoch) return;
        await session.setShared(key, { ...current, expiresAt: now() + ttlMs } as unknown as JsonValue,
            { expectedVersion: saved?.version ?? null }).catch(() => undefined);
    };
    return {
        ownerId: record.ownerId,
        epoch: record.epoch,
        async assertOwned(): Promise<void> {
            const current = parseRecord((await session.getShared(key))?.value);
            if (!current || current.ownerId !== record.ownerId || current.epoch !== record.epoch) {
                throw new SchedulerOwnershipLostError(record.epoch);
            }
        },
        async release(): Promise<void> {
            if (released) return;
            released = true;
            clearInterval(heartbeat);
            const saved = await session.getShared(key).catch(() => undefined);
            const current = parseRecord(saved?.value);
            if (!current || current.ownerId !== record.ownerId || current.epoch !== record.epoch) return;
            await session.setShared(key, { ...current, expiresAt: 0 } as unknown as JsonValue,
                { expectedVersion: saved?.version ?? null }).catch(() => undefined);
        },
    };
}

function parseRecord(value: JsonValue | undefined): SchedulerLeaseRecord | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const record = value as Record<string, JsonValue>;
    const ownerId = record.ownerId, epoch = record.epoch, expiresAt = record.expiresAt;
    if (typeof ownerId !== 'string' || !ownerId) return undefined;
    if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1) return undefined;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return undefined;
    return { version: 1, ownerId, epoch, expiresAt };
}

function createOwnerId(): string {
    return `scheduler-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
