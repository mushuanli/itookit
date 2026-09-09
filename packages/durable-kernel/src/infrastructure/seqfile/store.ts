import { enqueueMessageTx, deliverMessageTx, consumeMessageTx } from './mailbox-store';
import { executeResourceTx, type PreparedResourceCommand } from './managed-resources';
import { createCacheTx, readCacheTx, publishCacheTx, invalidateCacheTx, renewCacheTx, manageCacheTx, listCachesTx } from './cache-store';
import { refreshWaiters, recoverWaitGraphTx, hasCancelledAncestorTx, validateRetrySourceTx } from './store-helpers';
import { assertDurableValue } from '../../application/durability';
import { snapshotKey, ensureTaskEventIndexTx, taskEventCountKey, taskEventKey } from './seqfile-core';

import type {
    BudgetAccount,
    ContextBranch,
    ContextCommit,
    ContextCommitOptions,
    CrossSessionMessage,

    EventEnvelope,
    InteractionResponse,
    PersistedEffect,
    RecoveryReport,
    ResourceHandle,
    ResourceRecord,
    ResourceRight,
    ResolvedStorageBinding,
    SessionId,
    SessionRecord,
    SharedStateEntry,
    SharedStateRevision,
    SharedStateWriteOptions,
    StorageBindingRef,
    TaskAttempt,
    TaskId,
    TaskRecord,
    TaskSignal,
    TaskSpec,
    WorkspaceDiff,
    WorkspaceSnapshot,
} from '../../domain/types';
import { advanceDependants,allHandlesTx,appendEventTx,applySharedMutations,applySpawnsTx,assertBudgetCapacity,assertBudgetVersion,assertClaim,assertContextHead,assertRightsSubset,assertSharedVersion,attemptKey,authorizeHandleTx,budgetAccount,budgetKey,cancelActiveEffects,catalogPath,claimMatches,claimTask,clearSeqRecords,collectContextHistory,contextBranchKey,contextCommitKey,contextPath,createId,decode,deletedRevision,dependencySatisfied,descendantHandleIds,effectAttempt,effectClaimMatches,encode,ensureSeqFile,ensureSessionLayout,ensureTaskLayout,ensureTree,eventsPath,finishAttemptTx,finishEffect,graphPath,handleKey,indexPath,indexTask,isTerminal,join,messagesPath,nextSharedVersion,outboxKey,readBudgetTx,readContextBranchTx,readMessages,readSharedTx,readTaskTx,readyCandidates,recoverEffect,registerTaskWaitTx,replaceEffectAttempt,requireContextParents,requireHandleTx,requireResourceTx,requireSessionTx,requireTaskTx,requireTransactionalSeq,resourceBudgetsTx,resourceKey,resourcesPath,seq,sessionPath,sessionRecordPaths,sharedEntry,sharedHistoryPrefix,sharedKey,sharedPath,taskFromSpec,taskPath,terminalDependency,transaction,uniqueRights,unregisterTaskWaitTx,validateSharedKey,wakeFromPendingEvents,wakeTaskWaiters,workspaceDiffKey,workspaceSnapshotKey,writeContextBranchTx,writeSharedHistory,writeSharedRevision,writeTaskTx } from './store-helpers';
import { KernelErrorCode, kernelError } from '../../domain/errors';

const SESSION_KEY = 'record';
const TASK_KEY = 'record';

export interface TaskClaim { task: TaskRecord; attempt: TaskAttempt; }
export interface EffectClaim { taskId: TaskId; effectId: string; effect: PersistedEffect; }
export interface EffectCompletion {
    result?: unknown;
    error?: import('../../domain/types').SerializableError;
    indeterminate?: boolean;
    retryable?: boolean;
}
export interface PreparedSpawn { id: TaskId; spawnKey: string; spec: TaskSpec; }
export interface TaskCommitSideEffects {
    resources?: PreparedResourceCommand[];
    messages?: import('../../domain/types').TaskMessageRequest[];
    cache?: Array<Extract<import('../../domain/types').KernelAction, { type: 'cache-read' | 'cache-publish' | 'cache-create' | 'cache-invalidate' | 'cache-renew' }>>;
    shared?: Array<
        { type: 'set'; key: string; value: import('../../domain/types').JsonValue; expectedVersion?: number | null }
        | { type: 'delete'; key: string; expectedVersion?: number | null }
    >;
    events?: Array<{ type: string; payload?: unknown }>;
    spawns?: PreparedSpawn[];
    attemptOutcome?: TaskAttempt['outcome'];
}

export class SeqFileKernelStore {
    constructor(
        private readonly catalog: ResolvedStorageBinding,
        private readonly resolveStorage: (reference: StorageBindingRef) => Promise<ResolvedStorageBinding>,
    ) {}

    async createCache(binding: ResolvedStorageBinding, taskId: string, spec: import('../../domain/cache').CacheSpec) {
        return transaction(binding.fs, tx => createCacheTx(tx, binding.rootPath, taskId, spec));
    }
    async readCache(binding: ResolvedStorageBinding, taskId: string, request: import('../../domain/cache').CacheRead) {
        return transaction(binding.fs, tx => readCacheTx(tx, binding.rootPath, taskId, request));
    }
    async publishCache(binding: ResolvedStorageBinding, taskId: string, request: import('../../domain/cache').CachePublish) {
        return transaction(binding.fs, tx => publishCacheTx(tx, binding.rootPath, taskId, request));
    }
    async invalidateCache(binding: ResolvedStorageBinding, taskId: string, handleId: string, expectedGeneration: number) {
        return transaction(binding.fs, tx => invalidateCacheTx(tx, binding.rootPath, taskId, handleId, expectedGeneration));
    }
    async renewCache(binding: ResolvedStorageBinding, taskId: string, handleId: string, expectedGeneration: number, ttlMs: number) {
        return transaction(binding.fs, tx => renewCacheTx(tx, binding.rootPath, taskId, handleId, expectedGeneration, ttlMs));
    }
    async listCaches(binding: ResolvedStorageBinding, taskId: string) {
        return transaction(binding.fs, tx => listCachesTx(tx, binding.rootPath, taskId));
    }

    async initialize(): Promise<void> {
        await ensureTree(this.catalog.fs, this.catalog.rootPath);
        await this.catalog.fs.driver.updateMetadata(this.catalog.rootPath, { vfsFixedLayout: true });
        await ensureSeqFile(this.catalog.fs, catalogPath(this.catalog.rootPath));
        requireTransactionalSeq(this.catalog.fs);
    }

    async createSession(id: SessionId, storage: StorageBindingRef): Promise<SessionRecord> {
        const binding = await this.resolveStorage(storage);
        await ensureSessionLayout(binding);
        const now = Date.now();
        const intent: SessionRecord = { id, status: 'open', storage, nextEventSeq: 1, version: 0,
            createdAt: now, updatedAt: now, registrationPending: true };
        await transaction(this.catalog.fs, async tx => {
            const key = `session/${id}`;
            const raw = await tx.getEntry(catalogPath(this.catalog.rootPath), key);
            if (raw) {
                if (encode(decode<SessionRecord>(raw).storage) !== encode(storage)) throw new Error('Session storage binding conflict');
            } else await tx.setEntry(catalogPath(this.catalog.rootPath), key, encode(intent));
        });
        const record = await transaction(binding.fs, async tx => {
            const raw = await tx.getEntry(sessionPath(binding.rootPath), SESSION_KEY);
            if (raw) {
                const current = decode<SessionRecord>(raw);
                if (current.id !== id || encode(current.storage) !== encode(storage)) throw new Error('Session storage already belongs to another session');
                return current;
            }
            const created = { ...intent, registrationPending: false };
            await tx.setEntry(sessionPath(binding.rootPath), SESSION_KEY, encode(created));
            await tx.setEntry(indexPath(binding.rootPath), 'task-order-version', '1');
            await appendEventTx(tx, binding.rootPath, id, undefined, 'session.created', created);
            return created;
        });
        await transaction(this.catalog.fs, tx => tx.setEntry(catalogPath(this.catalog.rootPath), `session/${id}`, encode(record)));
        return record;
    }

    /** Resolve existing storage without opening/scheduling the Session or changing metadata. */
    async inspectSessionBinding(id: SessionId): Promise<ResolvedStorageBinding> {
        const catalog = await this.readCatalog(id);
        if (!catalog) throw kernelError(KernelErrorCode.SESSION_NOT_FOUND, `Session not found: ${id}`);
        return this.resolveStorage(catalog.storage);
    }

    async openSession(id: SessionId): Promise<{ record: SessionRecord; binding: ResolvedStorageBinding }> {
        const catalog = await this.readCatalog(id);
        if (!catalog) throw kernelError(KernelErrorCode.SESSION_NOT_FOUND, `Session not found: ${id}`);
        const binding = await this.resolveStorage(catalog.storage);
        await binding.fs.driver.updateMetadata(binding.rootPath, { vfsFixedLayout: true });
        if (catalog.registrationPending) await this.createSession(id, catalog.storage);
        return { record: await this.readSession(binding), binding };
    }

    async listSessions(): Promise<SessionRecord[]> {
        const entries: SessionRecord[] = [];
        await seq(this.catalog.fs).walkEntries(catalogPath(this.catalog.rootPath), entry => {
            if (entry.key.startsWith('session/')) entries.push(decode(entry.value));
            return true;
        }, { keyPrefix: 'session/' });
        return entries.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    /**
     * Remove Kernel-owned Session storage and every catalog reference to it.
     *
     * Order matters for retry safety: release the fixed-layout pin, delete the
     * storage tree, clear the SeqFile records (they live outside the files), and
     * only then drop the catalog entry. An interrupted removal is therefore
     * repeatable — the catalog entry still resolves the binding until the end.
     */
    async removeSession(id: SessionId, binding: ResolvedStorageBinding): Promise<void> {
        const taskIds = await this.listTaskIds(binding);
        if (await binding.fs.driver.exists(binding.rootPath)) {
            await binding.fs.driver.updateMetadata(binding.rootPath, { vfsFixedLayout: false });
            await binding.fs.driver.delete([binding.rootPath], { recursive: true });
        }
        await clearSeqRecords(binding.fs, await sessionRecordPaths(binding, taskIds));
        await transaction(this.catalog.fs, async tx => {
            await tx.deleteEntry(catalogPath(this.catalog.rootPath), `session/${id}`);
            const stale: string[] = [];
            await tx.walkEntries(catalogPath(this.catalog.rootPath), entry => {
                if (entry.value === id) stale.push(entry.key);
                return true;
            }, { keyPrefix: 'task/' });
            for (const key of stale) await tx.deleteEntry(catalogPath(this.catalog.rootPath), key);
        });
    }

    async setSessionStatus(
        binding: ResolvedStorageBinding,
        status: SessionRecord['status'],
        closeMode?: 'drain' | 'cancel',
    ): Promise<SessionRecord> {
        const record = await transaction(binding.fs, async tx => {
            const value = await tx.getEntry(sessionPath(binding.rootPath), SESSION_KEY);
            if (!value) throw new Error(`Session record missing at ${binding.rootPath}`);
            const current = decode<SessionRecord>(value);
            const allowed: Record<SessionRecord['status'], SessionRecord['status'][]> = {
                open: ['open', 'suspended', 'suspending', 'closing'], suspending: ['suspending', 'suspended', 'closing'], suspended: ['suspended', 'open', 'closing'],
                closing: ['closing', 'closed'], closed: ['closed', 'archived'], archived: ['archived'],
            };
            if (!allowed[current.status].includes(status)) throw new Error(`Invalid session transition: ${current.status} -> ${status}`);
            if (status === 'closed') {
                let active = false;
                await tx.walkEntries(indexPath(binding.rootPath), row => { if (!isTerminal(decode<{ status: TaskRecord['status'] }>(row.value).status)) active = true; return true; }, { keyPrefix: 'task/' });
                if (active) throw new Error('Session still has unfinished tasks');
            }
            let nextStatus = status;
            if (status === 'open' || status === 'suspended' || (status === 'closing' && closeMode === 'drain')) {
                const ids: string[] = [];
                await tx.walkEntries(indexPath(binding.rootPath), row => { ids.push(row.key.slice(5)); return true; }, { keyPrefix: 'task/' });
                for (const id of ids) {
                    const task = await requireTaskTx(tx, binding.rootPath, id);
                    if (status === 'suspended' && Object.values(task.effects).some(e => e.status === 'leased' || e.status === 'indeterminate')) nextStatus = 'suspending';
                    if (isTerminal(task.status)) continue;
                    const held = status === 'suspended';
                    if (held && task.currentAttempt) await finishAttemptTx(tx, binding.rootPath, task, 'ready');
                    const nextTask: TaskRecord = { ...task, sessionPaused: held,
                        status: held && task.status === 'running' ? 'ready' : task.status,
                        currentAttempt: held ? undefined : task.currentAttempt,
                        stepAttemptCount: held && task.status === 'running' ? Math.max(0, (task.stepAttemptCount ?? 1) - 1) : task.stepAttemptCount,
                        version: task.version + 1, updatedAt: Date.now() };
                    await writeTaskTx(tx, binding.rootPath, nextTask); await indexTask(tx, binding.rootPath, nextTask);
                }
            }
            const next = { ...current, status: nextStatus, closeMode: closeMode ?? current.closeMode, version: current.version + 1, updatedAt: Date.now() };
            await tx.setEntry(sessionPath(binding.rootPath), SESSION_KEY, encode(next));
            await appendEventTx(tx, binding.rootPath, current.id, undefined, `session.${nextStatus}`, next);
            return next;
        });
        await transaction(this.catalog.fs, tx => tx.setEntry(
            catalogPath(this.catalog.rootPath), `session/${record.id}`, encode(record),
        ));
        return record;
    }

    async sessionRecord(binding: ResolvedStorageBinding): Promise<SessionRecord> {
        return this.readSession(binding);
    }

    async getShared<T extends import('../../domain/types').JsonValue>(
        binding: ResolvedStorageBinding,
        key: string,
    ): Promise<SharedStateEntry<T> | undefined> {
        const value = await seq(binding.fs).getEntry(sharedPath(binding.rootPath), sharedKey(key));
        return value ? decode<SharedStateEntry<T>>(value) : undefined;
    }

    async setShared<T extends import('../../domain/types').JsonValue>(
        binding: ResolvedStorageBinding,
        key: string,
        value: T,
        options: SharedStateWriteOptions = {},
        effectClaim?: EffectClaim,
    ): Promise<SharedStateEntry<T>> {
        validateSharedKey(key);
        assertDurableValue(value, 'Shared state');
        return transaction(binding.fs, async tx => {
            if (effectClaim) await this.assertEffectClaimTx(tx, binding, effectClaim);
            const current = await readSharedTx<T>(tx, binding.rootPath, key);
            assertSharedVersion(key, current?.version, options.expectedVersion);
            const version = await nextSharedVersion(tx, binding.rootPath, key);
            const entry = sharedEntry(key, value, version, options.taskId);
            await writeSharedRevision(tx, binding.rootPath, entry);
            await appendEventTx(tx, binding.rootPath, (await requireSessionTx(tx, binding.rootPath)).id,
                options.taskId, 'session.shared.set', { key, version: entry.version });
            return entry;
        });
    }

    async deleteShared(
        binding: ResolvedStorageBinding,
        key: string,
        options: SharedStateWriteOptions = {},
    ): Promise<boolean> {
        validateSharedKey(key);
        return transaction(binding.fs, async tx => {
            const current = await readSharedTx(tx, binding.rootPath, key);
            assertSharedVersion(key, current?.version, options.expectedVersion);
            if (!current) return false;
            const revision = deletedRevision(key, current.version + 1, options.taskId);
            await tx.deleteEntry(sharedPath(binding.rootPath), sharedKey(key));
            await writeSharedHistory(tx, binding.rootPath, revision);
            await appendEventTx(tx, binding.rootPath, (await requireSessionTx(tx, binding.rootPath)).id,
                options.taskId, 'session.shared.deleted', { key, version: current.version });
            return true;
        });
    }

    async listShared(binding: ResolvedStorageBinding, prefix = ''): Promise<SharedStateEntry[]> {
        const entries: SharedStateEntry[] = [];
        await seq(binding.fs).walkEntries(sharedPath(binding.rootPath), entry => {
            entries.push(decode(entry.value));
            return true;
        }, { keyPrefix: sharedKey(prefix) });
        return entries.sort((a, b) => a.key.localeCompare(b.key));
    }

    async sharedHistory<T extends import('../../domain/types').JsonValue>(
        binding: ResolvedStorageBinding,
        key: string,
    ): Promise<SharedStateRevision<T>[]> {
        validateSharedKey(key);
        const revisions: SharedStateRevision<T>[] = [];
        await seq(binding.fs).walkEntries(sharedPath(binding.rootPath), entry => {
            revisions.push(decode(entry.value));
            return true;
        }, { keyPrefix: sharedHistoryPrefix(key) });
        return revisions.sort((a, b) => a.version - b.version);
    }

    async createOutboxMessage<T extends import('../../domain/types').JsonValue>(
        binding: ResolvedStorageBinding,
        message: CrossSessionMessage<T>,
    ): Promise<void> {
        await transaction(binding.fs, async tx => {
            await tx.setEntry(messagesPath(binding.rootPath), outboxKey(message.id), encode(message));
            await appendEventTx(tx, binding.rootPath, message.sourceSessionId, undefined,
                'session.message.queued', message);
        });
    }

    async pendingOutbox(binding: ResolvedStorageBinding, dueAt?: number): Promise<CrossSessionMessage[]> {
        const messages = await this.outbox(binding);
        return messages.filter(message => message.status === 'pending' && (dueAt === undefined || (message.nextAttemptAt ?? 0) <= dueAt || (message.expiresAt ?? Infinity) <= dueAt));
    }

    async outbox(binding: ResolvedStorageBinding): Promise<CrossSessionMessage[]> {
        return readMessages(binding, 'outbox/');
    }

    async inbox(binding: ResolvedStorageBinding, after = 0): Promise<CrossSessionMessage[]> {
        return (await readMessages(binding, 'inbox/')).filter(message => message.createdAt > after);
    }

    async deliverMessage(binding: ResolvedStorageBinding, message: CrossSessionMessage): Promise<boolean> {
        return transaction(binding.fs, tx => deliverMessageTx(tx, binding.rootPath, message));
    }

    async sendTaskMessage(binding: ResolvedStorageBinding, taskId: string, request: import('../../domain/types').TaskMessageRequest) {
        return transaction(binding.fs, async tx => {
            const sender = await requireTaskTx(tx, binding.rootPath, taskId);
            if (isTerminal(sender.status)) throw new Error('Task is terminal');
            return enqueueMessageTx(tx, binding.rootPath, sender, request);
        });
    }

    async messageReceipt(binding: ResolvedStorageBinding, messageId: string): Promise<CrossSessionMessage> {
        const value = await seq(binding.fs).getEntry(messagesPath(binding.rootPath), `inbox/${messageId}`);
        if (!value) throw new Error('Message delivery receipt missing');
        return decode(value);
    }

    async markMessageDelivered(binding: ResolvedStorageBinding, messageId: string, receipt?: CrossSessionMessage): Promise<CrossSessionMessage> {
        return transaction(binding.fs, async tx => {
            const key = outboxKey(messageId);
            const value = await tx.getEntry(messagesPath(binding.rootPath), key);
            if (!value) throw new Error(`Outbox message not found: ${messageId}`);
            const current = decode<CrossSessionMessage>(value);
            if (current.status !== 'pending') return current;
            const next: CrossSessionMessage = { ...current, status: receipt?.status ?? 'delivered',
                deliveredAt: receipt?.status === 'rejected' ? undefined : receipt?.deliveredAt ?? Date.now(),
                rejectedAt: receipt?.rejectedAt, rejection: receipt?.rejection, nextAttemptAt: undefined };
            await tx.setEntry(messagesPath(binding.rootPath), key, encode(next));
            await appendEventTx(tx, binding.rootPath, current.sourceSessionId, current.sourceTaskId,
                `session.message.${next.status}`, next);
            return next;
        });
    }

    async recordMessageRetry(binding: ResolvedStorageBinding, messageId: string, error: unknown): Promise<void> {
        await transaction(binding.fs, async tx => {
            const key = outboxKey(messageId), value = await tx.getEntry(messagesPath(binding.rootPath), key);
            if (!value) return;
            const message = decode<CrossSessionMessage>(value);
            if (message.status !== 'pending') return;
            const deliveryAttempts = (message.deliveryAttempts ?? 0) + 1;
            await tx.setEntry(messagesPath(binding.rootPath), key, encode({ ...message, deliveryAttempts,
                nextAttemptAt: Date.now() + Math.min(30_000, 250 * 2 ** Math.min(deliveryAttempts - 1, 7)),
                lastDeliveryError: error instanceof Error ? error.message : String(error) }));
        });
    }

    async commitContext<T extends import('../../domain/types').JsonValue>(
        binding: ResolvedStorageBinding,
        commit: ContextCommit<T>,
        options: ContextCommitOptions = {},
    ): Promise<ContextCommit<T>> {
        return transaction(binding.fs, async tx => {
            const branch = options.branch ?? 'main';
            const current = await readContextBranchTx(tx, binding.rootPath, branch);
            assertContextHead(branch, current.head, options.expectedHead);
            const parentIds = options.parents ?? (current.head ? [current.head] : []);
            await requireContextParents(tx, binding.rootPath, parentIds);
            const persisted = { ...commit, parentIds };
            await tx.setEntry(contextPath(binding.rootPath), contextCommitKey(commit.id), encode(persisted));
            await writeContextBranchTx(tx, binding.rootPath, branch, commit.id, current.version);
            await appendEventTx(tx, binding.rootPath, commit.sessionId, options.taskId,
                'session.context.committed', { commitId: commit.id, branch, parentIds });
            return persisted;
        });
    }

    async getContextCommit<T extends import('../../domain/types').JsonValue>(
        binding: ResolvedStorageBinding,
        id: string,
    ): Promise<ContextCommit<T> | undefined> {
        const value = await seq(binding.fs).getEntry(contextPath(binding.rootPath), contextCommitKey(id));
        return value ? decode(value) : undefined;
    }

    async getContextBranch(binding: ResolvedStorageBinding, name = 'main'): Promise<ContextBranch> {
        const value = await seq(binding.fs).getEntry(contextPath(binding.rootPath), contextBranchKey(name));
        return value ? decode(value) : { name, version: 0, updatedAt: 0 };
    }

    async contextHistory(binding: ResolvedStorageBinding, head?: string): Promise<ContextCommit[]> {
        const start = head ?? (await this.getContextBranch(binding)).head;
        if (!start) return [];
        return collectContextHistory(binding, start);
    }

    async createResource(
        binding: ResolvedStorageBinding,
        resource: ResourceRecord,
        handle: ResourceHandle,
        parentHandleId?: string,
        request?: { id: string; fingerprint: string },
    ): Promise<{ resource: ResourceRecord; handle: ResourceHandle }> {
        return transaction(binding.fs, async tx => {
            await requireTaskTx(tx, binding.rootPath, handle.holderTaskId);
            const key = request ? `create/${encodeURIComponent(handle.holderTaskId)}/${encodeURIComponent(request.id)}` : undefined;
            const saved = key ? await tx.getEntry(resourcesPath(binding.rootPath), key) : undefined;
            if (saved) {
                const previous = decode<{ fingerprint: string; resourceId: string; handleId: string }>(saved);
                if (previous.fingerprint !== request!.fingerprint) throw new Error('Resource creation conflict');
                return { resource: await requireResourceTx(tx, binding.rootPath, previous.resourceId),
                    handle: await requireHandleTx(tx, binding.rootPath, previous.handleId) };
            }
            if (resource.parentResourceId) {
                if (!parentHandleId) throw new Error('Child resource requires parent handle');
                const parent = await requireHandleTx(tx, binding.rootPath, parentHandleId);
                const parentResource = await authorizeHandleTx(tx, binding.rootPath, parent, 'grant');
                if (parentResource.id !== resource.parentResourceId) throw new Error('Parent resource handle mismatch');
            }
            await tx.setEntry(resourcesPath(binding.rootPath), resourceKey(resource.id), encode(resource));
            await tx.setEntry(resourcesPath(binding.rootPath), handleKey(handle.id), encode(handle));
            await appendEventTx(tx, binding.rootPath, resource.sessionId, handle.holderTaskId,
                'resource.created', { resourceId: resource.id, handleId: handle.id, kind: resource.kind });
            if (key) await tx.setEntry(resourcesPath(binding.rootPath), key, encode({
                fingerprint: request!.fingerprint, resourceId: resource.id, handleId: handle.id,
            }));
            return { resource, handle };
        });
    }

    async grantResource(
        binding: ResolvedStorageBinding,
        id: string,
        parentHandleId: string,
        holderTaskId: string,
        rights: ResourceRight[],
    ): Promise<ResourceHandle> {
        return transaction(binding.fs, async tx => {
            const parent = await requireHandleTx(tx, binding.rootPath, parentHandleId);
            const resource = await authorizeHandleTx(tx, binding.rootPath, parent, 'grant');
            await requireTaskTx(tx, binding.rootPath, holderTaskId);
            assertRightsSubset(parent, rights);
            const handle: ResourceHandle = {
                id, resourceId: resource.id, holderTaskId, rights: uniqueRights(rights),
                generation: resource.generation, parentHandleId,
            };
            await tx.setEntry(resourcesPath(binding.rootPath), handleKey(id), encode(handle));
            await appendEventTx(tx, binding.rootPath, resource.sessionId, holderTaskId,
                'resource.granted', { handleId: id, parentHandleId, rights });
            return handle;
        });
    }

    async revokeResource(binding: ResolvedStorageBinding, handleId: string): Promise<number> {
        return transaction(binding.fs, async tx => {
            const rootHandle = await requireHandleTx(tx, binding.rootPath, handleId);
            await authorizeHandleTx(tx, binding.rootPath, rootHandle, 'admin');
            const handles = await allHandlesTx(tx, binding.rootPath);
            const revoked = descendantHandleIds(handles, handleId);
            const revokedAt = Date.now();
            for (const id of revoked) {
                const handle = handles.get(id)!;
                await tx.setEntry(resourcesPath(binding.rootPath), handleKey(id), encode({ ...handle, revokedAt }));
            }
            const resource = await requireResourceTx(tx, binding.rootPath, rootHandle.resourceId);
            await appendEventTx(tx, binding.rootPath, resource.sessionId, rootHandle.holderTaskId,
                'resource.revoked', { handleId, revokedHandleIds: [...revoked], revokedAt });
            return revoked.size;
        });
    }

    async authorizeResource(
        binding: ResolvedStorageBinding,
        handleId: string,
        right: ResourceRight,
        holderTaskId?: string,
    ): Promise<ResourceRecord> {
        return transaction(binding.fs, async tx => {
            const handle = await requireHandleTx(tx, binding.rootPath, handleId);
            if (holderTaskId && handle.holderTaskId !== holderTaskId) throw new Error(`Handle holder mismatch: ${handleId}`);
            return authorizeHandleTx(tx, binding.rootPath, handle, right);
        });
    }

    async setBudget(
        binding: ResolvedStorageBinding,
        handleId: string,
        dimension: string,
        hardLimit: number,
        expectedVersion?: number | null,
    ): Promise<BudgetAccount> {
        return transaction(binding.fs, async tx => {
            const handle = await requireHandleTx(tx, binding.rootPath, handleId);
            const resource = await authorizeHandleTx(tx, binding.rootPath, handle, 'admin');
            const current = await readBudgetTx(tx, binding.rootPath, resource.id, dimension);
            assertBudgetVersion(resource.id, dimension, current?.version, expectedVersion);
            const budget = budgetAccount(resource.id, dimension, hardLimit, current);
            await tx.setEntry(resourcesPath(binding.rootPath), budgetKey(resource.id, dimension), encode(budget));
            await appendEventTx(tx, binding.rootPath, resource.sessionId, handle.holderTaskId,
                'budget.configured', budget);
            return budget;
        });
    }

    async chargeBudget(
        binding: ResolvedStorageBinding,
        handleId: string,
        dimension: string,
        amount: number,
        effectClaim?: EffectClaim,
    ): Promise<BudgetAccount[]> {
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Budget charge must be positive');
        return transaction(binding.fs, async tx => {
            if (effectClaim) await this.assertEffectClaimTx(tx, binding, effectClaim);
            const handle = await requireHandleTx(tx, binding.rootPath, handleId);
            const resource = await authorizeHandleTx(tx, binding.rootPath, handle, 'write');
            const budgets = await resourceBudgetsTx(tx, binding.rootPath, resource, dimension);
            for (const budget of budgets) assertBudgetCapacity(budget, amount);
            const charged = budgets.map(budget => ({
                ...budget, used: budget.used + amount, version: budget.version + 1, updatedAt: Date.now(),
            }));
            for (const budget of charged) {
                await tx.setEntry(resourcesPath(binding.rootPath), budgetKey(budget.resourceId, dimension), encode(budget));
            }
            await appendEventTx(tx, binding.rootPath, resource.sessionId, handle.holderTaskId,
                'budget.consumed', { handleId, dimension, amount, accounts: charged });
            return charged;
        });
    }

    async saveWorkspaceSnapshot(
        binding: ResolvedStorageBinding,
        snapshot: WorkspaceSnapshot,
    ): Promise<WorkspaceSnapshot> {
        return transaction(binding.fs, async tx => {
            await requireResourceTx(tx, binding.rootPath, snapshot.resourceId);
            await tx.setEntry(resourcesPath(binding.rootPath), workspaceSnapshotKey(snapshot.id), encode(snapshot));
            await appendEventTx(tx, binding.rootPath, snapshot.sessionId, undefined,
                'workspace.snapshot.created', { snapshotId: snapshot.id, resourceId: snapshot.resourceId });
            return snapshot;
        });
    }

    async getWorkspaceSnapshot(
        binding: ResolvedStorageBinding,
        id: string,
    ): Promise<WorkspaceSnapshot> {
        const value = await seq(binding.fs).getEntry(resourcesPath(binding.rootPath), workspaceSnapshotKey(id));
        if (!value) throw new Error(`Workspace snapshot not found: ${id}`);
        return decode(value);
    }

    async saveWorkspaceDiff(binding: ResolvedStorageBinding, diff: WorkspaceDiff): Promise<WorkspaceDiff> {
        return transaction(binding.fs, async tx => {
            await tx.setEntry(resourcesPath(binding.rootPath), workspaceDiffKey(diff.id), encode(diff));
            await appendEventTx(tx, binding.rootPath, diff.sessionId, undefined,
                'workspace.diff.created', { diffId: diff.id, resourceId: diff.resourceId });
            return diff;
        });
    }

    async listTasks(binding: ResolvedStorageBinding): Promise<TaskRecord[]> {
        const result: TaskRecord[] = [];
        for (const id of await this.listTaskIds(binding)) result.push(await this.readTask(binding, id));
        return result;
    }

    async listTaskPage(binding: ResolvedStorageBinding, query: import('../../domain/types').TaskListQuery = {}): Promise<import('../../domain/types').TaskListPage> {
        const after = query.afterIndex ?? 0, limit = query.limit ?? 100;
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid Task list page');
        return transaction(binding.fs, async tx => {
            const session = await requireSessionTx(tx, binding.rootPath), path = indexPath(binding.rootPath);
            const version = await tx.getEntry(path, 'task-order-version');
            if (version !== '1') {
                if (version !== null) throw new Error('Unsupported Task list index version');
                const ids: string[] = [];
                await tx.walkEntries(path, row => { ids.push(row.key.slice('task/'.length)); return true; }, { keyPrefix: 'task/' });
                for (const id of ids.sort()) await indexTask(tx, binding.rootPath, await requireTaskTx(tx, binding.rootPath, id));
                await tx.setEntry(path, 'task-order-version', '1');
            }
            const count = Number(await tx.getEntry(path, 'task-count') ?? 0), through = query.throughIndex ?? count;
            if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(through) || through < 0 || through > count) throw new Error('Invalid Task list upper bound');
            const end = Math.min(through, after + limit), items: TaskRecord[] = [];
            for (let index = after + 1; index <= end; index++) {
                const id = await tx.getEntry(path, `task-order/${String(index).padStart(16, '0')}`);
                if (!id) throw new Error('Task list index is missing');
                const task = await requireTaskTx(tx, binding.rootPath, id);
                if (task.sessionId !== session.id) throw new Error('Task list index scope mismatch');
                items.push(task);
            }
            return { items, throughIndex: through, ...(end < through ? { nextAfterIndex: end } : {}) };
        });
    }

    async prepareTaskDirectory(binding: ResolvedStorageBinding, taskId: TaskId): Promise<void> {
        await ensureTaskLayout(binding, taskId);
    }

    async createTask(binding: ResolvedStorageBinding, sessionId: SessionId, spec: TaskSpec): Promise<TaskRecord> {
        if (spec.input !== undefined) assertDurableValue(spec.input, 'Task input');
        const id = createId('task');
        await ensureTaskLayout(binding, id);
        const now = Date.now();
        let task = taskFromSpec(id, sessionId, spec, now);
        await transaction(binding.fs, async tx => {
            const session = await requireSessionTx(tx, binding.rootPath);
            if (spec.requestId) {
                const key = `submission/${encodeURIComponent(spec.requestId)}`;
                const raw = await tx.getEntry(sessionPath(binding.rootPath), key);
                if (raw) {
                    const previous = decode<{ id: string; fingerprint: string }>(raw);
                    if (previous.fingerprint !== encode(spec)) throw new Error('Task submission conflict');
                    task = await requireTaskTx(tx, binding.rootPath, previous.id);
                    return;
                }
                await tx.setEntry(sessionPath(binding.rootPath), key, encode({ id, fingerprint: encode(spec) }));
            }
            if (session.status !== 'open' && session.status !== 'suspended' && session.status !== 'suspending') throw new Error(`Session is ${session.status}`);
            await validateRetrySourceTx(tx, binding.rootPath, spec.retryOfTaskId);
            if (spec.parent) {
                const parent = await requireTaskTx(tx, binding.rootPath, spec.parent);
                if (isTerminal(parent.status) || (parent.control && parent.control.mode !== 'run')) throw new Error('Parent is not accepting children');
                if (await hasCancelledAncestorTx(tx, binding.rootPath, parent)) throw new Error('Task ancestor cancelled');
                task.rootTaskId = parent.rootTaskId;
            }
            let unresolvedDeps = task.unresolvedDeps;
            let failedDependency: { id: string; status: 'failed' | 'cancelled' } | undefined;
            const pendingEvents = [...task.pendingEvents];
            for (const dependency of spec.dependsOn ?? []) {
                const source = await readTaskTx(tx, binding.rootPath, dependency.task);
                if (!source) throw new Error(`Dependency not found: ${dependency.task}`);
                if (!isTerminal(source.status)) continue;
                if (dependencySatisfied(source, dependency.condition) || dependency.onFailure === 'continue') {
                    unresolvedDeps--;
                    if (source.exit) pendingEvents.push({ type: 'task-exited', taskId: source.id, exit: source.exit });
                    continue;
                }
                failedDependency = {
                    id: source.id,
                    status: dependency.onFailure === 'skip' ? 'cancelled' : 'failed',
                };
            }
            task = {
                ...task,
                pendingEvents,
                unresolvedDeps,
                status: spec.deferStart ? 'created' : unresolvedDeps === 0 ? 'ready' : task.status,
            };
            if (failedDependency) task = terminalDependency(task, failedDependency.status, failedDependency.id);
            await writeTaskTx(tx, binding.rootPath, task);
            for (const dependency of spec.dependsOn ?? []) {
                await tx.setEntry(
                    graphPath(binding.rootPath),
                    `edge/${dependency.task}/${id}`,
                    encode(dependency),
                );
            }
            await indexTask(tx, binding.rootPath, task);
            await appendEventTx(tx, binding.rootPath, sessionId, id, 'task.created', task);
        });
        await transaction(this.catalog.fs, tx => tx.setEntry(
            catalogPath(this.catalog.rootPath), `task/${task.id}`, sessionId,
        ));
        return task;
    }

    async locateTask(taskId: TaskId): Promise<SessionId> {
        const value = await seq(this.catalog.fs).getEntry(catalogPath(this.catalog.rootPath), `task/${taskId}`);
        if (!value) throw new Error(`Task not found: ${taskId}`);
        return value;
    }

    async readTask(binding: ResolvedStorageBinding, taskId: TaskId): Promise<TaskRecord> {
        const value = await seq(binding.fs).getEntry(taskPath(binding.rootPath, taskId), TASK_KEY);
        if (!value) throw new Error(`Task not found: ${taskId}`);
        return decode(value);
    }

    async taskHistoryPage(binding: ResolvedStorageBinding, taskId: TaskId, query: import('../../domain/types').TaskHistoryQuery = {}): Promise<import('../../domain/types').TaskHistoryPage> {
        const after = query.afterVersion ?? -1, limit = query.limit ?? 100;
        if (!Number.isSafeInteger(after) || after < -1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid Task history page');
        const current = await this.readTask(binding, taskId);
        const through = query.throughVersion ?? current.version;
        if (!Number.isSafeInteger(through) || through < 0 || through > current.version) throw new Error('Invalid Task history upper bound');
        const end = Math.min(through, after + limit);
        const keys: string[] = [];
        for (let version = after + 1; version <= end; version++) keys.push(snapshotKey(version));
        const rows = keys.length ? await seq(binding.fs).getEntries(taskPath(binding.rootPath, taskId), keys) : {};
        return { items: keys.flatMap(key => rows[key] ? [decode<TaskRecord>(rows[key])] : []),
            throughVersion: through, ...(end < through ? { nextAfterVersion: end } : {}) };
    }

    async taskHistory(binding: ResolvedStorageBinding, taskId: TaskId, afterVersion = -1): Promise<TaskRecord[]> {
        const snapshots: TaskRecord[] = [];
        await seq(binding.fs).walkEntries(taskPath(binding.rootPath, taskId), entry => {
            const snapshot = decode<TaskRecord>(entry.value);
            if (snapshot.version > afterVersion) snapshots.push(snapshot);
            return true;
        }, { keyPrefix: 'snapshot/' });
        return snapshots.sort((a, b) => a.version - b.version);
    }

    async taskAttempts(binding: ResolvedStorageBinding, taskId: TaskId): Promise<TaskAttempt[]> {
        const attempts: TaskAttempt[] = [];
        await seq(binding.fs).walkEntries(taskPath(binding.rootPath, taskId), entry => {
            attempts.push(decode(entry.value));
            return true;
        }, { keyPrefix: 'attempt/' });
        return attempts.sort((a, b) => a.startedAt - b.startedAt);
    }

    async claimReady(
        binding: ResolvedStorageBinding,
        workerId: string,
        leaseMs: number,
    ): Promise<TaskClaim | undefined> {
        return transaction(binding.fs, async tx => {
            const session = await requireSessionTx(tx, binding.rootPath);
            if (session.status !== 'open' && !(session.status === 'closing' && session.closeMode === 'drain')) return undefined;
            const candidates = await readyCandidates(tx, binding.rootPath);
            for (const taskId of candidates) {
                const task = await readTaskTx(tx, binding.rootPath, taskId);
                if (!task || task.status !== 'ready' || task.sessionPaused || task.controlHolds?.length || (task.control && task.control.mode !== 'run') || (task.readyAt ?? 0) > Date.now()) continue;
                if (await hasCancelledAncestorTx(tx, binding.rootPath, task)) continue;
                return claimTask(tx, binding.rootPath, task, workerId, leaseMs);
            }
            return undefined;
        });
    }

    async blockUnavailableProgram(binding: ResolvedStorageBinding, claim: TaskClaim): Promise<void> {
        await transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, claim.task.id);
            assertClaim(task, claim);
            const next: TaskRecord = { ...task, status: 'waiting', blockedReason: 'program-unavailable', currentAttempt: undefined,
                stepAttemptCount: Math.max(0, (task.stepAttemptCount ?? 1) - 1), version: task.version + 1, updatedAt: Date.now() };
            await finishAttemptTx(tx, binding.rootPath, task, 'waiting');
            await writeTaskTx(tx, binding.rootPath, next); await indexTask(tx, binding.rootPath, next);
            await appendEventTx(tx, binding.rootPath, task.sessionId, task.id, 'task.program.unavailable', task.program);
        });
    }

    async unblockProgram(binding: ResolvedStorageBinding, taskId: string): Promise<void> {
        await transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            if (task.status !== 'waiting' || task.blockedReason !== 'program-unavailable') return;
            const next: TaskRecord = { ...task, status: 'ready', blockedReason: undefined, version: task.version + 1, updatedAt: Date.now() };
            await writeTaskTx(tx, binding.rootPath, next); await indexTask(tx, binding.rootPath, next);
        });
    }

    async renewLease(
        binding: ResolvedStorageBinding,
        claim: TaskClaim,
        leaseMs: number,
    ): Promise<boolean> {
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, claim.task.id);
            if (!claimMatches(task, claim) || task.currentAttempt!.leaseUntil <= Date.now() || await hasCancelledAncestorTx(tx, binding.rootPath, task)) return false;
            const attempt = { ...task.currentAttempt!, leaseUntil: Date.now() + leaseMs };
            const next = { ...task, currentAttempt: attempt, updatedAt: Date.now() };
            await tx.setEntry(taskPath(binding.rootPath, task.id), TASK_KEY, encode(next));
            await tx.setEntry(taskPath(binding.rootPath, task.id), attemptKey(attempt.id), encode(attempt));
            return true;
        });
    }

    async commitTask(
        binding: ResolvedStorageBinding,
        claim: TaskClaim,
        next: TaskRecord,
        eventType: string,
        payload?: unknown,
        sideEffects: TaskCommitSideEffects = {},
    ): Promise<TaskRecord> {
        let committed!: TaskRecord;
        let spawned: TaskRecord[] = [];
        await transaction(binding.fs, async tx => {
            const current = await requireTaskTx(tx, binding.rootPath, next.id);
            assertClaim(current, claim);
            if (await hasCancelledAncestorTx(tx, binding.rootPath, current)) throw new Error('Task ancestor cancelled');
            // Mailbox/effect arrivals append while a reducer owns its business state.
            // Preserve the authoritative tail and existing effect/interaction revisions.
            const retrying = sideEffects.attemptOutcome === 'failed' && next.status === 'ready';
            committed = { ...next,
                pendingEvents: [...next.pendingEvents, ...current.pendingEvents.slice(claim.task.pendingEvents.length)],
                effects: { ...next.effects, ...current.effects },
                interactions: { ...next.interactions, ...current.interactions },
                stepNumber: (current.stepNumber ?? 0) + (retrying ? 0 : 1),
                stepAttemptCount: retrying ? current.stepAttemptCount : 0,
                stateRevision: (current.stateRevision ?? 0) + (retrying ? 0 : 1),
                version: current.version + 1, updatedAt: Date.now() };
            if (committed.status === 'ready' && !retrying && committed.pendingEvents.length === 0) {
                committed.pendingEvents = [{ type: 'step' }];
            }
            for (const action of sideEffects.cache ?? []) {
                if (action.type === 'cache-publish') await publishCacheTx(tx, binding.rootPath, committed.id, action.request);
                else if (action.type === 'cache-read') {
                    const receipt = await readCacheTx(tx, binding.rootPath, committed.id, action.request);
                    committed.pendingEvents.push({ type: 'cache-result', receipt });
                } else {
                    const receipt = await manageCacheTx(tx, binding.rootPath, committed.id, action);
                    committed.pendingEvents.push({ type: 'cache-managed', receipt });
                }
            }
            if (isTerminal(committed.status)) {
                committed.effects = cancelActiveEffects(committed.effects, Date.now());
                committed.interactions = Object.fromEntries(Object.entries(committed.interactions).map(([id, interaction]) => [id, interaction.status === 'pending' ? { ...interaction, status: 'cancelled' as const } : interaction]));
            }
            spawned = await applySpawnsTx(tx, binding.rootPath, committed, sideEffects.spawns ?? []);
            committed = await registerTaskWaitTx(tx, binding.rootPath, committed);
            await finishAttemptTx(
                tx, binding.rootPath, current, committed.status, sideEffects.attemptOutcome,
            );
            await writeTaskTx(tx, binding.rootPath, committed);
            await indexTask(tx, binding.rootPath, committed);
            await appendEventTx(tx, binding.rootPath, next.sessionId, next.id,
                eventType === 'task.retry.scheduled' ? eventType : `task.${committed.status}`, payload);
            await applySharedMutations(tx, binding.rootPath, next, sideEffects.shared ?? []);
            for (const event of sideEffects.events ?? []) {
                await appendEventTx(tx, binding.rootPath, next.sessionId, next.id, event.type, event.payload);
            }
            const selected = claim.task.pendingEvents[0];
            if (!retrying && (claim.task.initialized ?? claim.task.state !== undefined) && selected?.type === 'message') {
                await consumeMessageTx(tx, binding.rootPath, committed, selected.message.id);
            }
            for (const message of sideEffects.messages ?? []) await enqueueMessageTx(tx, binding.rootPath, committed, message);
            for (const resource of sideEffects.resources ?? []) {
                if (resource.authority.fs !== binding.fs || resource.actorRoot !== binding.rootPath || resource.actor.taskId !== committed.id || resource.actor.sessionId !== committed.sessionId) throw new Error('Resource Decision transaction mismatch');
                await executeResourceTx(tx, resource);
            }
            if (isTerminal(committed.status)) {
                await advanceDependants(tx, binding.rootPath, committed);
                await wakeTaskWaiters(tx, binding.rootPath, committed);
            }
        });
        if (spawned.length > 0) await this.routeSpawnedTasks(spawned);
        return this.readTask(binding, committed.id);
    }

    private async routeSpawnedTasks(tasks: TaskRecord[]): Promise<void> {
        await transaction(this.catalog.fs, async tx => {
            for (const task of tasks) {
                await tx.setEntry(catalogPath(this.catalog.rootPath), `task/${task.id}`, task.sessionId);
            }
        });
    }

    async controlTask(
        binding: ResolvedStorageBinding, taskId: string, mode: import('../../domain/types').TaskControl['mode'],
        options: import('../../domain/types').TaskControlOptions & { signal?: TaskSignal },
    ): Promise<import('../../domain/types').TaskControl> {
        if (!options.requestId) throw new Error('Control requestId is required');
        if (options.signal?.payload !== undefined) assertDurableValue(options.signal.payload, 'Signal payload');
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            const key = `control/${encodeURIComponent(options.requestId)}`;
            const fingerprint = encode({ mode, ...options });
            const previous = await tx.getEntry(taskPath(binding.rootPath, taskId), key);
            if (previous) {
                const receipt = decode<{ fingerprint: string; control: import('../../domain/types').TaskControl }>(previous);
                if (receipt.fingerprint !== fingerprint) throw new Error('Control request conflict');
                return task.control?.requestId === options.requestId ? task.control : receipt.control;
            }
            if (isTerminal(task.status)) throw new Error('Task is terminal');
            if (options.expectedEpoch !== undefined && options.expectedEpoch !== (task.control?.epoch ?? 0)) throw new Error('Control epoch conflict');
            if (await hasCancelledAncestorTx(tx, binding.rootPath, task)) throw new Error('Task ancestor cancelled');
            if (mode === 'run' && task.control && !task.control.acknowledged) throw new Error('Control not settled');
            const ids: string[] = [taskId];
            const all: TaskRecord[] = [];
            await tx.walkEntries(indexPath(binding.rootPath), row => { ids.push(row.key.slice(5)); return true; }, { keyPrefix: 'task/' });
            for (const id of new Set(ids)) { const value = await readTaskTx(tx, binding.rootPath, id); if (value) all.push(value); }
            const selected = new Set([taskId]);
            for (let changed = true; changed;) {
                changed = false;
                for (const child of all) if (child.parentTaskId && selected.has(child.parentTaskId) && !selected.has(child.id)) { selected.add(child.id); changed = true; }
            }
            let rootControl!: import('../../domain/types').TaskControl;
            for (const current of all) {
                if (!selected.has(current.id) || isTerminal(current.status)) continue;
                const holds = new Set(current.controlHolds ?? []);
                if (current.id !== taskId) { if (mode === 'run') holds.delete(taskId); else holds.add(taskId); }
                const control: import('../../domain/types').TaskControl = {
                    epoch: (current.control?.epoch ?? 0) + 1, mode: current.id === taskId ? mode : current.control?.mode ?? 'run', requestId: current.id === taskId ? options.requestId : current.control?.requestId ?? options.requestId,
                    reason: options.reason,
                    acknowledged: mode === 'run' || !Object.values(current.effects).some(e => e.status === 'leased' || e.status === 'indeterminate'),
                };
                const next: TaskRecord = { ...current, control, controlHolds: [...holds],
                    stepAttemptCount: current.status === 'running' ? Math.max(0, (current.stepAttemptCount ?? 1) - 1) : current.stepAttemptCount,
                    status: current.status === 'running' ? 'ready' : current.status,
                    currentAttempt: undefined, version: current.version + 1, updatedAt: Date.now() };
                if (current.currentAttempt) await finishAttemptTx(tx, binding.rootPath, current, 'ready');
                if (mode === 'run' && current.id === taskId && options.signal) {
                    next.pendingEvents = [{ type: 'signal', sequence: next.version, signal: options.signal }, ...next.pendingEvents];
                    if (next.status === 'waiting') { await unregisterTaskWaitTx(tx, binding.rootPath, next); next.status = 'ready'; next.wait = undefined; }
                }
                await writeTaskTx(tx, binding.rootPath, next); await indexTask(tx, binding.rootPath, next);
                await appendEventTx(tx, binding.rootPath, current.sessionId, current.id, `task.control.${mode}`, control);
                if (current.id === taskId) rootControl = control;
            }
            if (mode !== 'run' && all.some(t => selected.has(t.id) && Object.values(t.effects).some(e => e.status === 'leased' || e.status === 'indeterminate'))) {
                rootControl.acknowledged = false;
                const root = await requireTaskTx(tx, binding.rootPath, taskId);
                await writeTaskTx(tx, binding.rootPath, { ...root, control: rootControl });
            }
            await tx.setEntry(taskPath(binding.rootPath, taskId), key, encode({ fingerprint, control: rootControl }));
            return rootControl;
        });
    }

    private async acknowledgeControl(binding: ResolvedStorageBinding, id: string): Promise<void> {
        await transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, id);
            if (!task.control || task.control.acknowledged) return;
            const descendants: TaskRecord[] = [];
            await tx.walkEntries(indexPath(binding.rootPath), async row => {
                const t = await requireTaskTx(tx, binding.rootPath, row.key.slice(5));
                if (t.id === id || t.controlHolds?.includes(id)) descendants.push(t);
                return true;
            }, { keyPrefix: 'task/' });
            if (descendants.some(t => Object.values(t.effects).some(e => e.status === 'leased' || e.status === 'indeterminate'))) return;
            const next = { ...task, control: { ...task.control, acknowledged: true }, version: task.version + 1 };
            await writeTaskTx(tx, binding.rootPath, next);
            await appendEventTx(tx, binding.rootPath, task.sessionId, id, 'task.control.acknowledged', next.control);
        });
    }

    async signalTask(
        binding: ResolvedStorageBinding,
        taskId: TaskId,
        signal: TaskSignal,
    ): Promise<TaskRecord> {
        if (signal.payload !== undefined) assertDurableValue(signal.payload, 'Signal payload');
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            if (isTerminal(task.status)) return task;
            if (await hasCancelledAncestorTx(tx, binding.rootPath, task)) throw new Error('Task ancestor cancelled');
            const sequence = task.pendingEvents.length + task.version + 1;
            let next: TaskRecord = {
                ...task,
                pendingEvents: [...task.pendingEvents, { type: 'signal', sequence, signal }],
                version: task.version + 1,
                updatedAt: Date.now(),
            };
            next = wakeFromPendingEvents(next);
            if (next.status === 'ready') await unregisterTaskWaitTx(tx, binding.rootPath, task);
            await writeTaskTx(tx, binding.rootPath, next);
            await indexTask(tx, binding.rootPath, next);
            await appendEventTx(tx, binding.rootPath, task.sessionId, taskId, 'task.signal', signal);
            return next;
        });
    }

    async startTask(binding: ResolvedStorageBinding, taskId: TaskId, options: import('../../domain/types').TaskStartOptions = {}): Promise<TaskRecord> {
        if (options.signal) assertDurableValue(options.signal, 'Start signal');
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            const key = 'start-signal';
            const saved = await tx.getEntry(taskPath(binding.rootPath, taskId), key);
            if (options.signal && saved && saved !== encode(options.signal)) throw new Error('Task start signal conflict');
            if (task.status !== 'created') {
                if (options.signal && !saved) throw new Error('Task was not started with this signal');
                return task;
            }
            if (await hasCancelledAncestorTx(tx, binding.rootPath, task)) throw new Error('Task ancestor cancelled');
            const next: TaskRecord = {
                ...task,
                pendingEvents: options.signal ? [...task.pendingEvents, { type: 'signal',
                    sequence: task.pendingEvents.length + task.version + 1, signal: options.signal }] : task.pendingEvents,
                status: task.unresolvedDeps > 0 ? 'blocked' : 'ready',
                version: task.version + 1,
                updatedAt: Date.now(),
            };
            if (options.signal) {
                await tx.setEntry(taskPath(binding.rootPath, taskId), key, encode(options.signal));
                await appendEventTx(tx, binding.rootPath, task.sessionId, taskId, 'task.signal', options.signal);
            }
            await writeTaskTx(tx, binding.rootPath, next);
            await indexTask(tx, binding.rootPath, next);
            await appendEventTx(tx, binding.rootPath, task.sessionId, taskId, 'task.started');
            return next;
        });
    }

    async resolveInteraction(
        binding: ResolvedStorageBinding,
        taskId: TaskId,
        response: InteractionResponse<import('../../domain/types').JsonValue>,
    ): Promise<TaskRecord> {
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            assertDurableValue(response.value, 'Interaction response');
            const interaction = task.interactions?.[response.interactionId];
            if (!interaction) throw new Error(`Interaction not found: ${response.interactionId}`);
            if (interaction.status !== 'pending') {
                if (interaction.status === 'resolved' && encode(interaction.response) === encode(response.value)) return task;
                throw new Error('Interaction response conflict');
            }
            if (isTerminal(task.status)) throw new Error('Task is terminal');
            if (await hasCancelledAncestorTx(tx, binding.rootPath, task)) throw new Error('Task ancestor cancelled');
            const event = {
                type: 'interaction-resolved' as const,
                interactionId: response.interactionId,
                value: response.value,
            };
            const resolved = { ...interaction, status: 'resolved' as const,
                response: response.value, resolvedAt: Date.now() };
            let next: TaskRecord = { ...task,
                interactions: { ...task.interactions, [interaction.id]: resolved },
                pendingEvents: [...task.pendingEvents, event],
                version: task.version + 1, updatedAt: Date.now() };
            next = wakeFromPendingEvents(next);
            if (next.status === 'ready') await unregisterTaskWaitTx(tx, binding.rootPath, task);
            await writeTaskTx(tx, binding.rootPath, next);
            await indexTask(tx, binding.rootPath, next);
            await appendEventTx(tx, binding.rootPath, task.sessionId, task.id,
                'task.interaction.resolved', { interactionId: interaction.id });
            return next;
        });
    }

    async claimEffect(
        binding: ResolvedStorageBinding,
        taskId: TaskId,
        effectId: string,
        workerId: string,
        leaseMs: number,
    ): Promise<EffectClaim | undefined> {
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            const current = task.effects[effectId];
            const session = await requireSessionTx(tx, binding.rootPath);
            if (!current || current.status !== 'pending' || (current.readyAt ?? 0) > Date.now() || isTerminal(task.status) || task.sessionPaused || task.controlHolds?.length || (task.control && task.control.mode !== 'run')
                || (session.status !== 'open' && !(session.status === 'closing' && session.closeMode === 'drain'))) return undefined;
            if (await hasCancelledAncestorTx(tx, binding.rootPath, task)) return undefined;
            const attempt = effectAttempt(workerId, leaseMs);
            const effect: PersistedEffect = { ...current, status: 'leased',
                attemptCount: (current.attemptCount ?? 0) + 1,
                attempts: [...(current.attempts ?? []), attempt], currentAttempt: attempt };
            const next = { ...task, effects: { ...task.effects, [effectId]: effect },
                version: task.version + 1, updatedAt: Date.now() };
            await writeTaskTx(tx, binding.rootPath, next);
            await appendEventTx(tx, binding.rootPath, task.sessionId, taskId, 'effect.leased', attempt);
            return { taskId, effectId, effect };
        });
    }

    async renewEffectLease(
        binding: ResolvedStorageBinding,
        claim: EffectClaim,
        leaseMs: number,
    ): Promise<boolean> {
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, claim.taskId);
            const effect = task.effects[claim.effectId];
            if (!effectClaimMatches(effect, claim) || effect.currentAttempt!.leaseUntil <= Date.now() || await hasCancelledAncestorTx(tx, binding.rootPath, task)) return false;
            const attempt = { ...effect.currentAttempt!, leaseUntil: Date.now() + leaseMs };
            const nextEffect = replaceEffectAttempt(effect, attempt);
            const next = { ...task, effects: { ...task.effects, [claim.effectId]: nextEffect } };
            await tx.setEntry(taskPath(binding.rootPath, task.id), TASK_KEY, encode(next));
            return true;
        });
    }

    async completeEffect(
        binding: ResolvedStorageBinding,
        taskId: TaskId,
        effectId: string,
        leaseToken: string,
        outcome: EffectCompletion,
    ): Promise<TaskRecord> {
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            const effect = task.effects[effectId];
            if (!effect) throw new Error(`Effect not found: ${effectId}`);
            if (effect.status === 'succeeded' || effect.status === 'failed' || effect.status === 'indeterminate') {
                return task;
            }
            if (effect.status !== 'leased' || effect.currentAttempt?.leaseToken !== leaseToken
                || effect.currentAttempt.leaseUntil <= Date.now()
                || await hasCancelledAncestorTx(tx, binding.rootPath, task)) {
                throw kernelError(KernelErrorCode.STALE_EFFECT_CLAIM, `Stale effect claim: ${effectId}`);
            }
            if (outcome.error && outcome.retryable && effect.attemptCount < (effect.request.retry?.maxAttempts ?? 1)
                && (effect.deadlineAt ?? Infinity) > Date.now()) {
                const finished = finishEffect(effect, outcome);
                const pending = { ...finished, status: 'pending' as const, readyAt: Date.now() + (effect.request.retry?.backoffMs ?? 0) };
                const next = { ...task, effects: { ...task.effects, [effectId]: pending }, version: task.version + 1, updatedAt: Date.now() };
                await writeTaskTx(tx, binding.rootPath, next);
                await appendEventTx(tx, binding.rootPath, task.sessionId, taskId, 'effect.retry.scheduled', { effectId, readyAt: pending.readyAt });
                return next;
            }
            const event = outcome.error
                ? { type: 'effect-failed' as const, effectId, error: outcome.error }
                : { type: 'effect-completed' as const, effectId, result: outcome.result };
            let next: TaskRecord = {
                ...task,
                pendingEvents: [...task.pendingEvents, event],
                effects: { ...task.effects, [effectId]: finishEffect(effect, outcome) },
                version: task.version + 1,
                updatedAt: Date.now(),
            };
            if (outcome.indeterminate) next.pendingEvents = task.pendingEvents;
            else next = wakeFromPendingEvents(next);
            if (next.status === 'ready') await unregisterTaskWaitTx(tx, binding.rootPath, task);
            await writeTaskTx(tx, binding.rootPath, next);
            await indexTask(tx, binding.rootPath, next);
            await appendEventTx(tx, binding.rootPath, task.sessionId, taskId, `effect.${next.effects[effectId].status}`, outcome);
            return next;
        });
    }

    private async assertEffectClaimTx(tx: import('@itookit/vfs-core').ISeqFileTransaction, binding: ResolvedStorageBinding, claim: EffectClaim): Promise<void> {
        const task = await requireTaskTx(tx, binding.rootPath, claim.taskId);
        const effect = task.effects[claim.effectId];
        if (!effectClaimMatches(effect, claim) || (effect.currentAttempt?.leaseUntil ?? 0) <= Date.now() || await hasCancelledAncestorTx(tx, binding.rootPath, task)) throw new Error('Stale effect claim');
    }

    async resolveEffect(binding: ResolvedStorageBinding, taskId: string, request: import('../../domain/types').EffectResolution): Promise<void> {
        if (!request.requestId) throw new Error('Resolution requestId is required');
        if (request.outcome.type === 'completed') assertDurableValue(request.outcome.result, 'Effect result');
        await transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            const key = `effect-resolution/${encodeURIComponent(request.requestId)}`, fingerprint = encode(request);
            const previous = await tx.getEntry(taskPath(binding.rootPath, taskId), key);
            if (previous) { if (previous !== fingerprint) throw new Error('Effect resolution conflict'); return; }
            if (isTerminal(task.status)) throw new Error('Task is terminal');
            if (await hasCancelledAncestorTx(tx, binding.rootPath, task)) throw new Error('Task ancestor cancelled');
            const effect = task.effects[request.effectId];
            if (effect?.status !== 'indeterminate') throw new Error('Effect is not indeterminate');
            const next: TaskRecord = { ...task, effects: { ...task.effects }, pendingEvents: task.pendingEvents.filter(event => !(event.type === 'effect-failed' && event.effectId === request.effectId)), version: task.version + 1, updatedAt: Date.now() };
            if (request.outcome.type === 'retry') {
                if ((effect.deadlineAt ?? Infinity) <= Date.now()) throw new Error('Effect deadline expired; create a new logical operation');
                next.effects[request.effectId] = { ...effect, status: 'pending', replayAuthorized: true, error: undefined };
            } else {
                const completed = request.outcome.type === 'completed';
                next.effects[request.effectId] = { ...effect, status: completed ? 'succeeded' : 'failed',
                    result: request.outcome.type === 'completed' ? request.outcome.result : undefined,
                    error: request.outcome.type === 'failed' ? request.outcome.error : undefined };
                next.pendingEvents.push(request.outcome.type === 'completed'
                    ? { type: 'effect-completed', effectId: request.effectId, result: request.outcome.result }
                    : { type: 'effect-failed', effectId: request.effectId, error: request.outcome.error });
            }
            const woken = wakeFromPendingEvents(next);
            if (woken.status === 'ready') await unregisterTaskWaitTx(tx, binding.rootPath, task);
            await writeTaskTx(tx, binding.rootPath, woken); await indexTask(tx, binding.rootPath, woken);
            await tx.setEntry(taskPath(binding.rootPath, taskId), key, fingerprint);
            await appendEventTx(tx, binding.rootPath, task.sessionId, taskId, 'effect.resolved', request);
        });
    }

    async confirmEffectCleanup(binding: ResolvedStorageBinding, taskId: string, effectId: string): Promise<void> {
        await transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId), effect = task.effects[effectId];
            if (!effect?.cleanupPending) return;
            await writeTaskTx(tx, binding.rootPath, { ...task, effects: { ...task.effects, [effectId]: { ...effect, cleanupPending: false } }, version: task.version + 1 });
        });
    }

    async cancelTask(binding: ResolvedStorageBinding, taskId: TaskId, reason?: string): Promise<TaskRecord> {
        return this.finishWithoutClaim(binding, taskId, 'cancelled', undefined, { message: reason ?? 'Cancelled' });
    }

    /** 放弃当前 claim，把 running task 恢复到 ready（dispose 时避免 task 卡在租约内无法重新调度）。 */
    async abandonClaim(binding: ResolvedStorageBinding, claim: TaskClaim): Promise<void> {
        await transaction(binding.fs, async tx => {
            const taskId = claim.task.id;
            const current = await requireTaskTx(tx, binding.rootPath, taskId);
            if (!claimMatches(current, claim)) return;
            const attempt = { ...current.currentAttempt!, outcome: 'lost' as const, finishedAt: Date.now() };
            const next: TaskRecord = {
                ...current, status: 'ready' as const, currentAttempt: undefined, readyAt: undefined,
                version: current.version + 1, updatedAt: Date.now(),
            };
            await writeTaskTx(tx, binding.rootPath, next);
            await tx.setEntry(taskPath(binding.rootPath, taskId), attemptKey(attempt.id), encode(attempt));
            await indexTask(tx, binding.rootPath, next);
        });
    }

    async taskEventPage(binding: ResolvedStorageBinding, taskId: TaskId, query: import('../../domain/types').TaskEventQuery = {}): Promise<import('../../domain/types').TaskEventPage> {
        const after = query.afterIndex ?? 0, limit = query.limit ?? 100;
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid Task event page');
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            await ensureTaskEventIndexTx(tx, binding.rootPath);
            const path = eventsPath(binding.rootPath);
            const count = Number(await tx.getEntry(path, taskEventCountKey(taskId)) ?? 0);
            if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid Task event count');
            const through = query.throughIndex ?? count;
            if (!Number.isSafeInteger(through) || through < 0 || through > count) throw new Error('Invalid Task event upper bound');
            const end = Math.min(through, after + limit), keys: string[] = [];
            for (let index = after + 1; index <= end; index++) keys.push(taskEventKey(taskId, index));
            const refs = Object.fromEntries(await Promise.all(keys.map(async key => [key, await tx.getEntry(path, key)] as const)));
            const eventKeys = keys.map(key => {
                const sequence = Number(refs[key]);
                if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invalid Task event index');
                return `event/${String(sequence).padStart(16, '0')}`;
            });
            const rows = Object.fromEntries(await Promise.all(eventKeys.map(async key => [key, await tx.getEntry(path, key)] as const)));
            const items = eventKeys.map(key => {
                if (!rows[key]) throw new Error('Task event is missing');
                const event = decode<EventEnvelope>(rows[key]);
                if (event.taskId !== taskId || event.sessionId !== task.sessionId) throw new Error('Task event index scope mismatch');
                return event;
            });
            return { items, throughIndex: through, ...(end < through ? { nextAfterIndex: end } : {}) };
        });
    }

    async events(binding: ResolvedStorageBinding, after = 0): Promise<EventEnvelope[]> {
        const values: EventEnvelope[] = [];
        await seq(binding.fs).walkEntries(eventsPath(binding.rootPath), entry => {
            const event = decode<EventEnvelope>(entry.value);
            if (event.sequence > after) values.push(event);
            return true;
        }, { keyPrefix: 'event/' });
        return values.sort((a, b) => a.sequence - b.sequence);
    }

    /**
     * Append a session event with a fresh sequence number.
     *
     * Used by effect execution to stream incremental events (e.g. LLM chunks)
     * to UI consumers polling via eventList. The event carries the owning
     * taskId so TaskHandle.events() can filter it.
     */
    async appendEvent(
        binding: ResolvedStorageBinding,
        sessionId: SessionId,
        taskId: TaskId | undefined,
        type: string,
        payload?: unknown,
        effectClaim?: EffectClaim,
    ): Promise<number> {
        if (payload !== undefined) assertDurableValue(payload, 'Event payload');
        return transaction(binding.fs, async tx => {
            if (effectClaim) await this.assertEffectClaimTx(tx, binding, effectClaim);
            return appendEventTx(tx, binding.rootPath, sessionId, taskId, type, payload, effectClaim ? { effectId: effectClaim.effectId, attemptId: effectClaim.effect.currentAttempt!.id } : undefined);
        });
    }

    async pendingEffects(binding: ResolvedStorageBinding): Promise<Array<{ task: TaskRecord; effectId: string }>> {
        const pending: Array<{ task: TaskRecord; effectId: string }> = [];
        for (const task of await this.listTasks(binding)) {
            for (const [effectId, effect] of Object.entries(task.effects)) {
                if (effect.status === 'pending') pending.push({ task, effectId });
            }
        }
        return pending;
    }

    async sweep(binding: ResolvedStorageBinding): Promise<void> {
        await transaction(binding.fs, tx => refreshWaiters(tx, binding.rootPath));
        for (const task of await this.listTasks(binding)) {
            if (await this.cancelFromAncestor(binding, task)) continue;
            await this.recoverExpiredEffects(binding, task);
            await this.acknowledgeControl(binding, task.id);
            if (task.status === 'running' && task.currentAttempt && task.currentAttempt.leaseUntil <= Date.now()) {
                await this.requeueExpired(binding, task);
            }
        }
    }

    async recover(binding: ResolvedStorageBinding, options: import('../../domain/types').RecoveryOptions = {}): Promise<RecoveryReport> {
        let recoveredTasks = 0;
        let recoveredEffects = 0;
        let expiredAttempts = 0;
        let tasks = await this.listTaskIds(binding);
        const session = await this.readSession(binding);
        tasks = await this.rebuildIndexes(binding, tasks);
        if (options.takeover) await transaction(binding.fs, async tx => {
            for (const id of tasks) {
                const task = await readTaskTx(tx, binding.rootPath, id);
                if (!task) continue;
                let changed = false;
                if (task.currentAttempt) {
                    task.currentAttempt = { ...task.currentAttempt, leaseUntil: 0, leaseToken: createId('fence') };
                    changed = true;
                }
                for (const [id, effect] of Object.entries(task.effects)) {
                    if (effect.status !== 'leased' || !effect.currentAttempt) continue;
                    task.effects[id] = { ...effect, currentAttempt: { ...effect.currentAttempt, leaseUntil: 0, leaseToken: createId('fence') } };
                    changed = true;
                }
                if (changed) await writeTaskTx(tx, binding.rootPath, { ...task, version: task.version + 1, updatedAt: Date.now() });
            }
        });
        await transaction(binding.fs, tx => recoverWaitGraphTx(tx, binding.rootPath, tasks));
        await this.repairCatalog(session, tasks);
        for (const taskId of tasks) {
            const task = await this.readTask(binding, taskId);
            if (await this.cancelFromAncestor(binding, task)) continue;
            recoveredEffects += await this.recoverExpiredEffects(binding, task);
            if (task.status !== 'running' || !task.currentAttempt || task.currentAttempt.leaseUntil > Date.now()) continue;
            expiredAttempts++;
            await this.requeueExpired(binding, task, options.takeover);
            recoveredTasks++;
        }
        return { recoveredTasks, recoveredEffects, expiredAttempts, rebuiltIndexes: tasks.length };
    }

    private async recoverExpiredEffects(binding: ResolvedStorageBinding, task: TaskRecord): Promise<number> {
        const expired = Object.entries(task.effects).filter(([, effect]) =>
            effect.status === 'leased' && (effect.currentAttempt?.leaseUntil ?? Infinity) <= Date.now());
        if (expired.length === 0) return 0;
        let recovered = 0;
        await transaction(binding.fs, async tx => {
            const current = await requireTaskTx(tx, binding.rootPath, task.id);
            let effects = current.effects;
            for (const [effectId] of expired) {
                const next = recoverEffect(effects, effectId);
                if (next !== effects) recovered++;
                effects = next;
            }
            if (recovered === 0) return;
            const next = { ...current, effects, version: current.version + 1, updatedAt: Date.now() };
            await writeTaskTx(tx, binding.rootPath, next);
            for (const [effectId] of expired) {
                if (effects[effectId]?.status !== 'pending') continue;
                await appendEventTx(tx, binding.rootPath, task.sessionId, task.id,
                    'effect.attempt.lost', { effectId });
            }
        });
        return recovered;
    }

    private async rebuildIndexes(binding: ResolvedStorageBinding, taskIds: string[]): Promise<string[]> {
        return transaction(binding.fs, async tx => {
            const staleKeys: string[] = [];
            const ids = new Set(taskIds);
            await tx.walkEntries(indexPath(binding.rootPath), entry => {
                if (entry.key.startsWith('task/')) ids.add(entry.key.slice(5));
                staleKeys.push(entry.key);
                return true;
            });
            for (const key of staleKeys) await tx.deleteEntry(indexPath(binding.rootPath), key);
            const existing: string[] = [];
            for (const taskId of ids) {
                const task = await readTaskTx(tx, binding.rootPath, taskId);
                if (task) { await indexTask(tx, binding.rootPath, task); existing.push(taskId); }
            }
            return existing;
        });
    }

    private async repairCatalog(session: SessionRecord, taskIds: string[]): Promise<void> {
        await transaction(this.catalog.fs, async tx => {
            await tx.setEntry(catalogPath(this.catalog.rootPath), `session/${session.id}`, encode(session));
            for (const taskId of taskIds) {
                await tx.setEntry(catalogPath(this.catalog.rootPath), `task/${taskId}`, session.id);
            }
        });
    }

    private async cancelFromAncestor(binding: ResolvedStorageBinding, task: TaskRecord): Promise<boolean> {
        if (!task.parentTaskId || isTerminal(task.status)) return false;
        const current = await this.finishWithoutClaim(binding, task.id, 'cancelled', undefined,
            { message: 'Ancestor cancelled' }, true);
        return current.status === 'cancelled';
    }

    private async finishWithoutClaim(
        binding: ResolvedStorageBinding,
        taskId: TaskId,
        status: 'cancelled' | 'failed',
        output?: unknown,
        error?: { message: string },
        requireCancelledAncestor = false,
    ): Promise<TaskRecord> {
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            if (isTerminal(task.status)) return task;
            if (requireCancelledAncestor && !await hasCancelledAncestorTx(tx, binding.rootPath, task)) return task;
            const completedAt = Date.now();
            const next: TaskRecord = {
                ...task, status, output, wait: undefined, currentAttempt: undefined,
                effects: cancelActiveEffects(task.effects, completedAt),
                interactions: Object.fromEntries(Object.entries(task.interactions).map(([id, interaction]) => [id, interaction.status === 'pending' ? { ...interaction, status: 'cancelled' as const } : interaction])),
                exit: { taskId, status, output, error, completedAt },
                version: task.version + 1, updatedAt: completedAt,
            };
            await unregisterTaskWaitTx(tx, binding.rootPath, task);
            await finishAttemptTx(tx, binding.rootPath, task, 'cancelled');
            await writeTaskTx(tx, binding.rootPath, next);
            await indexTask(tx, binding.rootPath, next);
            await appendEventTx(tx, binding.rootPath, task.sessionId, taskId, `task.${status}`, next.exit);
            await advanceDependants(tx, binding.rootPath, next);
            await wakeTaskWaiters(tx, binding.rootPath, next);
            return next;
        });
    }

    private async readCatalog(id: SessionId): Promise<SessionRecord | null> {
        const value = await seq(this.catalog.fs).getEntry(catalogPath(this.catalog.rootPath), `session/${id}`);
        return value ? decode(value) : null;
    }

    private async readSession(binding: ResolvedStorageBinding): Promise<SessionRecord> {
        const value = await seq(binding.fs).getEntry(sessionPath(binding.rootPath), SESSION_KEY);
        if (!value) throw new Error(`Session record missing at ${binding.rootPath}`);
        return decode(value);
    }

    private async listTaskIds(binding: ResolvedStorageBinding): Promise<string[]> {
        const root = join(binding.rootPath, 'tasks');
        // A removed storage tree has no Tasks; callers must stay usable for retries.
        if (!await binding.fs.driver.exists(root)) return [];
        const children = await binding.fs.driver.getChildren(root);
        const ids: string[] = [];
        for (const child of children) {
            if (child.type !== 'directory') continue;
            const path = taskPath(binding.rootPath, child.name);
            // A crash can leave a Task directory without its seq file.
            if (!await binding.fs.driver.exists(path)) continue;
            const value = await seq(binding.fs).getEntry(path, TASK_KEY);
            if (value) ids.push(child.name);
        }
        return ids.sort();
    }

    private async requeueExpired(binding: ResolvedStorageBinding, task: TaskRecord, restart = false): Promise<void> {
        await transaction(binding.fs, async tx => {
            const current = await requireTaskTx(tx, binding.rootPath, task.id);
            if (current.status !== 'running' || current.currentAttempt?.leaseUntil !== task.currentAttempt?.leaseUntil) return;
            const active = current.currentAttempt;
            if (!active) return;
            const now = Date.now();
            const attempt = { ...active, outcome: 'lost' as const, finishedAt: now };
            const error = { message: `Task attempt lease expired: ${active.id}` };
            const exhausted = !restart && (current.stepAttemptCount ?? current.attemptCount) >= current.retry.maxAttempts;
            const next: TaskRecord = exhausted
                ? { ...current, status: 'failed', currentAttempt: undefined, lastError: error,
                    exit: { taskId: task.id, status: 'failed', error, completedAt: now },
                    version: current.version + 1, updatedAt: now }
                : { ...current, status: 'ready', currentAttempt: undefined, lastError: error,
                    readyAt: now + (current.retry.backoffMs ?? 0),
                    version: current.version + 1, updatedAt: now };
            await writeTaskTx(tx, binding.rootPath, next);
            await tx.setEntry(taskPath(binding.rootPath, task.id), attemptKey(attempt.id), encode(attempt));
            await indexTask(tx, binding.rootPath, next);
            await appendEventTx(tx, binding.rootPath, task.sessionId, task.id, 'task.attempt.lost', attempt);
            if (exhausted) {
                await appendEventTx(tx, binding.rootPath, task.sessionId, task.id, 'task.failed', next.exit);
                await advanceDependants(tx, binding.rootPath, next);
                await wakeTaskWaiters(tx, binding.rootPath, next);
            }
        });
    }
}

export { createId, ensureTree } from './store-helpers';
