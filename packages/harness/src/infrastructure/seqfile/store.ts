import type { IModuleFS, ISeqFileOperations, ISeqFileTransaction } from '@itookit/stdio';
import type {
    BudgetAccount,
    ContextBranch,
    ContextCommit,
    ContextCommitOptions,
    CrossSessionMessage,
    EffectAttempt,
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
                throw new Error(`Stale effect claim: ${effectId}`);
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

async function ensureSessionLayout(binding: ResolvedStorageBinding): Promise<void> {
    requireTransactionalSeq(binding.fs);
    await ensureTree(binding.fs, binding.rootPath);
    for (const file of ['session.seq', 'shared.seq', 'context.seq', 'messages.seq', 'events.seq', 'graph.seq', 'resources.seq', 'index.seq']) {
        await ensureSeqFile(binding.fs, join(binding.rootPath, file));
    }
    await ensureTree(binding.fs, join(binding.rootPath, 'tasks'));
}

async function ensureTaskLayout(binding: ResolvedStorageBinding, taskId: string): Promise<void> {
    const root = join(binding.rootPath, 'tasks', taskId);
    await ensureTree(binding.fs, root);
    await ensureTree(binding.fs, join(root, 'artifacts'));
    await ensureSeqFile(binding.fs, join(root, 'task.seq'));
}

export async function ensureTree(fs: IModuleFS, path: string): Promise<void> {
    let current = '';
    for (const part of path.split('/').filter(Boolean)) {
        const parent = current || null;
        current = `${current}/${part}`;
        if (!(await fs.driver.exists(current))) await fs.driver.createDirectory({ name: part, parentPath: parent });
    }
}

async function ensureSeqFile(fs: IModuleFS, path: string): Promise<void> {
    if (await fs.driver.exists(path)) return;
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error(`Invalid SeqFile path: ${path}`);
    const parentPath = parts.length ? `/${parts.join('/')}` : null;
    await fs.driver.createFile({ name, parentPath, type: 'seqfile', content: '' });
}

function requireTransactionalSeq(fs: IModuleFS): ISeqFileOperations {
    const operations = fs.meta.seq;
    if (!operations?.transaction) throw new Error(`Module ${fs.moduleId} lacks transactional SeqFile support`);
    return operations;
}

function seq(fs: IModuleFS): ISeqFileOperations {
    if (!fs.meta.seq) throw new Error(`Module ${fs.moduleId} lacks SeqFile support`);
    return fs.meta.seq;
}

function transaction<T>(fs: IModuleFS, operation: (tx: ISeqFileTransaction) => Promise<T>): Promise<T> {
    return requireTransactionalSeq(fs).transaction!(operation);
}

async function readyCandidates(tx: ISeqFileTransaction, root: string): Promise<string[]> {
    const rows: Array<{ id: string; priority: number; createdAt: number }> = [];
    await tx.walkEntries(indexPath(root), entry => {
        const value = decode<{ priority: number; createdAt: number }>(entry.value);
        rows.push({ id: entry.key.slice(6), ...value });
        return true;
    }, { keyPrefix: 'ready/' });
    rows.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return rows.map(row => row.id);
}

async function claimTask(
    tx: ISeqFileTransaction,
    root: string,
    task: TaskRecord,
    workerId: string,
    leaseMs: number,
): Promise<TaskClaim> {
    const attempt: TaskAttempt = {
        id: createId('attempt'), workerId, leaseToken: createId('lease'),
        leaseEpoch: task.attemptCount + 1, leaseUntil: Date.now() + leaseMs, startedAt: Date.now(),
    };
    const next = { ...task, status: 'running' as const, currentAttempt: attempt, readyAt: undefined,
        attemptCount: task.attemptCount + 1, version: task.version + 1, updatedAt: Date.now() };
    await writeTaskTx(tx, root, next);
    await tx.setEntry(taskPath(root, task.id), attemptKey(attempt.id), encode(attempt));
    await indexTask(tx, root, next);
    await appendEventTx(tx, root, task.sessionId, task.id, 'task.leased', attempt);
    return { task: next, attempt };
}

function assertClaim(current: TaskRecord, claim: TaskClaim): void {
    if (!claimMatches(current, claim) || current.currentAttempt!.leaseUntil <= Date.now()) {
        throw new Error(`Stale task claim: ${current.id}`);
    }
}

function claimMatches(current: TaskRecord, claim: TaskClaim): boolean {
    const attempt = current.currentAttempt;
    return current.status === 'running' && !!attempt
        && attempt.leaseToken === claim.attempt.leaseToken
        && attempt.leaseEpoch === claim.attempt.leaseEpoch
        && current.version === claim.task.version;
}

async function indexTask(tx: ISeqFileTransaction, root: string, task: TaskRecord): Promise<void> {
    await tx.setEntry(indexPath(root), `task/${task.id}`, encode({ status: task.status, updatedAt: task.updatedAt }));
    const readyKey = `ready/${task.id}`;
    if (task.status === 'ready') {
        await tx.setEntry(indexPath(root), readyKey, encode({
            priority: task.priority, createdAt: task.createdAt, readyAt: task.readyAt,
        }));
    } else {
        await tx.deleteEntry(indexPath(root), readyKey);
    }
}

async function appendEventTx(
    tx: ISeqFileTransaction,
    root: string,
    sessionId: string,
    taskId: string | undefined,
    type: string,
    payload?: unknown,
): Promise<number> {
    const sequence = await tx.increment(eventsPath(root), 'next-sequence');
    const event: EventEnvelope = { sequence, sessionId, taskId, type, payload, occurredAt: Date.now() };
    await tx.setEntry(eventsPath(root), `event/${String(sequence).padStart(16, '0')}`, encode(event));
    return sequence;
}

async function readTaskTx(tx: ISeqFileTransaction, root: string, taskId: string): Promise<TaskRecord | null> {
    const value = await tx.getEntry(taskPath(root, taskId), TASK_KEY);
    return value ? decode(value) : null;
}

async function requireTaskTx(tx: ISeqFileTransaction, root: string, taskId: string): Promise<TaskRecord> {
    const task = await readTaskTx(tx, root, taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
}

async function writeTaskTx(tx: ISeqFileTransaction, root: string, task: TaskRecord): Promise<void> {
    const value = encode(task);
    await tx.setEntry(taskPath(root, task.id), TASK_KEY, value);
    await tx.setEntry(taskPath(root, task.id), snapshotKey(task.version), value);
}

async function finishAttemptTx(
    tx: ISeqFileTransaction,
    root: string,
    task: TaskRecord,
    status: TaskRecord['status'],
    outcome?: TaskAttempt['outcome'],
): Promise<void> {
    if (!task.currentAttempt) return;
    const attempt = { ...task.currentAttempt, outcome: outcome ?? attemptOutcome(status), finishedAt: Date.now() };
    await tx.setEntry(taskPath(root, task.id), attemptKey(attempt.id), encode(attempt));
}

function attemptOutcome(status: TaskRecord['status']): NonNullable<TaskAttempt['outcome']> {
    if (status === 'succeeded') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'cancelled') return 'cancelled';
    return 'yielded';
}

function effectAttempt(workerId: string, leaseMs: number): EffectAttempt {
    return {
        id: createId('effect-attempt'), workerId, leaseToken: createId('effect-lease'),
        leaseUntil: Date.now() + leaseMs, startedAt: Date.now(),
    };
}

function effectClaimMatches(effect: PersistedEffect | undefined, claim: EffectClaim): boolean {
    return effect?.status === 'leased'
        && effect.currentAttempt?.leaseToken === claim.effect.currentAttempt?.leaseToken;
}

function replaceEffectAttempt(effect: PersistedEffect, attempt: EffectAttempt): PersistedEffect {
    const attempts = (effect.attempts ?? []).map(current => current.id === attempt.id ? attempt : current);
    return { ...effect, currentAttempt: attempt, attempts };
}

function finishEffect(
    effect: PersistedEffect,
    outcome: EffectCompletion,
): PersistedEffect {
    const status = outcome.indeterminate ? 'indeterminate' as const
        : outcome.error ? 'failed' as const : 'succeeded' as const;
    const attemptOutcome = outcome.indeterminate ? 'indeterminate' as const
        : outcome.error ? 'failed' as const : 'completed' as const;
    const attempt = { ...effect.currentAttempt!, outcome: attemptOutcome,
        finishedAt: Date.now() };
    return { ...replaceEffectAttempt(effect, attempt), status, currentAttempt: undefined, ...outcome };
}

function recoverEffect(
    effects: Record<string, PersistedEffect>,
    effectId: string,
): Record<string, PersistedEffect> {
    const effect = effects[effectId];
    if (effect?.status !== 'leased' || !effect.currentAttempt
        || effect.currentAttempt.leaseUntil > Date.now()) return effects;
    const lost = { ...effect.currentAttempt, outcome: 'lost' as const, finishedAt: Date.now() };
    const next = { ...replaceEffectAttempt(effect, lost), status: 'pending' as const, currentAttempt: undefined };
    return { ...effects, [effectId]: next };
}

async function applySpawnsTx(
    tx: ISeqFileTransaction,
    root: string,
    parent: TaskRecord,
    spawns: PreparedSpawn[],
): Promise<TaskRecord[]> {
    const created: TaskRecord[] = [];
    for (const spawn of spawns) {
        if (!spawn.spawnKey) throw new Error('Spawn key is required');
        const key = spawnMappingKey(parent.id, spawn.spawnKey);
        if (await tx.getEntry(graphPath(root), key)) continue;
        const spec = { ...spawn.spec, parent: parent.id, spawnKey: spawn.spawnKey };
        const task = await createSpawnTaskTx(tx, root, spawn.id, parent, spec);
        await tx.setEntry(graphPath(root), key, task.id);
        created.push(task);
    }
    return created;
}

async function createSpawnTaskTx(
    tx: ISeqFileTransaction,
    root: string,
    id: TaskId,
    parent: TaskRecord,
    spec: TaskSpec,
): Promise<TaskRecord> {
    let task = taskFromSpec(id, parent.sessionId, spec, Date.now());
    task = { ...task, rootTaskId: parent.rootTaskId };
    task = await resolveInitialDependencies(tx, root, task, spec.dependsOn ?? []);
    await writeTaskTx(tx, root, task);
    await writeDependencyEdges(tx, root, task.id, spec.dependsOn ?? []);
    await indexTask(tx, root, task);
    await appendEventTx(tx, root, parent.sessionId, task.id, 'task.spawned', {
        parentTaskId: parent.id, spawnKey: spec.spawnKey,
    });
    return task;
}

async function resolveInitialDependencies(
    tx: ISeqFileTransaction,
    root: string,
    task: TaskRecord,
    dependencies: import('../../domain/types').TaskDependency[],
): Promise<TaskRecord> {
    let unresolvedDeps = task.unresolvedDeps;
    const pendingEvents = [...task.pendingEvents];
    for (const dependency of dependencies) {
        const source = await readTaskTx(tx, root, dependency.task);
        if (!source || !isTerminal(source.status)) continue;
        if (!dependencySatisfied(source, dependency.condition) && dependency.onFailure !== 'continue') {
            const status = dependency.onFailure === 'skip' ? 'cancelled' : 'failed';
            return terminalDependency(task, status, source.id);
        }
        unresolvedDeps--;
        if (source.exit) pendingEvents.push({ type: 'task-exited', taskId: source.id, exit: source.exit });
    }
    const status = task.status === 'created'
        ? 'created' as const
        : unresolvedDeps === 0 ? 'ready' as const : task.status;
    return { ...task, pendingEvents, unresolvedDeps, status };
}

async function writeDependencyEdges(
    tx: ISeqFileTransaction,
    root: string,
    taskId: TaskId,
    dependencies: import('../../domain/types').TaskDependency[],
): Promise<void> {
    for (const dependency of dependencies) {
        await tx.setEntry(graphPath(root), `edge/${dependency.task}/${taskId}`, encode(dependency));
    }
}

function taskFromSpec(id: string, sessionId: string, spec: TaskSpec, now: number): TaskRecord {
    const retry = normalizeRetry(spec.retry);
    return {
        id, sessionId, parentTaskId: spec.parent, rootTaskId: spec.parent ?? id,
        spawnKey: spec.spawnKey, program: spec.program,
        status: spec.deferStart ? 'created' : spec.dependsOn?.length ? 'blocked' : 'ready',
        input: spec.input, pendingEvents: [], unresolvedDeps: spec.dependsOn?.length ?? 0,
        priority: spec.priority ?? 0, retry, attemptCount: 0,
        effects: {}, interactions: {}, labels: spec.labels, version: 0, createdAt: now, updatedAt: now,
    };
}

function normalizeRetry(retry: import('../../domain/types').RetryPolicy | undefined): import('../../domain/types').RetryPolicy {
    const value = retry ?? { maxAttempts: 1 };
    if (!Number.isInteger(value.maxAttempts) || value.maxAttempts < 1) {
        throw new Error('Retry maxAttempts must be a positive integer');
    }
    if (value.backoffMs !== undefined && (!Number.isFinite(value.backoffMs) || value.backoffMs < 0)) {
        throw new Error('Retry backoffMs must be non-negative');
    }
    return value;
}

function catalogPath(root: string): string { return join(root, 'catalog.seq'); }
function sessionPath(root: string): string { return join(root, 'session.seq'); }
function sharedPath(root: string): string { return join(root, 'shared.seq'); }
function contextPath(root: string): string { return join(root, 'context.seq'); }
function messagesPath(root: string): string { return join(root, 'messages.seq'); }
function resourcesPath(root: string): string { return join(root, 'resources.seq'); }
function eventsPath(root: string): string { return join(root, 'events.seq'); }
function indexPath(root: string): string { return join(root, 'index.seq'); }
function graphPath(root: string): string { return join(root, 'graph.seq'); }
function taskPath(root: string, id: string): string { return join(root, 'tasks', id, 'task.seq'); }
function attemptKey(id: string): string { return `attempt/${id}`; }
function snapshotKey(version: number): string { return `snapshot/${String(version).padStart(16, '0')}`; }
function taskWaitKey(targetId: string, waiterId: string): string {
    return `wait/task/${targetId}/${waiterId}`;
}
function spawnMappingKey(parentId: string, key: string): string {
    return `spawn/${parentId}/${encodeURIComponent(key)}`;
}
function outboxKey(id: string): string { return `outbox/${id}`; }
function inboxKey(id: string): string { return `inbox/${id}`; }
function join(...parts: string[]): string { return `/${parts.flatMap(part => part.split('/')).filter(Boolean).join('/')}`; }
function encode(value: unknown): string {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Value is not JSON serializable');
    return encoded;
}
function decode<T = any>(value: string): T { return JSON.parse(value) as T; }
function isTerminal(status: TaskRecord['status']): boolean {
    return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

function cancelActiveEffects(
    effects: TaskRecord['effects'],
    finishedAt: number,
): TaskRecord['effects'] {
    return Object.fromEntries(Object.entries(effects).map(([id, effect]) => {
        if (effect.status !== 'pending' && effect.status !== 'leased') return [id, effect];
        const current = effect.currentAttempt
            ? { ...effect.currentAttempt, finishedAt, outcome: 'cancelled' as const }
            : undefined;
        const attempts = current ? replaceAttempt(effect.attempts ?? [], current) : effect.attempts;
        return [id, { ...effect, status: 'cancelled' as const, attempts, currentAttempt: undefined }];
    }));
}

function replaceAttempt(attempts: EffectAttempt[], current: EffectAttempt): EffectAttempt[] {
    return attempts.map(attempt => attempt.id === current.id ? current : attempt);
}

async function requireSessionTx(tx: ISeqFileTransaction, root: string): Promise<SessionRecord> {
    const value = await tx.getEntry(sessionPath(root), SESSION_KEY);
    if (!value) throw new Error(`Session record missing at ${root}`);
    return decode(value);
}

function sharedKey(key: string): string { return `value/${encodeURIComponent(key)}`; }
function sharedHeadKey(key: string): string { return `head/${encodeURIComponent(key)}`; }
function sharedHistoryPrefix(key: string): string { return `history/${encodeURIComponent(key)}/`; }
function contextCommitKey(id: string): string { return `commit/${id}`; }
function contextBranchKey(name: string): string { return `branch/${encodeURIComponent(name)}`; }
function resourceKey(id: string): string { return `resource/${id}`; }
function handleKey(id: string): string { return `handle/${id}`; }
function budgetKey(resourceId: string, dimension: string): string {
    return `budget/${resourceId}/${encodeURIComponent(dimension)}`;
}
function workspaceSnapshotKey(id: string): string { return `workspace/snapshot/${id}`; }
function workspaceDiffKey(id: string): string { return `workspace/diff/${id}`; }

function validateSharedKey(key: string): void {
    if (!key || key.length > 256) throw new Error('Shared state key must contain 1-256 characters');
}

async function readContextBranchTx(
    tx: ISeqFileTransaction,
    root: string,
    name: string,
): Promise<ContextBranch> {
    const value = await tx.getEntry(contextPath(root), contextBranchKey(name));
    return value ? decode(value) : { name, version: 0, updatedAt: 0 };
}

function assertContextHead(name: string, actual: string | undefined, expected: string | null | undefined): void {
    if (expected === undefined) return;
    const matches = expected === null ? actual === undefined : actual === expected;
    if (!matches) throw new Error(`Context branch conflict for ${name}: expected ${expected}, got ${actual ?? 'missing'}`);
}

async function requireContextParents(
    tx: ISeqFileTransaction,
    root: string,
    parentIds: string[],
): Promise<void> {
    for (const id of parentIds) {
        if (!await tx.getEntry(contextPath(root), contextCommitKey(id))) {
            throw new Error(`Context parent not found: ${id}`);
        }
    }
}

async function writeContextBranchTx(
    tx: ISeqFileTransaction,
    root: string,
    name: string,
    head: string,
    version: number,
): Promise<void> {
    const branch: ContextBranch = { name, head, version: version + 1, updatedAt: Date.now() };
    await tx.setEntry(contextPath(root), contextBranchKey(name), encode(branch));
}

async function collectContextHistory(
    binding: ResolvedStorageBinding,
    head: string,
): Promise<ContextCommit[]> {
    const commits = new Map<string, ContextCommit>();
    const pending = [head];
    while (pending.length > 0) {
        const id = pending.pop()!;
        if (commits.has(id)) continue;
        const value = await seq(binding.fs).getEntry(contextPath(binding.rootPath), contextCommitKey(id));
        if (!value) throw new Error(`Context commit not found: ${id}`);
        const commit = decode<ContextCommit>(value);
        commits.set(id, commit);
        pending.push(...commit.parentIds);
    }
    return [...commits.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

async function requireResourceTx(
    tx: ISeqFileTransaction,
    root: string,
    id: string,
): Promise<ResourceRecord> {
    const value = await tx.getEntry(resourcesPath(root), resourceKey(id));
    if (!value) throw new Error(`Resource not found: ${id}`);
    return decode(value);
}

async function requireHandleTx(
    tx: ISeqFileTransaction,
    root: string,
    id: string,
): Promise<ResourceHandle> {
    const value = await tx.getEntry(resourcesPath(root), handleKey(id));
    if (!value) throw new Error(`Resource handle not found: ${id}`);
    return decode(value);
}

async function authorizeHandleTx(
    tx: ISeqFileTransaction,
    root: string,
    handle: ResourceHandle,
    right: ResourceRight,
): Promise<ResourceRecord> {
    const resource = await requireResourceTx(tx, root, handle.resourceId);
    await assertHandleChainActive(tx, root, handle, resource.generation);
    if (!handle.rights.includes('admin') && !handle.rights.includes(right)) {
        throw new Error(`Handle ${handle.id} lacks ${right} right`);
    }
    return resource;
}

async function assertHandleChainActive(
    tx: ISeqFileTransaction,
    root: string,
    handle: ResourceHandle,
    generation: number,
): Promise<void> {
    let current: ResourceHandle | undefined = handle;
    const visited = new Set<string>();
    while (current) {
        if (visited.has(current.id)) throw new Error(`Resource handle cycle: ${current.id}`);
        if (current.revokedAt || current.generation !== generation) throw new Error(`Resource handle revoked: ${current.id}`);
        visited.add(current.id);
        current = current.parentHandleId ? await requireHandleTx(tx, root, current.parentHandleId) : undefined;
    }
}

function assertRightsSubset(parent: ResourceHandle, rights: ResourceRight[]): void {
    if (parent.rights.includes('admin')) return;
    for (const right of rights) {
        if (!parent.rights.includes(right)) throw new Error(`Grant would elevate ${right} right`);
    }
}

function uniqueRights(rights: ResourceRight[]): ResourceRight[] {
    return [...new Set(rights)];
}

async function allHandlesTx(
    tx: ISeqFileTransaction,
    root: string,
): Promise<Map<string, ResourceHandle>> {
    const handles = new Map<string, ResourceHandle>();
    await tx.walkEntries(resourcesPath(root), entry => {
        const handle = decode<ResourceHandle>(entry.value);
        handles.set(handle.id, handle);
        return true;
    }, { keyPrefix: 'handle/' });
    return handles;
}

function descendantHandleIds(handles: Map<string, ResourceHandle>, rootId: string): Set<string> {
    const result = new Set([rootId]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const handle of handles.values()) {
            if (handle.parentHandleId && result.has(handle.parentHandleId) && !result.has(handle.id)) {
                result.add(handle.id);
                changed = true;
            }
        }
    }
    return result;
}

async function readBudgetTx(
    tx: ISeqFileTransaction,
    root: string,
    resourceId: string,
    dimension: string,
): Promise<BudgetAccount | undefined> {
    const value = await tx.getEntry(resourcesPath(root), budgetKey(resourceId, dimension));
    return value ? decode(value) : undefined;
}

function assertBudgetVersion(
    resourceId: string,
    dimension: string,
    actual: number | undefined,
    expected: number | null | undefined,
): void {
    if (expected === undefined) return;
    const matches = expected === null ? actual === undefined : actual === expected;
    if (!matches) throw new Error(`Budget conflict for ${resourceId}/${dimension}`);
}

function budgetAccount(
    resourceId: string,
    dimension: string,
    hardLimit: number,
    current?: BudgetAccount,
): BudgetAccount {
    if (!Number.isFinite(hardLimit) || hardLimit < (current?.used ?? 0)) throw new Error('Invalid budget hard limit');
    return {
        resourceId, dimension, hardLimit, used: current?.used ?? 0,
        version: (current?.version ?? 0) + 1, updatedAt: Date.now(),
    };
}

async function resourceBudgetsTx(
    tx: ISeqFileTransaction,
    root: string,
    resource: ResourceRecord,
    dimension: string,
): Promise<BudgetAccount[]> {
    const budgets: BudgetAccount[] = [];
    let current: ResourceRecord | undefined = resource;
    while (current) {
        const budget = await readBudgetTx(tx, root, current.id, dimension);
        if (budget) budgets.push(budget);
        current = current.parentResourceId ? await requireResourceTx(tx, root, current.parentResourceId) : undefined;
    }
    return budgets;
}

function assertBudgetCapacity(budget: BudgetAccount, amount: number): void {
    if (budget.used + amount > budget.hardLimit) {
        throw new Error(`Budget exceeded for ${budget.resourceId}/${budget.dimension}`);
    }
}

async function readSharedTx<T extends import('../../domain/types').JsonValue>(
    tx: ISeqFileTransaction,
    root: string,
    key: string,
): Promise<SharedStateEntry<T> | undefined> {
    const value = await tx.getEntry(sharedPath(root), sharedKey(key));
    return value ? decode(value) : undefined;
}

function assertSharedVersion(key: string, actual: number | undefined, expected: number | null | undefined): void {
    if (expected === undefined) return;
    const matches = expected === null ? actual === undefined : actual === expected;
    if (!matches) throw new Error(`Shared state conflict for ${key}: expected ${expected}, got ${actual ?? 'missing'}`);
}

function sharedEntry<T extends import('../../domain/types').JsonValue>(
    key: string,
    value: T,
    version: number,
    taskId?: TaskId,
): SharedStateEntry<T> {
    return { key, value, version, updatedAt: Date.now(), updatedByTaskId: taskId };
}

async function nextSharedVersion(tx: ISeqFileTransaction, root: string, key: string): Promise<number> {
    const value = await tx.getEntry(sharedPath(root), sharedHeadKey(key));
    return (value ? Number(value) : 0) + 1;
}

async function writeSharedRevision<T extends import('../../domain/types').JsonValue>(
    tx: ISeqFileTransaction,
    root: string,
    entry: SharedStateEntry<T>,
): Promise<void> {
    await tx.setEntry(sharedPath(root), sharedKey(entry.key), encode(entry));
    await writeSharedHistory(tx, root, { ...entry, deleted: false });
}

async function writeSharedHistory(
    tx: ISeqFileTransaction,
    root: string,
    revision: SharedStateRevision,
): Promise<void> {
    const version = String(revision.version).padStart(16, '0');
    await tx.setEntry(sharedPath(root), sharedHeadKey(revision.key), String(revision.version));
    await tx.setEntry(sharedPath(root), `${sharedHistoryPrefix(revision.key)}${version}`, encode(revision));
}

function deletedRevision(key: string, version: number, taskId?: TaskId): SharedStateRevision {
    return { key, version, deleted: true, updatedAt: Date.now(), updatedByTaskId: taskId };
}

async function applySharedMutations(
    tx: ISeqFileTransaction,
    root: string,
    task: TaskRecord,
    mutations: NonNullable<TaskCommitSideEffects['shared']>,
): Promise<void> {
    for (const mutation of mutations) {
        validateSharedKey(mutation.key);
        const current = await readSharedTx(tx, root, mutation.key);
        assertSharedVersion(mutation.key, current?.version, mutation.expectedVersion);
        if (mutation.type === 'delete') {
            if (current) {
                await tx.deleteEntry(sharedPath(root), sharedKey(mutation.key));
                await writeSharedHistory(tx, root, deletedRevision(mutation.key, current.version + 1, task.id));
                await appendEventTx(tx, root, task.sessionId, task.id,
                    'session.shared.deleted', { key: mutation.key, version: current.version + 1 });
            }
            continue;
        }
        const version = await nextSharedVersion(tx, root, mutation.key);
        const entry = sharedEntry(mutation.key, mutation.value, version, task.id);
        await writeSharedRevision(tx, root, entry);
        await appendEventTx(tx, root, task.sessionId, task.id,
            'session.shared.set', { key: mutation.key, version });
    }
}

async function readMessages(
    binding: ResolvedStorageBinding,
    prefix: 'outbox/' | 'inbox/',
): Promise<CrossSessionMessage[]> {
    const messages: CrossSessionMessage[] = [];
    await seq(binding.fs).walkEntries(messagesPath(binding.rootPath), entry => {
        messages.push(decode(entry.value));
        return true;
    }, { keyPrefix: prefix });
    return messages.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function dependencySatisfied(
    task: TaskRecord,
    condition: import('../../domain/types').TaskDependency['condition'],
): boolean {
    return condition === 'terminal' ? isTerminal(task.status) : task.status === 'succeeded';
}

async function registerTaskWaitTx(
    tx: ISeqFileTransaction,
    root: string,
    task: TaskRecord,
): Promise<TaskRecord> {
    if (task.status !== 'waiting' || !task.wait) return task;
    const wait = await normalizeWaitSpecTx(tx, root, task.id, task.wait);
    validateWaitSpec(wait);
    validateInteractionWaits(task, wait);
    task = await hydrateTaskWaitEventsTx(tx, root, { ...task, wait });
    if (pendingSatisfiesWait(task)) {
        await unregisterTaskWaitTx(tx, root, task);
        return { ...task, status: 'ready', wait: undefined };
    }
    await registerTaskTargetsTx(tx, root, task);
    return task;
}

async function normalizeWaitSpecTx(
    tx: ISeqFileTransaction,
    root: string,
    taskId: string,
    wait: import('../../domain/types').WaitSpec,
): Promise<import('../../domain/types').WaitSpec> {
    if (wait.type === 'child') {
        const value = await tx.getEntry(graphPath(root), spawnMappingKey(taskId, wait.spawnKey));
        if (!value) throw new Error(`Spawned child not found: ${wait.spawnKey}`);
        return { type: 'task', id: value };
    }
    if (wait.type !== 'any' && wait.type !== 'all' && wait.type !== 'quorum') return wait;
    const waits = await Promise.all(wait.waits.map(item => normalizeWaitSpecTx(tx, root, taskId, item)));
    return { ...wait, waits };
}

function pendingSatisfiesWait(task: TaskRecord): boolean {
    return task.wait ? waitSatisfied(task.wait, task.pendingEvents) : false;
}

async function unregisterTaskWaitTx(tx: ISeqFileTransaction, root: string, task: TaskRecord): Promise<void> {
    if (!task.wait) return;
    for (const targetId of waitTaskIds(task.wait)) {
        await tx.deleteEntry(graphPath(root), taskWaitKey(targetId, task.id));
    }
}

async function wakeTaskWaiters(
    tx: ISeqFileTransaction,
    root: string,
    completed: TaskRecord,
): Promise<void> {
    if (!completed.exit) return;
    const keys: string[] = [];
    await tx.walkEntries(graphPath(root), entry => {
        keys.push(entry.key);
        return true;
    }, { keyPrefix: `wait/task/${completed.id}/` });
    for (const key of keys) await wakeTaskWaiter(tx, root, completed, key);
}

async function wakeTaskWaiter(
    tx: ISeqFileTransaction,
    root: string,
    completed: TaskRecord,
    key: string,
): Promise<void> {
    const waiterId = key.split('/')[3];
    const waiter = await readTaskTx(tx, root, waiterId);
    await tx.deleteEntry(graphPath(root), key);
    if (!waiter || waiter.status !== 'waiting' || !waiter.wait) return;
    const event = { type: 'task-exited' as const, taskId: completed.id, exit: completed.exit! };
    const pendingEvents = hasTaskExit(waiter, completed.id)
        ? waiter.pendingEvents : [...waiter.pendingEvents, event];
    let next: TaskRecord = { ...waiter, pendingEvents, version: waiter.version + 1, updatedAt: Date.now() };
    next = wakeFromPendingEvents(next);
    if (next.status === 'ready') await unregisterTaskWaitTx(tx, root, waiter);
    await writeTaskTx(tx, root, next);
    await indexTask(tx, root, next);
    await appendEventTx(tx, root, waiter.sessionId, waiter.id,
        next.status === 'ready' ? 'task.wait.satisfied' : 'task.wait.progress', event);
}

function wakeFromPendingEvents(task: TaskRecord): TaskRecord {
    if (task.status !== 'waiting' || !pendingSatisfiesWait(task)) return task;
    return { ...task, status: 'ready', wait: undefined };
}

function waitSatisfied(
    wait: import('../../domain/types').WaitSpec,
    events: import('../../domain/types').TaskInputEvent[],
): boolean {
    if (wait.type === 'signal') return events.some(event => event.type === 'signal' && (!wait.id || event.signal.type === wait.id));
    if (wait.type === 'effect') return events.some(event => (event.type === 'effect-completed' || event.type === 'effect-failed') && (!wait.id || event.effectId === wait.id));
    if (wait.type === 'task') return events.some(event => event.type === 'task-exited' && event.taskId === wait.id);
    if (wait.type === 'interaction') {
        return events.some(event => event.type === 'interaction-resolved' && event.interactionId === wait.id);
    }
    if (wait.type === 'child') return false;
    const satisfied = wait.waits.filter(item => waitSatisfied(item, events)).length;
    if (wait.type === 'any') return satisfied >= 1;
    if (wait.type === 'all') return satisfied === wait.waits.length;
    return satisfied >= wait.required;
}

function validateWaitSpec(wait: import('../../domain/types').WaitSpec): void {
    if (wait.type !== 'any' && wait.type !== 'all' && wait.type !== 'quorum') return;
    if (wait.waits.length === 0) throw new Error(`${wait.type} wait requires at least one condition`);
    if (wait.type === 'quorum' && (wait.required < 1 || wait.required > wait.waits.length)) {
        throw new Error('Quorum wait has invalid required count');
    }
    for (const item of wait.waits) validateWaitSpec(item);
}

function validateInteractionWaits(task: TaskRecord, wait: import('../../domain/types').WaitSpec): void {
    if (wait.type === 'interaction' && !task.interactions?.[wait.id]) {
        throw new Error(`Interaction wait target not found: ${wait.id}`);
    }
    if (wait.type !== 'any' && wait.type !== 'all' && wait.type !== 'quorum') return;
    for (const item of wait.waits) validateInteractionWaits(task, item);
}

function waitTaskIds(wait: import('../../domain/types').WaitSpec): string[] {
    if (wait.type === 'task') return [wait.id];
    if (wait.type !== 'any' && wait.type !== 'all' && wait.type !== 'quorum') return [];
    return [...new Set(wait.waits.flatMap(waitTaskIds))];
}

async function hydrateTaskWaitEventsTx(
    tx: ISeqFileTransaction,
    root: string,
    task: TaskRecord,
): Promise<TaskRecord> {
    if (!task.wait) return task;
    let pendingEvents = task.pendingEvents;
    for (const targetId of waitTaskIds(task.wait)) {
        if (targetId === task.id) throw new Error(`Task cannot wait for itself: ${task.id}`);
        const target = await readTaskTx(tx, root, targetId);
        if (!target) throw new Error(`Wait target not found: ${targetId}`);
        if (isTerminal(target.status) && target.exit && !hasTaskExit(task, targetId)) {
            pendingEvents = [...pendingEvents, { type: 'task-exited', taskId: targetId, exit: target.exit }];
        }
    }
    return { ...task, pendingEvents };
}

async function registerTaskTargetsTx(
    tx: ISeqFileTransaction,
    root: string,
    task: TaskRecord,
): Promise<void> {
    if (!task.wait) return;
    for (const targetId of waitTaskIds(task.wait)) {
        const target = await requireTaskTx(tx, root, targetId);
        if (!isTerminal(target.status)) {
            await tx.setEntry(graphPath(root), taskWaitKey(targetId, task.id), encode(task.wait));
        }
    }
}

function hasTaskExit(task: TaskRecord, targetId: string): boolean {
    return task.pendingEvents.some(event => event.type === 'task-exited' && event.taskId === targetId);
}

async function advanceDependants(
    tx: ISeqFileTransaction,
    root: string,
    completed: TaskRecord,
): Promise<void> {
    const edges: Array<{ dependentId: string; dependency: import('../../domain/types').TaskDependency }> = [];
    await tx.walkEntries(graphPath(root), entry => {
        edges.push({ dependentId: entry.key.split('/')[2], dependency: decode(entry.value) });
        return true;
    }, { keyPrefix: `edge/${completed.id}/` });
    for (const edge of edges) await advanceDependant(tx, root, completed, edge);
}

async function advanceDependant(
    tx: ISeqFileTransaction,
    root: string,
    completed: TaskRecord,
    edge: { dependentId: string; dependency: import('../../domain/types').TaskDependency },
): Promise<void> {
    const task = await requireTaskTx(tx, root, edge.dependentId);
    if (task.status !== 'blocked' && task.status !== 'created') return;
    const failed = completed.status !== 'succeeded' && edge.dependency.condition !== 'terminal';
    if (failed && edge.dependency.onFailure !== 'continue') {
        const status = edge.dependency.onFailure === 'skip' ? 'cancelled' as const : 'failed' as const;
        const next = terminalDependency(task, status, completed.id);
        await writeTaskTx(tx, root, next);
        await indexTask(tx, root, next);
        return;
    }
    const unresolvedDeps = Math.max(0, task.unresolvedDeps - 1);
    const pendingEvents = [...task.pendingEvents, {
        type: 'task-exited' as const, taskId: completed.id, exit: completed.exit!,
    }];
    const next = { ...task, unresolvedDeps, pendingEvents,
        status: task.status === 'created'
            ? 'created' as const
            : unresolvedDeps === 0 ? 'ready' as const : 'blocked' as const,
        version: task.version + 1, updatedAt: Date.now() };
    await writeTaskTx(tx, root, next);
    await indexTask(tx, root, next);
}

function terminalDependency(
    task: TaskRecord,
    status: 'failed' | 'cancelled',
    dependencyId: string,
): TaskRecord {
    const completedAt = Date.now();
    const error = { message: `Dependency ${dependencyId} did not succeed` };
    return { ...task, status, exit: { taskId: task.id, status, error, completedAt },
        version: task.version + 1, updatedAt: completedAt };
}
export function createId(prefix: string): string { return `${prefix}_${globalThis.crypto.randomUUID()}`; }
