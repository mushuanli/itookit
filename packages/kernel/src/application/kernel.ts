import { EventBus, type IModuleFS } from '@itookit/vfs-core';
import { EffectRegistry, ProgramRegistry, StorageResolverRegistry, WorkspaceRegistry } from '../ports/registry';
import type { KernelPlugin, KernelRegistration } from '../ports/plugin';
import { DurablePoller } from '../runtime/durable-poller';
import { LeaseHeartbeat } from '../runtime/lease-heartbeat';
import { DefaultSessionHandle } from '../public/session-handle';
import { DefaultTaskHandle } from '../public/task-handle';
import {
    createId,
    SeqFileKernelStore,
    type EffectClaim,
    type TaskClaim,
} from '../infrastructure/seqfile/store';
import type {
    BudgetAccount,
    ContextBranch,
    ContextCommit,
    ContextCommitOptions,
    CrossSessionMessage,
    Decision,
    DurableTaskProgram,
    EffectAdapter,
    EffectRequest,
    EventEnvelope,
    InteractionResponse,
    RecoveryReport,
    ResolvedStorageBinding,
    ResourceGrant,
    ResourceHandle,
    ResourceRecord,
    ResourceRight,
    ResourceSpec,
    SessionHandle,
    SessionId,
    SessionRecord,
    SharedStateEntry,
    SharedStateRevision,
    SharedStateWriteOptions,
    SessionStorageResolver,
    StorageBindingRef,
    TaskHandle,
    TaskId,
    TaskRecord,
    TaskSignal,
    TaskSnapshot,
    WorkspaceAdapter,
    WorkspaceDiff,
    WorkspaceMergeResult,
    WorkspaceSnapshot,
} from '../domain/types';
import { assertDurableValue } from './durability';
import { failureDecision, isTerminalStatus, mergeReport, nextDecision, shouldRetry, transition, validateDecision } from './decision';
import { activeEffectIds, addEffect, addInteraction, effectControllerKey, effectFailure, executeEffectWithDeadline, isMissingPath, normalizeEffect, type RequiredEffect } from './effect-utils';
import { assertWorkspace, assertWorkspaceSnapshots, readWorkspaceSnapshots, workspaceContext, workspaceSnapshot } from './workspace-utils';
import { decisionSideEffects, prepareSpawns } from './actions';

interface KernelEvents { changed: { sessionId: string; taskId?: string }; }

export interface KernelOptions {
    catalog: { fs: IModuleFS; rootPath?: string };
    workerId?: string;
    maxConcurrent?: number;
    leaseMs?: number;
    pollMs?: number;
}

export class Kernel implements KernelRegistration {
    readonly programs = new ProgramRegistry();
    readonly effects = new EffectRegistry();
    readonly storageResolvers = new StorageResolverRegistry();
    readonly workspaces = new WorkspaceRegistry();
    private readonly eventsBus = new EventBus<KernelEvents>();
    private readonly sessions = new Map<SessionId, ResolvedStorageBinding>();
    private readonly draining = new Set<SessionId>();
    private readonly store: SeqFileKernelStore;
    private readonly workerId: string;
    private readonly maxConcurrent: number;
    private readonly leaseMs: number;
    private readonly poller: DurablePoller<SessionId>;
    private readonly heartbeats = new Set<LeaseHeartbeat>();
    private readonly effectControllers = new Map<string, AbortController>();
    private readonly plugins = new Map<string, KernelPlugin>();
    private disposed = false;
    private active = 0;

    constructor(options: KernelOptions) {
        this.workerId = options.workerId ?? createId('worker');
        this.maxConcurrent = options.maxConcurrent ?? 4;
        this.leaseMs = options.leaseMs ?? 30_000;
        const pollMs = options.pollMs ?? 250;
        if (this.leaseMs <= 0) throw new Error('Kernel leaseMs must be positive');
        if (pollMs < 0) throw new Error('Kernel pollMs must be non-negative');
        const catalog = { fs: options.catalog.fs, rootPath: options.catalog.rootPath ?? '/.config/kernel' };
        this.store = new SeqFileKernelStore(catalog, reference => this.resolveStorage(reference));
        this.poller = new DurablePoller({
            intervalMs: pollMs,
            poll: sessionId => this.poll(sessionId),
            onError: (_sessionId, error) => this.handlePollError(error),
        });
    }

    async initialize(): Promise<void> { await this.store.initialize(); }
    dispose(): void {
        this.disposed = true;
        this.poller.dispose();
        for (const heartbeat of this.heartbeats) heartbeat.stop();
        this.heartbeats.clear();
        for (const controller of this.effectControllers.values()) controller.abort();
        this.effectControllers.clear();
    }

    /** 等待所有 in-flight 的 drain/execute 完成（dispose 后调用，避免上层过早关闭存储后端）。 */
    async waitIdle(timeoutMs = 5000): Promise<void> {
        const startedAt = Date.now();
        while (this.active > 0 || this.draining.size > 0) {
            if (Date.now() - startedAt >= timeoutMs) return;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
    registerProgram(program: DurableTaskProgram): void { this.programs.register(program); }
    registerEffect(adapter: EffectAdapter): void { this.effects.register(adapter); }
    registerStorageResolver(resolver: SessionStorageResolver): void { this.storageResolvers.register(resolver); }
    registerWorkspace(adapter: WorkspaceAdapter): void { this.workspaces.register(adapter); }

    async use(plugin: KernelPlugin): Promise<void> {
        const key = `${plugin.id}@${plugin.version}`;
        if (this.plugins.has(key)) throw new Error(`Kernel plugin already installed: ${key}`);
        await plugin.install(this);
        this.plugins.set(key, plugin);
    }

    async createSession(spec: { id?: string; storage: StorageBindingRef }): Promise<SessionHandle> {
        const id = spec.id ?? createId('session');
        await this.store.createSession(id, spec.storage);
        const binding = await this.resolveStorage(spec.storage);
        this.sessions.set(id, binding);
        this.schedulePoll(id);
        return new DefaultSessionHandle(this, id);
    }

    async openSession(id: SessionId): Promise<SessionHandle> {
        const opened = await this.store.openSession(id);
        this.sessions.set(id, opened.binding);
        this.queueDrain(id);
        this.schedulePoll(id);
        return new DefaultSessionHandle(this, id);
    }

    async *listSessions(): AsyncIterable<SessionRecord> {
        for (const session of await this.store.listSessions()) yield session;
    }

    async openTask<O = unknown>(id: TaskId): Promise<TaskHandle<O>> {
        const sessionId = await this.store.locateTask(id);
        if (!this.sessions.has(sessionId)) await this.openSession(sessionId);
        return new DefaultTaskHandle<O>(this, sessionId, id);
    }

    async inspectTask(id: TaskId): Promise<TaskSnapshot> {
        const handle = await this.openTask(id);
        return handle.status();
    }

    async recover(): Promise<RecoveryReport> {
        const total: RecoveryReport = {
            recoveredTasks: 0, recoveredEffects: 0, expiredAttempts: 0, rebuiltIndexes: 0,
        };
        for (const session of await this.store.listSessions()) {
            const opened = await this.store.openSession(session.id);
            this.sessions.set(session.id, opened.binding);
            mergeReport(total, await this.store.recover(opened.binding));
            await this.dispatchPendingEffects(opened.binding);
            this.queueDrain(session.id);
            this.schedulePoll(session.id);
        }
        await this.relayPendingMessages();
        return total;
    }

    async submit<I, O>(sessionId: string, spec: import('../domain/types').TaskSpec<I>): Promise<TaskHandle<O>> {
        const binding = await this.binding(sessionId);
        const task = await this.store.createTask(binding, sessionId, spec);
        this.notify(sessionId, task.id);
        this.queueDrain(sessionId);
        return new DefaultTaskHandle<O>(this, sessionId, task.id);
    }

    async task(sessionId: string, taskId: string): Promise<TaskRecord> {
        return this.store.readTask(await this.binding(sessionId), taskId);
    }

    async taskHistory(sessionId: string, taskId: string, afterVersion = -1): Promise<TaskRecord[]> {
        return this.store.taskHistory(await this.binding(sessionId), taskId, afterVersion);
    }

    async taskAttempts(sessionId: string, taskId: string): Promise<import('../domain/types').TaskAttempt[]> {
        return this.store.taskAttempts(await this.binding(sessionId), taskId);
    }

    async signal(sessionId: string, taskId: string, signal: TaskSignal): Promise<void> {
        await this.store.signalTask(await this.binding(sessionId), taskId, signal);
        this.notify(sessionId, taskId);
        this.queueDrain(sessionId);
    }

    async startTask(sessionId: string, taskId: string): Promise<void> {
        await this.store.startTask(await this.binding(sessionId), taskId);
        this.notify(sessionId, taskId);
        this.queueDrain(sessionId);
    }

    async respondInteraction<T extends import('../domain/types').JsonValue>(
        sessionId: string,
        taskId: string,
        response: InteractionResponse<T>,
    ): Promise<void> {
        await this.store.resolveInteraction(await this.binding(sessionId), taskId, response);
        this.notify(sessionId, taskId);
        this.queueDrain(sessionId);
    }

    async cancel(sessionId: string, taskId: string, reason?: string): Promise<void> {
        const binding = await this.binding(sessionId);
        const current = await this.store.readTask(binding, taskId);
        const activeEffects = activeEffectIds(current);
        const task = await this.store.cancelTask(binding, taskId, reason);
        this.notify(sessionId, taskId);
        this.queueDrain(sessionId);
        await this.cancelTaskEffects(task, activeEffects);
    }

    async eventList(sessionId: string, after: number): Promise<EventEnvelope[]> {
        return this.store.events(await this.binding(sessionId), after);
    }

    async getShared<T extends import('../domain/types').JsonValue>(sessionId: string, key: string): Promise<SharedStateEntry<T> | undefined> {
        return this.store.getShared<T>(await this.binding(sessionId), key);
    }

    async setShared<T extends import('../domain/types').JsonValue>(
        sessionId: string, key: string, value: T, options?: SharedStateWriteOptions,
    ): Promise<SharedStateEntry<T>> {
        const entry = await this.store.setShared(await this.binding(sessionId), key, value, options);
        this.notify(sessionId, options?.taskId);
        return entry;
    }

    async deleteShared(sessionId: string, key: string, options?: SharedStateWriteOptions): Promise<boolean> {
        const deleted = await this.store.deleteShared(await this.binding(sessionId), key, options);
        if (deleted) this.notify(sessionId, options?.taskId);
        return deleted;
    }

    async listShared(sessionId: string, prefix?: string): Promise<SharedStateEntry[]> {
        return this.store.listShared(await this.binding(sessionId), prefix);
    }

    async sharedHistory<T extends import('../domain/types').JsonValue>(
        sessionId: string, key: string,
    ): Promise<SharedStateRevision<T>[]> {
        return this.store.sharedHistory<T>(await this.binding(sessionId), key);
    }

    async sendCrossSession<T extends import('../domain/types').JsonValue>(
        sourceSessionId: string,
        targetSessionId: string,
        topic: string,
        payload: T,
    ): Promise<CrossSessionMessage<T>> {
        if (!topic) throw new Error('Cross-session message topic is required');
        const message: CrossSessionMessage<T> = {
            id: createId('message'), sourceSessionId, targetSessionId, topic, payload,
            status: 'pending', createdAt: Date.now(),
        };
        const source = await this.binding(sourceSessionId);
        await this.store.createOutboxMessage(source, message);
        try { return await this.relayMessage(source, message) as CrossSessionMessage<T>; }
        catch { return message; }
    }

    async inbox(sessionId: string, after = 0): Promise<CrossSessionMessage[]> {
        return this.store.inbox(await this.binding(sessionId), after);
    }

    async commitContext<T extends import('../domain/types').JsonValue>(
        sessionId: string, delta: T, options: ContextCommitOptions = {},
    ): Promise<ContextCommit<T>> {
        const commit: ContextCommit<T> = {
            id: createId('context'), sessionId, parentIds: [], delta,
            authorTaskId: options.taskId, createdAt: Date.now(),
        };
        const result = await this.store.commitContext(await this.binding(sessionId), commit, options);
        this.notify(sessionId, options.taskId);
        return result;
    }

    async getContextCommit<T extends import('../domain/types').JsonValue>(sessionId: string, id: string): Promise<ContextCommit<T> | undefined> {
        return this.store.getContextCommit<T>(await this.binding(sessionId), id);
    }

    async getContextBranch(sessionId: string, name = 'main'): Promise<ContextBranch> {
        return this.store.getContextBranch(await this.binding(sessionId), name);
    }

    async contextHistory(sessionId: string, head?: string): Promise<ContextCommit[]> {
        return this.store.contextHistory(await this.binding(sessionId), head);
    }

    async createResource(sessionId: string, spec: ResourceSpec): Promise<ResourceGrant> {
        const resource: ResourceRecord = {
            id: createId('resource'), sessionId, kind: spec.kind, uri: spec.uri,
            generation: 1, parentResourceId: spec.parentResourceId,
            metadata: spec.metadata, createdAt: Date.now(),
        };
        const handle: ResourceHandle = {
            id: createId('handle'), resourceId: resource.id, holderTaskId: spec.ownerTaskId,
            rights: spec.rights ?? ['read', 'write', 'execute', 'grant', 'admin'], generation: 1,
        };
        return this.store.createResource(await this.binding(sessionId), resource, handle, spec.parentHandleId);
    }

    async grantResource(
        sessionId: string, parentHandleId: string, holderTaskId: string, rights: ResourceRight[],
    ): Promise<ResourceHandle> {
        return this.store.grantResource(
            await this.binding(sessionId), createId('handle'), parentHandleId, holderTaskId, rights,
        );
    }

    async revokeResource(sessionId: string, handleId: string): Promise<number> {
        return this.store.revokeResource(await this.binding(sessionId), handleId);
    }

    async authorizeResource(
        sessionId: string, handleId: string, right: ResourceRight, holderTaskId?: string,
    ): Promise<ResourceRecord> {
        return this.store.authorizeResource(await this.binding(sessionId), handleId, right, holderTaskId);
    }

    async setBudget(
        sessionId: string, handleId: string, dimension: string, hardLimit: number,
        expectedVersion?: number | null,
    ): Promise<BudgetAccount> {
        return this.store.setBudget(
            await this.binding(sessionId), handleId, dimension, hardLimit, expectedVersion,
        );
    }

    async chargeBudget(
        sessionId: string, handleId: string, dimension: string, amount: number,
    ): Promise<BudgetAccount[]> {
        return this.store.chargeBudget(await this.binding(sessionId), handleId, dimension, amount);
    }

    async snapshotWorkspace(
        sessionId: string,
        handleId: string,
        adapterRef: import('../domain/types').ProgramRef,
    ): Promise<WorkspaceSnapshot> {
        const binding = await this.binding(sessionId);
        const resource = await this.store.authorizeResource(binding, handleId, 'read');
        assertWorkspace(resource);
        const adapter = this.workspaces.resolve(adapterRef.kind, adapterRef.version);
        const payload = await adapter.snapshot(resource.uri, workspaceContext(sessionId, resource));
        const snapshot = workspaceSnapshot(sessionId, resource.id, adapterRef, payload);
        return this.store.saveWorkspaceSnapshot(binding, snapshot);
    }

    async diffWorkspace(
        sessionId: string,
        handleId: string,
        baseId: string,
        targetId: string,
    ): Promise<WorkspaceDiff> {
        const binding = await this.binding(sessionId);
        const resource = await this.store.authorizeResource(binding, handleId, 'read');
        const [base, target] = await readWorkspaceSnapshots(this.store, binding, [baseId, targetId]);
        assertWorkspaceSnapshots(resource, base, target);
        const adapter = this.workspaces.resolve(base.adapter.kind, base.adapter.version);
        const payload = await adapter.diff(base.payload, target.payload, workspaceContext(sessionId, resource));
        const diff: WorkspaceDiff = {
            id: createId('workspace-diff'), sessionId, resourceId: resource.id,
            adapter: base.adapter, baseSnapshotId: base.id, targetSnapshotId: target.id,
            payload, createdAt: Date.now(),
        };
        return this.store.saveWorkspaceDiff(binding, diff);
    }

    async mergeWorkspace(
        sessionId: string,
        handleId: string,
        baseId: string,
        leftId: string,
        rightId: string,
    ): Promise<WorkspaceMergeResult> {
        const binding = await this.binding(sessionId);
        const resource = await this.store.authorizeResource(binding, handleId, 'write');
        const [base, left, right] = await readWorkspaceSnapshots(this.store, binding, [baseId, leftId, rightId]);
        assertWorkspaceSnapshots(resource, base, left, right);
        const adapter = this.workspaces.resolve(base.adapter.kind, base.adapter.version);
        const result = await adapter.merge(base.payload, left.payload, right.payload,
            workspaceContext(sessionId, resource));
        const snapshot = workspaceSnapshot(sessionId, resource.id, base.adapter, result.payload, [left.id, right.id]);
        return { snapshot: await this.store.saveWorkspaceSnapshot(binding, snapshot), conflicts: result.conflicts ?? [] };
    }

    async relayPendingMessages(): Promise<number> {
        let delivered = 0;
        for (const session of await this.store.listSessions()) {
            const source = await this.binding(session.id);
            for (const message of await this.store.pendingOutbox(source)) {
                try { await this.relayMessage(source, message); delivered++; } catch { /* Retry on recovery. */ }
            }
        }
        return delivered;
    }

    private async relayMessage(
        source: ResolvedStorageBinding,
        message: CrossSessionMessage,
    ): Promise<CrossSessionMessage> {
        const target = await this.binding(message.targetSessionId);
        await this.store.deliverMessage(target, message);
        const delivered = await this.store.markMessageDelivered(source, message.id);
        this.notify(message.targetSessionId);
        this.notify(message.sourceSessionId);
        return delivered;
    }

    async setSessionStatus(sessionId: string, status: SessionRecord['status']): Promise<void> {
        const binding = await this.binding(sessionId);
        await this.store.setSessionStatus(binding, status);
        this.notify(sessionId);
        if (status === 'open') {
            this.queueDrain(sessionId);
            this.schedulePoll(sessionId);
        }
    }

    async closeSession(sessionId: string, cancelRunning: boolean): Promise<void> {
        const binding = await this.binding(sessionId);
        await this.store.setSessionStatus(binding, 'closing');
        if (cancelRunning) {
            const tasks = await this.store.listTasks(binding);
            for (const task of tasks) {
                if (!isTerminalStatus(task.status)) await this.cancel(sessionId, task.id, 'Session closed');
            }
        }
        await this.store.setSessionStatus(binding, 'closed');
        this.stopPoll(sessionId);
        this.sessions.delete(sessionId);
        await Promise.all([...this.plugins.values()].map(plugin => plugin.onSessionClosed?.(sessionId)));
        this.notify(sessionId);
    }

    onChanged(listener: (event: KernelEvents['changed']) => void): () => void {
        return this.eventsBus.on('changed', listener);
    }

    private async resolveStorage(reference: StorageBindingRef): Promise<ResolvedStorageBinding> {
        return this.storageResolvers.resolve(reference.kind).resolve(reference);
    }

    private async binding(sessionId: string): Promise<ResolvedStorageBinding> {
        const cached = this.sessions.get(sessionId);
        if (cached) return cached;
        const opened = await this.store.openSession(sessionId);
        this.sessions.set(sessionId, opened.binding);
        return opened.binding;
    }

    private queueDrain(sessionId: string): void {
        if (this.disposed || this.draining.has(sessionId)) return;
        this.draining.add(sessionId);
        queueMicrotask(() => void this.drain(sessionId));
    }

    private schedulePoll(sessionId: string): void {
        this.poller.start(sessionId);
    }

    private stopPoll(sessionId: string): void { this.poller.stop(sessionId); }

    private async poll(sessionId: string): Promise<boolean> {
        const binding = await this.binding(sessionId);
        const status = (await this.store.sessionRecord(binding)).status;
        if (status === 'open') {
            this.queueDrain(sessionId);
            await this.dispatchPendingEffects(binding);
        }
        return status !== 'closed' && status !== 'archived';
    }

    private handlePollError(error: unknown): boolean {
        if (isMissingPath(error)) return false;
        console.error('Kernel poll failed', error);
        return true;
    }

    private async drain(sessionId: string): Promise<void> {
        try {
            const binding = await this.binding(sessionId);
            if ((await this.store.sessionRecord(binding)).status !== 'open') return;
            while (this.active < this.maxConcurrent) {
                const claim = await this.store.claimReady(binding, this.workerId, this.leaseMs);
                if (!claim) break;
                this.active++;
                void this.execute(binding, claim).finally(() => {
                    this.active--;
                    this.queueDrain(sessionId);
                });
            }
        } finally {
            this.draining.delete(sessionId);
        }
    }

    private async execute(binding: ResolvedStorageBinding, claim: TaskClaim): Promise<void> {
        const stopHeartbeat = this.startLeaseHeartbeat(binding, claim);
        try {
            const program = this.programs.resolve(claim.task.program.kind, claim.task.program.version);
            const decision = await nextDecision(program, claim.task);
            if (this.disposed) {
                await this.store.abandonClaim(binding, claim.task.id);
                return;
            }
            const next = await this.applyDecision(binding, claim, decision);
            this.notify(next.sessionId, next.id);
            if (next.status === 'ready') this.queueDrain(next.sessionId);
        } catch (error) {
            if (this.disposed) {
                await this.store.abandonClaim(binding, claim.task.id).catch(() => {});
                return;
            }
            const failed = failureDecision(claim.task.state, error);
            try {
                const next = await this.applyDecision(binding, claim, failed);
                if (next.status === 'ready') this.queueDrain(next.sessionId);
            } catch { /* A newer lease owns the task. */ }
            this.notify(claim.task.sessionId, claim.task.id);
        } finally {
            stopHeartbeat();
        }
    }

    private startLeaseHeartbeat(binding: ResolvedStorageBinding, claim: TaskClaim): () => void {
        const heartbeat = new LeaseHeartbeat({
            intervalMs: Math.max(1, Math.floor(this.leaseMs / 3)),
            renew: () => this.disposed
                ? Promise.resolve(false)
                : this.store.renewLease(binding, claim, this.leaseMs),
            onError: error => console.error('Kernel lease heartbeat failed', error),
        });
        const stop = (): void => {
            heartbeat.stop();
            this.heartbeats.delete(heartbeat);
        };
        this.heartbeats.add(heartbeat);
        heartbeat.start();
        return stop;
    }

    private async applyDecision(
        binding: ResolvedStorageBinding,
        claim: TaskClaim,
        decision: Decision,
    ): Promise<TaskRecord> {
        validateDecision(decision);
        const retrying = shouldRetry(claim.task, decision);
        const pendingEvents = claim.task.state === undefined || retrying
            ? claim.task.pendingEvents
            : claim.task.pendingEvents.slice(1);
        const state = retrying ? claim.task.state : decision.state;
        let next: TaskRecord = { ...claim.task, state, pendingEvents };
        const actions = decision.actions ?? [];
        for (const action of actions) {
            if (action.type === 'request-interaction') next = addInteraction(next, action.interaction);
        }
        const spawns = prepareSpawns(actions);
        await Promise.all(spawns.map(spawn => this.store.prepareTaskDirectory(binding, spawn.id)));
        const effects = actions.filter(action => action.type === 'effect')
            .map(action => normalizeEffect(action.effect));
        for (const effect of effects) next = addEffect(next, effect);
        next = transition(next, decision);
        const sideEffects = decisionSideEffects(actions, spawns);
        if (retrying) sideEffects.attemptOutcome = 'failed';
        const eventType = retrying ? 'task.retry.scheduled' : `task.${next.status}`;
        const payload = retrying ? { error: next.lastError, readyAt: next.readyAt } : undefined;
        const committed = await this.store.commitTask(binding, claim, next, eventType, payload, sideEffects);
        for (const effect of effects) void this.dispatchEffect(binding, committed, effect.id);
        if (decision.next.type === 'continue' || spawns.length > 0) this.queueDrain(next.sessionId);
        return committed;
    }

    private async dispatchPendingEffects(binding: ResolvedStorageBinding): Promise<void> {
        for (const pending of await this.store.pendingEffects(binding)) {
            void this.dispatchEffect(binding, pending.task, pending.effectId);
        }
    }

    private async dispatchEffect(
        binding: ResolvedStorageBinding,
        task: TaskRecord,
        effectId: string,
    ): Promise<void> {
        const claim = await this.store.claimEffect(binding, task.id, effectId, this.workerId, this.leaseMs);
        if (!claim) return;
        await this.executeEffect(binding, task, claim);
    }

    private async executeEffect(
        binding: ResolvedStorageBinding,
        task: TaskRecord,
        claim: EffectClaim,
    ): Promise<void> {
        const effect = claim.effect.request as RequiredEffect;
        const controller = new AbortController();
        const controllerKey = effectControllerKey(task.sessionId, task.id, effect.id);
        this.effectControllers.set(controllerKey, controller);
        const stopHeartbeat = this.startEffectHeartbeat(binding, claim);
        try {
            const grants: import('../domain/types').AuthorizedEffectGrant[] = [];
            for (const grant of effect.grants ?? []) {
                const resource = await this.store.authorizeResource(
                    binding, grant.handleId, grant.right, task.id,
                );
                grants.push({ ...grant, resource });
            }
            const adapter = this.effects.resolve(effect.kind, effect.version);
            const context = {
                sessionId: task.sessionId, taskId: task.id, effectId: effect.id,
                abortSignal: controller.signal, grants,
                sessionState: {
                    get: <T extends import('../domain/types').JsonValue>(key: string) =>
                        this.store.getShared<T>(binding, key),
                    set: <T extends import('../domain/types').JsonValue>(
                        key: string, value: T, expectedVersion?: number | null,
                    ) => this.store.setShared(binding, key, value, {
                        taskId: task.id, expectedVersion,
                    }),
                },
                emit: async (event: { type: string; payload?: unknown }): Promise<void> => {
                    if (this.disposed) return;
                    await this.store.appendEvent(binding, task.sessionId, task.id, event.type, event.payload);
                    this.notify(task.sessionId, task.id);
                },
                chargeBudget: (handleId: string, dimension: string, amount: number) =>
                    this.chargeBudget(task.sessionId, handleId, dimension, amount),
            };
            const result = await executeEffectWithDeadline(adapter, effect, claim, context, controller);
            if ('result' in result) assertDurableValue(result.result, 'Effect result');
            await this.store.completeEffect(
                binding, task.id, effect.id, claim.effect.currentAttempt!.leaseToken, result,
            );
        } catch (error) {
            if (this.disposed) return;
            try {
                await this.store.completeEffect(binding, task.id, effect.id,
                    claim.effect.currentAttempt!.leaseToken, effectFailure(error));
            } catch { /* Effect lease was recovered by another worker. */ }
        } finally {
            stopHeartbeat();
            this.effectControllers.delete(controllerKey);
            this.notify(task.sessionId, task.id);
            this.queueDrain(task.sessionId);
        }
    }

    private async cancelTaskEffects(task: TaskRecord, active: Set<string>): Promise<void> {
        const effects = Object.entries(task.effects)
            .filter(([id, effect]) => active.has(id) && effect.status === 'cancelled')
            .map(([, effect]) => effect);
        const results = await Promise.allSettled(effects.map(effect => this.cancelEffect(task, effect.request)));
        const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (errors.length > 0) throw new AggregateError(errors, `Failed to cancel effects for task ${task.id}`);
    }

    private async cancelEffect(task: TaskRecord, effect: EffectRequest): Promise<void> {
        if (!effect.id) return;
        const key = effectControllerKey(task.sessionId, task.id, effect.id);
        const controller = this.effectControllers.get(key);
        controller?.abort();
        const adapter = this.effects.resolve(effect.kind, effect.version);
        if (!adapter.cancel) return;
        await adapter.cancel(effect.request, {
            sessionId: task.sessionId, taskId: task.id, effectId: effect.id,
            abortSignal: controller?.signal ?? AbortSignal.abort(),
            grants: [],
            // Cancel path has no storage binding; effect adapters must not emit.
            emit: async () => {},
        });
    }

    private startEffectHeartbeat(binding: ResolvedStorageBinding, claim: EffectClaim): () => void {
        const heartbeat = new LeaseHeartbeat({
            intervalMs: Math.max(1, Math.floor(this.leaseMs / 3)),
            renew: () => this.disposed
                ? Promise.resolve(false)
                : this.store.renewEffectLease(binding, claim, this.leaseMs),
            onError: error => console.error('Kernel effect heartbeat failed', error),
        });
        const stop = (): void => { heartbeat.stop(); this.heartbeats.delete(heartbeat); };
        this.heartbeats.add(heartbeat);
        heartbeat.start();
        return stop;
    }

    private notify(sessionId: string, taskId?: string): void {
        this.eventsBus.emit('changed', { sessionId, taskId });
    }
}
