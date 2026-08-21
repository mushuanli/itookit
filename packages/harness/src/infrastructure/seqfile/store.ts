
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
import { advanceDependants,allHandlesTx,appendEventTx,applySharedMutations,applySpawnsTx,assertBudgetCapacity,assertBudgetVersion,assertClaim,assertContextHead,assertRightsSubset,assertSharedVersion,attemptKey,authorizeHandleTx,budgetAccount,budgetKey,cancelActiveEffects,catalogPath,claimMatches,claimTask,collectContextHistory,contextBranchKey,contextCommitKey,contextPath,createId,decode,deletedRevision,dependencySatisfied,descendantHandleIds,effectAttempt,effectClaimMatches,encode,ensureSeqFile,ensureSessionLayout,ensureTaskLayout,ensureTree,eventsPath,finishAttemptTx,finishEffect,graphPath,handleKey,inboxKey,indexPath,indexTask,isTerminal,join,messagesPath,nextSharedVersion,outboxKey,readBudgetTx,readContextBranchTx,readMessages,readSharedTx,readTaskTx,readyCandidates,recoverEffect,registerTaskWaitTx,replaceEffectAttempt,requireContextParents,requireHandleTx,requireResourceTx,requireSessionTx,requireTaskTx,requireTransactionalSeq,resourceBudgetsTx,resourceKey,resourcesPath,seq,sessionPath,sharedEntry,sharedHistoryPrefix,sharedKey,sharedPath,taskFromSpec,taskPath,terminalDependency,transaction,uniqueRights,unregisterTaskWaitTx,validateSharedKey,wakeFromPendingEvents,wakeTaskWaiters,workspaceDiffKey,workspaceSnapshotKey,writeContextBranchTx,writeSharedHistory,writeSharedRevision,writeTaskTx } from './store-helpers';
import { HarnessErrorCode, harnessError } from '../../domain/errors';

const SESSION_KEY = 'record';
const TASK_KEY = 'record';

export interface TaskClaim { task: TaskRecord; attempt: TaskAttempt; }
export interface EffectClaim { taskId: TaskId; effectId: string; effect: PersistedEffect; }
export interface EffectCompletion {
    result?: unknown;
    error?: import('../../domain/types').SerializableError;
    indeterminate?: boolean;
}
export interface PreparedSpawn { id: TaskId; spawnKey: string; spec: TaskSpec; }
export interface TaskCommitSideEffects {
    shared?: Array<
        { type: 'set'; key: string; value: import('../../domain/types').JsonValue; expectedVersion?: number | null }
        | { type: 'delete'; key: string; expectedVersion?: number | null }
    >;
    events?: Array<{ type: string; payload?: unknown }>;
    spawns?: PreparedSpawn[];
    attemptOutcome?: TaskAttempt['outcome'];
}

export class SeqFileHarnessStore {
    constructor(
        private readonly catalog: ResolvedStorageBinding,
        private readonly resolveStorage: (reference: StorageBindingRef) => Promise<ResolvedStorageBinding>,
    ) {}

    async initialize(): Promise<void> {
        await ensureTree(this.catalog.fs, this.catalog.rootPath);
        await ensureSeqFile(this.catalog.fs, catalogPath(this.catalog.rootPath));
        requireTransactionalSeq(this.catalog.fs);
    }

    async createSession(id: SessionId, storage: StorageBindingRef): Promise<SessionRecord> {
        const binding = await this.resolveStorage(storage);
        await ensureSessionLayout(binding);
        const existing = await this.readCatalog(id);
        if (existing) return this.readSession(binding);
        const now = Date.now();
        const record: SessionRecord = {
            id, status: 'open', storage, nextEventSeq: 1, version: 0,
            createdAt: now, updatedAt: now,
        };
        await transaction(binding.fs, async tx => {
            await tx.setEntry(sessionPath(binding.rootPath), SESSION_KEY, encode(record));
            await appendEventTx(tx, binding.rootPath, id, undefined, 'session.created', record);
        });
        await transaction(this.catalog.fs, tx => tx.setEntry(
            catalogPath(this.catalog.rootPath), `session/${id}`, encode(record),
        ));
        return record;
    }

    async openSession(id: SessionId): Promise<{ record: SessionRecord; binding: ResolvedStorageBinding }> {
        const catalog = await this.readCatalog(id);
        if (!catalog) throw new Error(`Session not found: ${id}`);
        const binding = await this.resolveStorage(catalog.storage);
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

    async setSessionStatus(
        binding: ResolvedStorageBinding,
        status: SessionRecord['status'],
    ): Promise<SessionRecord> {
        const record = await transaction(binding.fs, async tx => {
            const value = await tx.getEntry(sessionPath(binding.rootPath), SESSION_KEY);
            if (!value) throw new Error(`Session record missing at ${binding.rootPath}`);
            const current = decode<SessionRecord>(value);
            const next = { ...current, status, version: current.version + 1, updatedAt: Date.now() };
            await tx.setEntry(sessionPath(binding.rootPath), SESSION_KEY, encode(next));
            await appendEventTx(tx, binding.rootPath, current.id, undefined, `session.${status}`, next);
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
    ): Promise<SharedStateEntry<T>> {
        validateSharedKey(key);
        return transaction(binding.fs, async tx => {
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

    async pendingOutbox(binding: ResolvedStorageBinding): Promise<CrossSessionMessage[]> {
        const messages = await this.outbox(binding);
        return messages.filter(message => message.status === 'pending');
    }

    async outbox(binding: ResolvedStorageBinding): Promise<CrossSessionMessage[]> {
        return readMessages(binding, 'outbox/');
    }

    async inbox(binding: ResolvedStorageBinding, after = 0): Promise<CrossSessionMessage[]> {
        return (await readMessages(binding, 'inbox/')).filter(message => message.createdAt > after);
    }

    async deliverMessage(binding: ResolvedStorageBinding, message: CrossSessionMessage): Promise<boolean> {
        return transaction(binding.fs, async tx => {
            if (await tx.getEntry(messagesPath(binding.rootPath), inboxKey(message.id))) return false;
            const delivered = { ...message, status: 'delivered' as const, deliveredAt: Date.now() };
            await tx.setEntry(messagesPath(binding.rootPath), inboxKey(message.id), encode(delivered));
            await appendEventTx(tx, binding.rootPath, message.targetSessionId, undefined,
                'session.message.received', delivered);
            return true;
        });
    }

    async markMessageDelivered(binding: ResolvedStorageBinding, messageId: string): Promise<CrossSessionMessage> {
        return transaction(binding.fs, async tx => {
            const key = outboxKey(messageId);
            const value = await tx.getEntry(messagesPath(binding.rootPath), key);
            if (!value) throw new Error(`Outbox message not found: ${messageId}`);
            const current = decode<CrossSessionMessage>(value);
            if (current.status === 'delivered') return current;
            const delivered = { ...current, status: 'delivered' as const, deliveredAt: Date.now() };
            await tx.setEntry(messagesPath(binding.rootPath), key, encode(delivered));
            await appendEventTx(tx, binding.rootPath, current.sourceSessionId, undefined,
                'session.message.delivered', delivered);
            return delivered;
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
    ): Promise<{ resource: ResourceRecord; handle: ResourceHandle }> {
        return transaction(binding.fs, async tx => {
            await requireTaskTx(tx, binding.rootPath, handle.holderTaskId);
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
    ): Promise<BudgetAccount[]> {
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Budget charge must be positive');
        return transaction(binding.fs, async tx => {
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

    async prepareTaskDirectory(binding: ResolvedStorageBinding, taskId: TaskId): Promise<void> {
        await ensureTaskLayout(binding, taskId);
    }

    async createTask(binding: ResolvedStorageBinding, sessionId: SessionId, spec: TaskSpec): Promise<TaskRecord> {
        const id = createId('task');
        await ensureTaskLayout(binding, id);
        const now = Date.now();
        let task = taskFromSpec(id, sessionId, spec, now);
        await transaction(binding.fs, async tx => {
            let unresolvedDeps = task.unresolvedDeps;
            let failedDependency: { id: string; status: 'failed' | 'cancelled' } | undefined;
            const pendingEvents = [...task.pendingEvents];
            for (const dependency of spec.dependsOn ?? []) {
                const source = await readTaskTx(tx, binding.rootPath, dependency.task);
                if (!source || !isTerminal(source.status)) continue;
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
            catalogPath(this.catalog.rootPath), `task/${id}`, sessionId,
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
            const candidates = await readyCandidates(tx, binding.rootPath);
            for (const taskId of candidates) {
                const task = await readTaskTx(tx, binding.rootPath, taskId);
                if (!task || task.status !== 'ready' || (task.readyAt ?? 0) > Date.now()) continue;
                return claimTask(tx, binding.rootPath, task, workerId, leaseMs);
            }
            return undefined;
        });
    }

    async renewLease(
        binding: ResolvedStorageBinding,
        claim: TaskClaim,
        leaseMs: number,
    ): Promise<boolean> {
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, claim.task.id);
            if (!claimMatches(task, claim) || task.currentAttempt!.leaseUntil <= Date.now()) return false;
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
            committed = { ...next, version: current.version + 1, updatedAt: Date.now() };
            spawned = await applySpawnsTx(tx, binding.rootPath, committed, sideEffects.spawns ?? []);
            committed = await registerTaskWaitTx(tx, binding.rootPath, committed);
            await finishAttemptTx(
                tx, binding.rootPath, current, committed.status, sideEffects.attemptOutcome,
            );
            await writeTaskTx(tx, binding.rootPath, committed);
            await indexTask(tx, binding.rootPath, committed);
            await appendEventTx(tx, binding.rootPath, next.sessionId, next.id, eventType, payload);
            await applySharedMutations(tx, binding.rootPath, next, sideEffects.shared ?? []);
            for (const event of sideEffects.events ?? []) {
                await appendEventTx(tx, binding.rootPath, next.sessionId, next.id, event.type, event.payload);
            }
            if (isTerminal(committed.status)) {
                await advanceDependants(tx, binding.rootPath, committed);
                await wakeTaskWaiters(tx, binding.rootPath, committed);
            }
        });
        if (spawned.length > 0) await this.routeSpawnedTasks(spawned);
        return committed;
    }

    private async routeSpawnedTasks(tasks: TaskRecord[]): Promise<void> {
        await transaction(this.catalog.fs, async tx => {
            for (const task of tasks) {
                await tx.setEntry(catalogPath(this.catalog.rootPath), `task/${task.id}`, task.sessionId);
            }
        });
    }

    async signalTask(
        binding: ResolvedStorageBinding,
        taskId: TaskId,
        signal: TaskSignal,
    ): Promise<TaskRecord> {
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            if (isTerminal(task.status)) return task;
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

    async startTask(binding: ResolvedStorageBinding, taskId: TaskId): Promise<TaskRecord> {
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            if (task.status !== 'created') return task;
            const next: TaskRecord = {
                ...task,
                status: task.unresolvedDeps > 0 ? 'blocked' : 'ready',
                version: task.version + 1,
                updatedAt: Date.now(),
            };
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
            const interaction = task.interactions?.[response.interactionId];
            if (!interaction) throw new Error(`Interaction not found: ${response.interactionId}`);
            if (interaction.status !== 'pending') return task;
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
            if (!current || current.status !== 'pending') return undefined;
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
            if (!effectClaimMatches(effect, claim) || effect.currentAttempt!.leaseUntil <= Date.now()) return false;
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
                || effect.currentAttempt.leaseUntil <= Date.now()) {
                throw harnessError(HarnessErrorCode.STALE_EFFECT_CLAIM, `Stale effect claim: ${effectId}`);
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
            next = wakeFromPendingEvents(next);
            if (next.status === 'ready') await unregisterTaskWaitTx(tx, binding.rootPath, task);
            await writeTaskTx(tx, binding.rootPath, next);
            await indexTask(tx, binding.rootPath, next);
            await appendEventTx(tx, binding.rootPath, task.sessionId, taskId, `effect.${next.effects[effectId].status}`, outcome);
            return next;
        });
    }

    async cancelTask(binding: ResolvedStorageBinding, taskId: TaskId, reason?: string): Promise<TaskRecord> {
        return this.finishWithoutClaim(binding, taskId, 'cancelled', undefined, { message: reason ?? 'Cancelled' });
    }

    /** 放弃当前 claim，把 running task 恢复到 ready（dispose 时避免 task 卡在租约内无法重新调度）。 */
    async abandonClaim(binding: ResolvedStorageBinding, taskId: TaskId): Promise<void> {
        await transaction(binding.fs, async tx => {
            const current = await requireTaskTx(tx, binding.rootPath, taskId);
            if (current.status !== 'running' || !current.currentAttempt) return;
            const attempt = { ...current.currentAttempt, outcome: 'lost' as const, finishedAt: Date.now() };
            const next: TaskRecord = {
                ...current, status: 'ready' as const, currentAttempt: undefined, readyAt: undefined,
                version: current.version + 1, updatedAt: Date.now(),
            };
            await writeTaskTx(tx, binding.rootPath, next);
            await tx.setEntry(taskPath(binding.rootPath, taskId), attemptKey(attempt.id), encode(attempt));
            await indexTask(tx, binding.rootPath, next);
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
    ): Promise<number> {
        return transaction(binding.fs, async tx =>
            appendEventTx(tx, binding.rootPath, sessionId, taskId, type, payload),
        );
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

    async recover(binding: ResolvedStorageBinding): Promise<RecoveryReport> {
        let recoveredTasks = 0;
        let recoveredEffects = 0;
        let expiredAttempts = 0;
        const tasks = await this.listTaskIds(binding);
        const session = await this.readSession(binding);
        await this.rebuildIndexes(binding, tasks);
        await this.repairCatalog(session, tasks);
        for (const taskId of tasks) {
            const task = await this.readTask(binding, taskId);
            recoveredEffects += await this.recoverExpiredEffects(binding, task);
            if (task.status !== 'running' || !task.currentAttempt || task.currentAttempt.leaseUntil > Date.now()) continue;
            expiredAttempts++;
            await this.requeueExpired(binding, task);
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

    private async rebuildIndexes(binding: ResolvedStorageBinding, taskIds: string[]): Promise<void> {
        await transaction(binding.fs, async tx => {
            const staleKeys: string[] = [];
            await tx.walkEntries(indexPath(binding.rootPath), entry => {
                staleKeys.push(entry.key);
                return true;
            });
            for (const key of staleKeys) await tx.deleteEntry(indexPath(binding.rootPath), key);
            for (const taskId of taskIds) {
                const task = await readTaskTx(tx, binding.rootPath, taskId);
                if (task) await indexTask(tx, binding.rootPath, task);
            }
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

    private async finishWithoutClaim(
        binding: ResolvedStorageBinding,
        taskId: TaskId,
        status: 'cancelled' | 'failed',
        output?: unknown,
        error?: { message: string },
    ): Promise<TaskRecord> {
        return transaction(binding.fs, async tx => {
            const task = await requireTaskTx(tx, binding.rootPath, taskId);
            if (isTerminal(task.status)) return task;
            const completedAt = Date.now();
            const next: TaskRecord = {
                ...task, status, output, wait: undefined, currentAttempt: undefined,
                effects: cancelActiveEffects(task.effects, completedAt),
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
        const children = await binding.fs.driver.getChildren(root);
        const ids: string[] = [];
        for (const child of children) {
            if (child.type !== 'directory') continue;
            const value = await seq(binding.fs).getEntry(taskPath(binding.rootPath, child.name), TASK_KEY);
            if (value) ids.push(child.name);
        }
        return ids.sort();
    }

    private async requeueExpired(binding: ResolvedStorageBinding, task: TaskRecord): Promise<void> {
        await transaction(binding.fs, async tx => {
            const current = await requireTaskTx(tx, binding.rootPath, task.id);
            if (current.status !== 'running' || current.currentAttempt?.leaseUntil !== task.currentAttempt?.leaseUntil) return;
            const active = current.currentAttempt;
            if (!active) return;
            const now = Date.now();
            const attempt = { ...active, outcome: 'lost' as const, finishedAt: now };
            const error = { message: `Task attempt lease expired: ${active.id}` };
            const exhausted = current.attemptCount >= current.retry.maxAttempts;
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
