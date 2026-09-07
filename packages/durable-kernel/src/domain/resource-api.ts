import type { JsonValue, ResourceRight } from './types';

/** Managed resources share one transactional module. Scope is an identity, not a path. */
export interface ManagedResourceRef { id: string; scope: string; }
export interface ManagedResource {
    ref: ManagedResourceRef;
    kind: 'pool' | 'shared';
    name: string;
    version: number;
    capacity?: number;
    value?: JsonValue;
    state?: 'active' | 'closing' | 'tombstoned';
    physical?: PhysicalResourceBinding;
}
export interface ManagedHandle {
    id: string;
    ref: ManagedResourceRef;
    sessionId: string;
    taskId: string;
    rights: ResourceRight[];
    name: string;
    closed: boolean;
    grantEpochs?: Partial<Record<ResourceRight, number>>;
}
export interface ResourceClaim {
    id: string;
    ref: ManagedResourceRef;
    handleId: string;
    sessionId: string;
    taskId: string;
    quantity: number;
    token: string;
    released: boolean;
    state?: 'held' | 'cleanup-pending' | 'released';
    epoch?: number;
    cleanupId?: string;
}
export type ResourceResult = ManagedResource | ManagedHandle | ResourceClaim | ManagedGrant | { ok: true };
export interface ResourceRequestSnapshot<T = ResourceResult> {
    id: string;
    scope: string;
    status: 'pending' | 'succeeded' | 'cancelled' | 'failed';
    result?: T;
    error?: string;
}
export interface DurableResourceRequest<T = ResourceResult> {
    readonly id: string;
    poll(): Promise<ResourceRequestSnapshot<T>>;
    wait(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T>;
    cancel(): Promise<ResourceRequestSnapshot<T>>;
}
export type ResourceCommand = { requestId: string } & (
    | { type: 'create'; kind: 'pool' | 'shared'; name: string; capacity?: number; value?: JsonValue; physical?: PhysicalResourceBinding }
    | { type: 'share'; ref: ManagedResourceRef; toSessionId: string; rights: ResourceRight[] }
    | { type: 'revoke'; ref: ManagedResourceRef; toSessionId: string; rights?: ResourceRight[]; expectedRevision: number }
    | { type: 'destroy'; ref: ManagedResourceRef; expectedVersion: number }
    | { type: 'open'; ref: ManagedResourceRef; taskId?: string; rights: ResourceRight[]; name: string }
    | { type: 'acquire'; handle: ManagedHandle; quantity: number; deadlineAt?: number }
    | { type: 'release'; claim: ResourceClaim }
    | { type: 'close'; handle: ManagedHandle }
    | { type: 'read'; handle: ManagedHandle }
    | { type: 'write'; handle: ManagedHandle; expectedVersion: number; value: JsonValue }
);
export interface ManagedResourceStat { resource: ManagedResource; held: number; waiting: number; }
export interface ResourceApi {
    create(spec: Omit<Extract<ResourceCommand, { type: 'create' }>, 'type'>): Promise<DurableResourceRequest<ManagedResource>>;
    share(ref: ManagedResourceRef, options: { requestId: string; toSessionId: string; rights: ResourceRight[] }): Promise<DurableResourceRequest<{ ok: true }>>;
    revoke(ref: ManagedResourceRef, options: { requestId: string; toSessionId: string; rights?: ResourceRight[]; expectedRevision: number }): Promise<DurableResourceRequest<ManagedGrant>>;
    destroy(ref: ManagedResourceRef, options: { requestId: string; expectedVersion: number }): Promise<DurableResourceRequest<ManagedResource>>;
    query(options: ResourceQuery): Promise<ResourcePage>;
    open(ref: ManagedResourceRef, options: { requestId: string; taskId?: string; rights: ResourceRight[]; name: string }): Promise<DurableResourceRequest<ManagedHandle>>;
    acquire(handle: ManagedHandle, options: { requestId: string; quantity: number; deadlineAt?: number }): Promise<DurableResourceRequest<ResourceClaim>>;
    release(claim: ResourceClaim, options: { requestId: string }): Promise<DurableResourceRequest<ResourceClaim>>;
    close(handle: ManagedHandle, options: { requestId: string }): Promise<DurableResourceRequest<ManagedHandle>>;
    read(handle: ManagedHandle, options: { requestId: string }): Promise<DurableResourceRequest<ManagedResource>>;
    write(handle: ManagedHandle, options: { requestId: string; expectedVersion: number; value: JsonValue }): Promise<DurableResourceRequest<ManagedResource>>;
    request(scope: string, requestId: string): DurableResourceRequest;
    stat(ref: ManagedResourceRef): Promise<ManagedResourceStat>;
    validate(claim: ResourceClaim): Promise<ResourceClaim>;
    list(): Promise<ManagedHandle[]>;
}


export interface PhysicalResourceBinding { kind: string; version: string; externalId: string; }
export interface ManagedGrant {
    id: string;
    resourceId: string;
    sessionId: string;
    revision: number;
    rights: ResourceRight[];
    epochs: Partial<Record<ResourceRight, number>>;
    state: 'active' | 'revoked';
}
export interface ResourceCleanup {
    id: string;
    ref: ManagedResourceRef;
    claimId?: string;
    epoch: number;
    physical: PhysicalResourceBinding;
    status: 'pending' | 'unknown' | 'succeeded';
    attempts: number;
    nextAttemptAt: number;
    error?: string;
    receipt?: ResourceCleanupReceipt;
}
export interface ResourceCleanupReceipt {
    operationId: string;
    epoch: number;
    /** stopped means the capacity is physically reusable (or the resource was deleted). */
    status: 'stopped' | 'pending' | 'unknown';
    error?: string;
    retryAfterMs?: number;
}
export interface ResourceCleanupContext {
    operationId: string;
    epoch: number;
    resource: ManagedResourceRef;
    physical: PhysicalResourceBinding;
    claim?: ResourceClaim;
    signal: AbortSignal;
}
/** Calls must reconcile/retry the same operation idempotently after restart or timeout. */
export interface ManagedResourceAdapter {
    readonly kind: string;
    readonly version: string;
    readonly timeoutMs?: number;
    cleanup(context: ResourceCleanupContext): Promise<ResourceCleanupReceipt>;
    destroy(context: ResourceCleanupContext): Promise<ResourceCleanupReceipt>;
}
export interface ResourceQuery {
    kind: 'resources' | 'claims' | 'requests' | 'grants' | 'cleanups';
    scope?: string;
    sessionId?: string;
    taskId?: string;
    state?: string;
    limit?: number;
    cursor?: string;
}
export interface ResourceRequestInfo {
    id: string;
    scope: string;
    sessionId?: string;
    taskId?: string;
    operation?: ResourceCommand['type'];
    status: ResourceRequestSnapshot['status'];
    error?: string;
}
export interface ResourcePage {
    items: Array<ManagedResource | ResourceClaim | ManagedGrant | ResourceCleanup | ResourceRequestInfo>;
    /** Live keyset pagination; each page rechecks access, not a historical snapshot. */
    nextCursor?: string;
}
