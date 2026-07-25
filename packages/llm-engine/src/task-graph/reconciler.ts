import type {
    ScopedTaskServices,
    TaskEffect,
    TaskGraphEvent,
    TaskGraphEventEnvelope,
    TaskGraphRun,
    TaskGraphRunId,
    TaskResult,
    TaskRun,
    TaskRunId,
    TaskRunStatus,
    Artifact,
    HumanRequest,
    RoundId,
    ArtifactStore,
    ContextSnapshotStore,
    TaskGraphRunStore,
    TaskGraphEventStore as TaskGraphEventStoreContract,
} from '@itookit/common';
import { ulid } from '../persistence/ulid';
import { DependencyScheduler } from './dependency-scheduler';
import { commitArtifact, inputDigest } from './runtime';
import { TaskExecutorRegistry } from './registry';
import { InMemoryArtifactStore, InMemoryContextSnapshotStore, InMemoryTaskGraphEventStore, InMemoryTaskGraphRunStore, AgentStateStore } from './stores';
import { asRecord } from './utils';
import { recoverTaskGraphRun } from './recovery';

export interface TaskGraphReconcilerOptions {
    runStore?: TaskGraphRunStore;
    eventStore?: TaskGraphEventStoreContract;
    artifactStore?: ArtifactStore;
    contextSnapshotStore?: ContextSnapshotStore;
    stateStore?: AgentStateStore;
    executorRegistry: TaskExecutorRegistry;
    maxConcurrent?: number;
    services?: Partial<Omit<ScopedTaskServices, 'artifacts' | 'clock' | 'signal'>>;
    onHumanRequest?: (request: HumanRequest, taskRunId: TaskRunId) => Promise<void> | void;
    commitRound?: (taskRunId: TaskRunId, draft: import('@itookit/common').RoundDraftV3) => Promise<RoundId>;
    memoryWrite?: (write: import('@itookit/common').MemoryWrite, taskRunId: TaskRunId) => Promise<void>;
    prepareAgentContext?: (task: TaskRun, inputs: Awaited<ReturnType<TaskGraphReconciler['resolveInputs']>>) => Promise<{ snapshot: import('@itookit/common').ContextSnapshot; state?: import('@itookit/common').AgentStateRevision }>;
}

export interface TaskGraphReconcileResult {
    graphRun: TaskGraphRun;
    taskStatuses: Record<string, TaskRunStatus>;
    interruptedTaskRunIds: TaskRunId[];
}

/**
 * Single control-plane writer. Executors receive scoped services and return
 * drafts/effects; they never receive a scheduler or graph store.
 */
export class TaskGraphReconciler {
    private readonly runStore: TaskGraphRunStore;
    private readonly eventStore: TaskGraphEventStoreContract;
    private readonly artifactStore: ArtifactStore;
    private readonly stateStore: AgentStateStore;
    private readonly contextSnapshotStore: ContextSnapshotStore;
    private agentContextProvider?: TaskGraphReconcilerOptions['prepareAgentContext'];
    private roundCommitter?: TaskGraphReconcilerOptions['commitRound'];
    private readonly locks = new Set<string>();
    private readonly humanRequests = new Map<string, HumanRequest>();
    private readonly taskControllers = new Map<string, AbortController>();
    private controlTail: Promise<void> = Promise.resolve();
    private eventTail: Promise<void> = Promise.resolve();

    constructor(private readonly options: TaskGraphReconcilerOptions) {
        this.runStore = options.runStore ?? new InMemoryTaskGraphRunStore(handler => options.executorRegistry.resolve(handler));
        this.eventStore = options.eventStore ?? new InMemoryTaskGraphEventStore();
        this.artifactStore = options.artifactStore ?? new InMemoryArtifactStore();
        this.stateStore = options.stateStore ?? new AgentStateStore();
        this.contextSnapshotStore = options.contextSnapshotStore ?? new InMemoryContextSnapshotStore();
        this.agentContextProvider = options.prepareAgentContext;
        this.roundCommitter = options.commitRound;
    }

    setAgentContextProvider(provider: TaskGraphReconcilerOptions['prepareAgentContext']): void { this.agentContextProvider = provider; }
    setRoundCommitter(committer: TaskGraphReconcilerOptions['commitRound']): void { this.roundCommitter = committer; }

    get stores(): { runStore: TaskGraphRunStore; eventStore: TaskGraphEventStoreContract; artifactStore: ArtifactStore; contextSnapshotStore: ContextSnapshotStore; stateStore: AgentStateStore } {
        return { runStore: this.runStore, eventStore: this.eventStore, artifactStore: this.artifactStore, contextSnapshotStore: this.contextSnapshotStore, stateStore: this.stateStore };
    }

    async run(
        graph: TaskGraphRun,
        options: {
            signal?: AbortSignal;
            onCreated?: (graph: TaskGraphRun) => void | Promise<void>;
        } = {},
    ): Promise<TaskGraphReconcileResult> {
        await this.runStore.save(graph);
        await this.record(graph.id, { type: 'GraphRunCreated', flow: graph.flow, limits: graph.limits });
        for (const task of Object.values(graph.tasks ?? {})) {
            await this.record(graph.id, { type: 'TaskRunCreated', task: task.spec }, task.id);
        }
        await options.onCreated?.(graph);
        return this.resume(graph.id, options);
    }

    async resume(graphRunId: TaskGraphRunId, options: { signal?: AbortSignal } = {}): Promise<TaskGraphReconcileResult> {
        const persisted = await this.runStore.get(graphRunId);
        if (!persisted) throw new Error(`TaskGraphRun not found: ${graphRunId}`);
        const recovery = persisted.status === 'running' ? recoverTaskGraphRun(persisted) : { run: persisted, interruptedTaskRunIds: [] as TaskRunId[] };
        const run = recovery.run;
        if (recovery.interruptedTaskRunIds.length) await this.runStore.save(run);
        const scheduler = new DependencyScheduler(run);
        const signal = options.signal ?? new AbortController().signal;
        const running = new Map<string, Promise<void>>();
        const interrupted: TaskRunId[] = [];
        run.status = 'running';
        await this.sync(run, scheduler);

        const execute = async (taskRunId: TaskRunId): Promise<void> => {
            const task = scheduler.getTask(taskRunId);
            const lock = task.spec.resourcePolicy?.concurrencyKey;
            if (lock) this.locks.add(lock);
            try { await this.executeTask(run, scheduler, task, signal); }
            finally { if (lock) this.locks.delete(lock); }
        };

        while (!scheduler.finished()) {
            if (signal.aborted) {
                for (const id of scheduler.readyIds()) { scheduler.cancel(id); interrupted.push(id); }
                for (const id of running.keys()) { scheduler.cancel(id as unknown as TaskRunId); interrupted.push(id as unknown as TaskRunId); }
            }
            const capacity = Math.min(run.limits.maxConcurrentTasks, this.options.maxConcurrent ?? run.limits.maxConcurrentTasks);
            for (const id of scheduler.readyIds()) {
                if (running.size >= capacity) break;
                const task = scheduler.getTask(id);
                const key = task.spec.resourcePolicy?.concurrencyKey;
                if (key && this.locks.has(key)) continue;
                scheduler.cancelRemainingForJoin(id);
                scheduler.start(id);
                await this.sync(run, scheduler);
                await this.record(run.id, { type: 'TaskRunReady', taskRunId: id }, id);
                const promise = execute(id).finally(() => running.delete(String(id)));
                running.set(String(id), promise);
            }
            if (!running.size) {
                if (scheduler.finished()) break;
                const hasAwaiting = Object.values(scheduler.snapshot().tasks).some(status => status === 'awaiting_signal');
                if (hasAwaiting) { run.status = 'paused'; await this.sync(run, scheduler); break; }
                if (signal.aborted) break;
                throw new Error('TaskGraph scheduler deadlock');
            }
            await Promise.race([...running.values()].map(promise => promise.catch(() => undefined)));
        }
        await Promise.allSettled(running.values());
        if (scheduler.finished()) {
            const statuses = Object.values(scheduler.snapshot().tasks);
            run.status = statuses.some(status => status === 'failed' || status === 'interrupted') ? 'failed'
                : statuses.every(status => status === 'cancelled' || status === 'skipped') ? 'cancelled' : 'succeeded';
            run.completedAt = Date.now();
            await this.record(run.id, { type: 'GraphRunSettled', status: run.status });
        }
        await this.sync(run, scheduler);
        return { graphRun: structuredClone(run), taskStatuses: scheduler.snapshot().tasks, interruptedTaskRunIds: [...new Set(interrupted)] };
    }

    async respond(graphRunId: TaskGraphRunId, taskRunId: TaskRunId, response: unknown, options: { signal?: AbortSignal } = {}): Promise<TaskGraphReconcileResult> {
        const run = await this.runStore.get(graphRunId);
        if (!run) throw new Error(`TaskGraphRun not found: ${graphRunId}`);
        const task = run.tasks?.[taskRunId];
        if (!task || task.status !== 'awaiting_signal') throw new Error(`TaskRun is not awaiting a signal: ${taskRunId}`);
        task.spec.explicitInputs = [...task.spec.explicitInputs, { kind: 'text', content: JSON.stringify(response), label: 'human-response', order: task.spec.explicitInputs.length }];
        task.status = 'pending';
        this.humanRequests.delete(`${String(graphRunId)}:${String(taskRunId)}`);
        await this.runStore.save(run);
        await this.record(graphRunId, { type: 'TaskRunReady', taskRunId }, taskRunId);
        return this.resume(graphRunId, options);
    }

    async retryTask(graphRunId: TaskGraphRunId, taskRunId: TaskRunId, options: { signal?: AbortSignal } = {}): Promise<TaskGraphReconcileResult> {
        const run = await this.runStore.get(graphRunId);
        if (!run) throw new Error(`TaskGraphRun not found: ${graphRunId}`);
        const task = run.tasks?.[taskRunId];
        if (!task || !['failed', 'interrupted', 'cancelled'].includes(task.status)) throw new Error(`TaskRun cannot be retried: ${taskRunId}`);
        task.status = 'pending';
        for (const edge of run.edges ?? []) {
            if (String(edge.from) === String(taskRunId) && run.edgeStates?.[edge.id]?.state === 'failed') run.edgeStates[edge.id].state = 'pending';
        }
        await this.runStore.save(run);
        await this.record(graphRunId, { type: 'TaskRunReady', taskRunId }, taskRunId);
        return this.resume(graphRunId, options);
    }

    async cancelTask(graphRunId: TaskGraphRunId, taskRunId: TaskRunId): Promise<TaskGraphReconcileResult> {
        const active = this.taskControllers.get(`${String(graphRunId)}:${String(taskRunId)}`);
        if (active) {
            active.abort();
            const run = await this.runStore.get(graphRunId);
            if (!run) throw new Error(`TaskGraphRun not found: ${graphRunId}`);
            return { graphRun: run, taskStatuses: Object.fromEntries(Object.values(run.tasks ?? {}).map(task => [String(task.id), task.status])), interruptedTaskRunIds: [] };
        }
        const run = await this.runStore.get(graphRunId);
        if (!run) throw new Error(`TaskGraphRun not found: ${graphRunId}`);
        const task = run.tasks?.[taskRunId];
        if (!task || ['succeeded', 'failed', 'cancelled', 'skipped'].includes(task.status)) {
            return { graphRun: run, taskStatuses: Object.fromEntries(Object.values(run.tasks ?? {}).map(item => [String(item.id), item.status])), interruptedTaskRunIds: [] };
        }
        const scheduler = new DependencyScheduler(run);
        scheduler.cancel(taskRunId);
        await this.sync(run, scheduler);
        await this.record(graphRunId, { type: 'TaskRunSettled', status: 'cancelled' }, taskRunId);
        return { graphRun: structuredClone(run), taskStatuses: scheduler.snapshot().tasks, interruptedTaskRunIds: [] };
    }

    private async executeTask(run: TaskGraphRun, scheduler: DependencyScheduler, task: TaskRun, signal: AbortSignal): Promise<void> {
        const maxAttempts = task.spec.retryPolicy.maxAttempts;
        const firstAttempt = task.attempts.length + 1;
        const lastAttempt = firstAttempt + maxAttempts - 1;
        for (let number = firstAttempt; number <= lastAttempt; number++) {
            if (signal.aborted) { scheduler.cancel(task.id); return; }
            let resolved: Awaited<ReturnType<TaskGraphReconciler['resolveInputs']>> = [];
            let digestValue = 'unresolved-inputs';
            let inputError: unknown;
            try {
                resolved = await this.resolveInputs(scheduler, task.id);
                digestValue = inputDigest({ inputs: resolved, explicitInputs: task.spec.explicitInputs });
            } catch (error) {
                inputError = error;
            }
            const attempt: TaskRun['attempts'][number] = {
                id: ulid() as import('@itookit/common').TaskAttemptId,
                number,
                status: 'running' as const,
                startedAt: Date.now(),
                inputDigest: digestValue,
            };
            const mutable = run.tasks?.[task.id];
            if (!mutable) throw new Error(`TaskRun not found in graph projection: ${task.id}`);
            mutable.inputDigest = digestValue;
            mutable.attempts.push(attempt);
            await this.record(run.id, { type: 'TaskAttemptStarted', attempt }, task.id, attempt.id);
            try {
                if (inputError) throw inputError;
                const executor = this.options.executorRegistry.resolve(task.spec.handler);
                const taskController = new AbortController();
                const controllerKey = `${String(run.id)}:${String(task.id)}`;
                this.taskControllers.set(controllerKey, taskController);
                const abortTask = () => taskController.abort();
                signal.addEventListener('abort', abortTask, { once: true });
                const timeoutMs = task.spec.resourcePolicy?.timeoutMs;
                let timer: ReturnType<typeof setTimeout> | undefined;
                if (timeoutMs !== undefined) timer = setTimeout(() => taskController.abort(), timeoutMs);
                const context = this.createContext(run, task, attempt, resolved, taskController.signal);
                if (task.spec.handler.kind === 'agent') {
                    const prepared = await this.agentContextProvider?.(task, resolved);
                    if (prepared) {
                        await this.contextSnapshotStore.save(prepared.snapshot);
                        context.contextSnapshot = prepared.snapshot;
                        context.stateRevision = prepared.state;
                        const config = asRecord(task.spec.config).agent as Record<string, unknown> | undefined;
                        if (config?.id && config.version) {
                            const mutableTask = run.tasks?.[task.id];
                            if (mutableTask) mutableTask.agent = {
                                definition: { id: config.id as never, version: String(config.version) },
                                state: prepared.state ? { namespace: prepared.state.namespace, revision: prepared.state.revision, digest: prepared.state.digest } : undefined,
                                contextSnapshotId: prepared.snapshot.id,
                                exchangeCount: 0,
                            };
                        }
                    }
                }
                const execution = executor.execute(context);
                const result = timeoutMs === undefined ? await execution : await Promise.race([
                    execution,
                    new Promise<TaskResult>((_resolve, reject) => setTimeout(() => reject(new Error(`TaskRun timed out after ${timeoutMs}ms`)), timeoutMs)),
                ]);
                if (signal.aborted) throw new Error('Aborted');
                if (taskController.signal.aborted) throw new Error(`TaskRun timed out after ${timeoutMs ?? 0}ms`);
                if (timer) clearTimeout(timer);
                signal.removeEventListener('abort', abortTask);
                this.taskControllers.delete(controllerKey);
                if (result.roundDraft && !['agent', 'human'].includes(task.spec.handler.kind)) {
                    throw new Error(`Only AgentTask/HumanTask may create a Round`);
                }
                if (result.agentExecution && task.spec.handler.kind !== 'agent') {
                    throw new Error(`Only AgentTask may have AgentExecutionRecord`);
                }
                this.validateResult(task, result);
                if (result.roundDraft && this.roundCommitter) {
                    const roundId = await this.roundCommitter(task.id, result.roundDraft);
                    const mutableExecution = result.agentExecution;
                    if (mutableExecution && !mutableExecution.finalRoundId) mutableExecution.finalRoundId = roundId;
                }
                const artifacts = await this.commitArtifacts(run.id, task.id, result);
                for (const artifact of artifacts) {
                    await this.record(run.id, {
                        type: 'ArtifactCommitted',
                        artifact: { id: artifact.id as never, taskRunId: task.id, outputName: artifact.outputName ?? 'final', contentHash: artifact.contentHash },
                    }, task.id, attempt.id);
                }
                const outcome = { status: 'succeeded' as const, artifacts };
                let awaitingSignal = false;
                await this.withControl(async () => {
                    awaitingSignal = await this.applyEffects(run, scheduler, task, result.effects ?? [], signal);
                    if (result.agentExecution) {
                        const mutableTask = run.tasks?.[task.id];
                        if (mutableTask) mutableTask.agent = structuredClone(result.agentExecution);
                    }
                    if (awaitingSignal) {
                        // A human response ends this executor invocation. The
                        // next invocation receives a fresh Attempt; the old
                        // Attempt remains append-only and is never reused.
                        attempt.status = 'cancelled';
                        attempt.completedAt = Date.now();
                        attempt.error = { message: 'Waiting for human response', code: 'AWAITING_SIGNAL' };
                        await this.record(run.id, { type: 'TaskAttemptFinished', outcome: { status: 'cancelled', error: attempt.error } }, task.id, attempt.id);
                        await this.sync(run, scheduler);
                        return;
                    }
                    attempt.status = 'succeeded';
                    attempt.completedAt = Date.now();
                    scheduler.settle(task.id, outcome);
                    await this.record(run.id, { type: 'TaskAttemptFinished', outcome }, task.id, attempt.id);
                    await this.record(run.id, { type: 'TaskRunSettled', status: 'succeeded' }, task.id, attempt.id);
                    await this.sync(run, scheduler);
                });
                if (awaitingSignal) return;
                return;
            } catch (error) {
                this.taskControllers.delete(`${String(run.id)}:${String(task.id)}`);
                const serialized = serialize(error);
                attempt.status = signal.aborted ? 'cancelled' : 'failed';
                attempt.completedAt = Date.now();
                attempt.error = serialized;
                const outcome = { status: signal.aborted ? 'cancelled' as const : 'failed' as const, error: serialized };
                await this.record(run.id, { type: 'TaskAttemptFinished', outcome }, task.id, attempt.id);
                if (!signal.aborted && number < lastAttempt && this.canRetry(task, serialized)) {
                    await this.withControl(async () => { scheduler.retry(task.id); await this.sync(run, scheduler); });
                    await delay(backoff(task, number), signal);
                    continue;
                }
                await this.withControl(async () => {
                    scheduler.settle(task.id, outcome);
                    await this.record(run.id, { type: 'TaskRunSettled', status: outcome.status }, task.id, attempt.id);
                    await this.sync(run, scheduler);
                });
                return;
            }
        }
    }

    private async applyEffects(run: TaskGraphRun, scheduler: DependencyScheduler, task: TaskRun, effects: TaskEffect[], signal: AbortSignal): Promise<boolean> {
        let awaitingSignal = false;
        for (const effect of effects) {
            if (effect.kind === 'await-human') {
                scheduler.awaitSignal(task.id);
                awaitingSignal = true;
                this.humanRequests.set(`${String(run.id)}:${String(task.id)}`, effect.request);
                await this.record(run.id, { type: 'TaskAwaitingSignal', request: effect.request }, task.id);
                await this.options.onHumanRequest?.(effect.request, task.id);
            } else if (effect.kind === 'route') {
                // Route decision is applied only after the effect validates; the
                // settle below then makes the selected data edges satisfiable.
                scheduler.decideEdges(effect.decision, task.id);
                await this.record(run.id, { type: 'EdgesDecided', decision: effect.decision }, task.id);
            } else if (effect.kind === 'agent-state-patch') {
                if (task.spec.handler.kind !== 'agent') throw new Error('Only AgentTask may write AgentState');
                const statePolicy = asRecord(asRecord(task.spec.config).statePolicy) as { mode?: string; targetNamespace?: string; concurrencyKey?: string };
                if (!statePolicy.mode) throw new Error('AgentTask statePolicy must be explicit before a StatePatch can be applied');
                if (statePolicy.mode === 'stateless' || statePolicy.mode === 'read-snapshot') throw new Error(`AgentState write is forbidden by ${statePolicy.mode} policy`);
                const patch = statePolicy.mode === 'fork' && statePolicy.targetNamespace
                    ? { ...effect.patch, namespace: statePolicy.targetNamespace, baseRevision: 0 }
                    : effect.patch;
                const commit = () => this.stateStore.commit(patch, task.id);
                const revision = statePolicy.mode === 'exclusive-update' && statePolicy.concurrencyKey
                    ? await this.stateStore.withExclusive(statePolicy.concurrencyKey, commit)
                    : await commit();
                await this.record(run.id, { type: 'AgentStatePatchCommitted', revision: { id: revision.id, namespace: revision.namespace, revision: revision.revision, digest: revision.digest } }, task.id);
            } else if (effect.kind === 'memory-write') {
                if (!this.options.memoryWrite) throw new Error('Memory write service is not configured');
                await this.options.memoryWrite(effect.write, task.id);
            } else if (effect.kind === 'spawn') {
                if (signal.aborted) throw new Error('Spawn cancelled');
                const expanded = await this.runStore.applyExpansion(run.id, run.graphVersion, effect.plan);
                const updated = await this.runStore.get(run.id);
                if (!updated) throw new Error(`TaskGraphRun disappeared during expansion: ${run.id}`);
                const oldTaskIds = new Set(Object.keys(run.tasks ?? {}));
                const oldEdgeIds = new Set((run.edges ?? []).map(edge => String(edge.id)));
                run.graphVersion = updated.graphVersion;
                run.tasks = updated.tasks;
                run.edges = updated.edges;
                run.edgeStates = updated.edgeStates;
                scheduler.applyGraphDelta({
                    tasks: Object.values(updated.tasks ?? {}).filter(candidate => !oldTaskIds.has(String(candidate.id))),
                    edges: (updated.edges ?? []).filter(edge => !oldEdgeIds.has(String(edge.id))),
                });
                await this.record(run.id, { type: 'GraphExpanded', expansion: expanded }, task.id);
            }
        }
        return awaitingSignal;
    }

    private async withControl<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.controlTail;
        let release!: () => void;
        const current = new Promise<void>(resolve => { release = resolve; });
        this.controlTail = previous.then(() => current);
        await previous;
        try { return await operation(); } finally { release(); }
    }

    private createContext(run: TaskGraphRun, task: TaskRun, attempt: TaskRun['attempts'][number], inputs: Awaited<ReturnType<TaskGraphReconciler['resolveInputs']>>, signal: AbortSignal): import('@itookit/common').TaskExecutionContext {
        const services: ScopedTaskServices = {
            artifacts: { get: id => this.artifactStore.get(id), draft: draft => structuredClone(draft) },
            clock: { now: () => Date.now() },
            logger: this.options.services?.logger ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
            signal,
        };
        return { graphRunId: run.id, taskRunId: task.id, attempt, config: task.spec.config, inputs, signal, services };
    }

    private async resolveInputs(scheduler: DependencyScheduler, taskRunId: TaskRunId): Promise<ReturnType<DependencyScheduler['resolveInputs']>> {
        const task = scheduler.getTask(taskRunId);
        const ids = scheduler.snapshot().edges;
        const artifacts = new Map<string, Artifact>();
        for (const state of Object.values(ids)) for (const artifactId of state.artifactIds ?? []) {
            const artifact = await this.artifactStore.get(artifactId);
            if (artifact) artifacts.set(artifactId, artifact);
        }
        return scheduler.resolveInputs(task.id, artifacts);
    }

    private async commitArtifacts(graphRunId: TaskGraphRunId, taskRunId: TaskRunId, result: TaskResult): Promise<Artifact[]> {
        const artifacts: Artifact[] = [];
        for (const draft of result.artifacts) {
            const artifact = commitArtifact(taskRunId, draft, Date.now(), graphRunId);
            await this.artifactStore.save(artifact);
            artifacts.push(artifact);
        }
        return artifacts;
    }

    private validateResult(task: TaskRun, result: TaskResult): void {
        const outputNames = new Set(result.artifacts.map(artifact => artifact.outputName));
        for (const port of task.spec.outputPorts) {
            if (port.required && !outputNames.has(port.name)) throw new Error(`TaskRun ${task.id} did not produce required output ${port.name}`);
        }
        if (outputNames.size !== result.artifacts.length) throw new Error(`TaskRun ${task.id} produced duplicate output names`);
        for (const artifact of result.artifacts) {
            if (!artifact.outputName) throw new Error(`TaskRun ${task.id} produced an unnamed Artifact`);
        }
    }

    private canRetry(task: TaskRun, error?: import('@itookit/common').SerializedError): boolean {
        if (task.spec.resourcePolicy?.sideEffect === 'non-idempotent' && task.spec.retryPolicy.requireConfirmationForNonIdempotent) return false;
        const retryOn = task.spec.retryPolicy.retryOn;
        if (retryOn?.length && !retryOn.some(token => token === error?.code || token === 'Error' || (error?.message ?? '').includes(token))) return false;
        return true;
    }

    private async sync(run: TaskGraphRun, scheduler: DependencyScheduler): Promise<void> {
        const snapshot = scheduler.snapshot();
        run.tasks ??= {};
        for (const [id, status] of Object.entries(snapshot.tasks)) {
            const task = run.tasks[id as unknown as TaskRunId];
            if (task) task.status = status;
        }
        run.edgeStates ??= {};
        for (const [id, state] of Object.entries(snapshot.edges)) {
            const edge = run.edges?.find(item => String(item.id) === id);
            if (!edge) continue;
            run.edgeStates[id as never] = { edgeId: edge.id as never, graphRunId: run.id, state: state.state as never, artifactIds: state.artifactIds as never, reason: state.reason, updatedAt: Date.now() };
        }
        await this.runStore.save(run);
        if (this.eventStore.saveSnapshot) {
            await this.eventStore.saveSnapshot(run.id, await this.eventStore.latestSequence(run.id), run);
        }
    }

    private async record(graphRunId: TaskGraphRunId, event: TaskGraphEvent, taskRunId?: TaskRunId, attemptId?: import('@itookit/common').TaskAttemptId): Promise<void> {
        const previous = this.eventTail;
        let release!: () => void;
        const current = new Promise<void>(resolve => { release = resolve; });
        this.eventTail = previous.then(() => current);
        await previous;
        try {
            const sequence = await this.eventStore.latestSequence(graphRunId);
            const envelope: TaskGraphEventEnvelope = { sequence: 0, eventId: ulid(), occurredAt: Date.now(), graphRunId, taskRunId, attemptId, event };
            await this.eventStore.append(envelope, sequence);
        } finally {
            release();
        }
    }
}

function serialize(error: unknown): import('@itookit/common').SerializedError {
    if (error instanceof Error) return { message: error.message, stack: error.stack };
    return { message: String(error) };
}

function backoff(task: TaskRun, attempt: number): number {
    const policy = task.spec.retryPolicy.backoff;
    if (!policy || policy.kind === 'none') return 0;
    const base = policy.baseMs ?? 100;
    const value = policy.kind === 'fixed' ? base : base * (2 ** Math.max(0, attempt - 1));
    return Math.min(value, policy.maxMs ?? value);
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
    if (!ms) return;
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Aborted')); }, { once: true });
    });
}
