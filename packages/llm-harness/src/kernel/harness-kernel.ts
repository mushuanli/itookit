import type {
    ArtifactMap,
    ExecutionRun,
    HarnessControlPlane,
    ProcessHost,
    ProcessId,
    ProcessProgram,
    ProcessRecord,
    ProcessResourcePorts,
    ProcessSignal,
    RunEvent,
    RunEventEnvelope,
    RunEventStore,
    RunHandle,
    RunId,
    RunRequest,
    RunSnapshot,
    SchedulerContext,
    SchedulerModule,
    SchedulerRun,
    SchedulerTransition,
} from '@itookit/common';
import { ProcessDispatcher } from './dispatcher';
import { ProcessProgramRegistry } from './program-registry';
import { ProcessTable } from './process-table';
import { FifoSchedulingPolicy } from '../scheduling/fifo-policy';
import { DirectScheduler } from '../scheduling/direct/direct-scheduler';
import {
    InMemoryProcessCheckpointStore,
    InMemoryRunEventStore,
} from '../persistence/memory-stores';

export interface HarnessKernelOptions {
    resources: ProcessResourcePorts;
    maxConcurrent?: number;
    eventStore?: RunEventStore;
    checkpointStore?: import('@itookit/common').ProcessCheckpointStore;
}

export class HarnessKernel implements ProcessHost, HarnessControlPlane {
    private readonly runs = new Map<RunId, ExecutionRun>();
    private readonly schedulers = new Map<string, SchedulerModule>();
    private readonly schedulerRuns = new Map<RunId, SchedulerRun>();
    private readonly programs = new ProcessProgramRegistry();
    private readonly table = new ProcessTable();
    private readonly eventStore: RunEventStore;
    private readonly dispatcher: ProcessDispatcher;

    constructor(options: HarnessKernelOptions) {
        this.eventStore = options.eventStore ?? new InMemoryRunEventStore();
        this.dispatcher = new ProcessDispatcher({
            maxConcurrent: options.maxConcurrent ?? 4,
            resources: options.resources,
            programs: this.programs,
            table: this.table,
            policy: new FifoSchedulingPolicy(),
            checkpoints: options.checkpointStore ?? new InMemoryProcessCheckpointStore(),
            emit: (runId, processId, event) => this.emit(runId, event, processId),
            onChanged: record => this.onProcessChanged(record),
        });
        this.registerScheduler(new DirectScheduler());
    }

    registerProgram(program: ProcessProgram): void {
        this.programs.register(program);
    }

    hasProgram(kind: string): boolean {
        return this.programs.has(kind);
    }

    registerScheduler(scheduler: SchedulerModule): void {
        if (this.schedulers.has(scheduler.kind)) {
            throw new Error(`Scheduler already registered: ${scheduler.kind}`);
        }
        this.schedulers.set(scheduler.kind, scheduler);
    }

    async submit(request: RunRequest): Promise<RunHandle> {
        const scheduler = this.schedulers.get(request.scheduler);
        if (!scheduler) throw new Error(`Scheduler is not registered: ${request.scheduler}`);
        const run = this.createRun(request);
        this.runs.set(run.id, run);
        await this.emit(run.id, { type: 'run:created', run: clone(run) });
        const context = this.schedulerContext(run, request);
        const scheduled = await scheduler.start(request.spec, context);
        this.schedulerRuns.set(run.id, scheduled);
        this.updateRun(run.id, { processIds: [...scheduled.processIds] });
        await this.reconcileExistingProcesses(run.id, context);
        return new KernelRunHandle(this, run.id);
    }

    async attach(runId: RunId): Promise<RunHandle> {
        this.requireRun(runId);
        return new KernelRunHandle(this, runId);
    }

    setMaxConcurrent(value: number): void {
        this.dispatcher.setMaxConcurrent(value);
    }

    async signalRun(runId: RunId, signal: ProcessSignal): Promise<void> {
        await this.dispatcher.signalRun(runId, signal);
    }

    async cancelRun(runId: RunId): Promise<void> {
        await Promise.all(this.table.listByRun(runId).map(process => this.dispatcher.cancel(process.id)));
    }

    snapshotRun(runId: RunId): RunSnapshot {
        return {
            run: clone(this.requireRun(runId)),
            processes: this.table.listByRun(runId),
        };
    }

    eventStream(runId: RunId, fromSequence = 0): AsyncIterable<RunEventEnvelope> {
        this.requireRun(runId);
        return streamEvents(this.eventStore, runId, fromSequence);
    }

    private createRun(request: RunRequest): ExecutionRun {
        const id = createId('run');
        const parent = request.parentRunId ? this.runs.get(request.parentRunId) : undefined;
        return {
            id,
            ownerRoundId: request.ownerRoundId,
            parentRunId: request.parentRunId,
            rootRunId: parent?.rootRunId ?? id,
            kind: request.scheduler,
            status: 'created',
            input: { spec: clone(request.spec) },
            processIds: [],
            createdAt: Date.now(),
        };
    }

    private schedulerContext(run: ExecutionRun, request: RunRequest): SchedulerContext {
        return {
            runId: run.id,
            request,
            submitProcess: spec => this.dispatcher.submit(run.id, spec, run.ownerRoundId),
            getProcess: processId => this.table.get(processId) ?? undefined,
        };
    }

    private async onProcessChanged(process: ProcessRecord): Promise<void> {
        const run = this.requireRun(process.runId);
        const processIds = run.processIds.includes(process.id)
            ? run.processIds
            : [...run.processIds, process.id];
        this.updateRun(run.id, { processIds });
        const scheduled = this.schedulerRuns.get(run.id);
        if (!scheduled) return;
        await this.reconcileScheduler(scheduled, process, this.schedulerContext(run, {
            scheduler: run.kind,
            spec: run.input.spec,
            ownerRoundId: run.ownerRoundId,
            parentRunId: run.parentRunId,
        }));
    }

    private async reconcileExistingProcesses(
        runId: RunId,
        context: SchedulerContext,
    ): Promise<void> {
        const scheduled = this.schedulerRuns.get(runId);
        if (!scheduled) return;
        for (const process of this.table.listByRun(runId)) {
            await this.reconcileScheduler(scheduled, process, context);
        }
    }

    private async reconcileScheduler(
        scheduled: SchedulerRun,
        process: ProcessRecord,
        context: SchedulerContext,
    ): Promise<void> {
        const transition = await scheduled.onProcessChanged(process, context);
        await this.applySchedulerTransition(scheduled.runId, transition);
    }

    private async applySchedulerTransition(
        runId: RunId,
        transition: SchedulerTransition,
    ): Promise<void> {
        if (transition.type === 'completed') return this.completeRun(runId, transition.output);
        if (transition.type === 'failed') return this.failRun(runId, transition.error);
        if (transition.type === 'cancelled') return this.cancelledRun(runId);
        if (this.requireRun(runId).status !== transition.status) {
            await this.setRunStatus(runId, transition.status);
        }
    }

    private async completeRun(runId: RunId, output: ArtifactMap): Promise<void> {
        const run = this.requireRun(runId);
        if (run.completedAt) return;
        this.updateRun(runId, { status: 'completed', output, completedAt: Date.now() });
        await this.emit(runId, { type: 'run:status', status: 'completed' });
        await this.emit(runId, { type: 'run:completed', output });
    }

    private async failRun(
        runId: RunId,
        error: import('@itookit/common').ProcessError,
    ): Promise<void> {
        const run = this.requireRun(runId);
        if (run.completedAt) return;
        this.updateRun(runId, { status: 'failed', completedAt: Date.now() });
        await this.emit(runId, { type: 'run:status', status: 'failed' });
        await this.emit(runId, { type: 'run:failed', error });
    }

    private async cancelledRun(runId: RunId): Promise<void> {
        const run = this.requireRun(runId);
        if (run.completedAt) return;
        this.updateRun(runId, { status: 'cancelled', completedAt: Date.now() });
        await this.emit(runId, { type: 'run:status', status: 'cancelled' });
    }

    private async setRunStatus(
        runId: RunId,
        status: ExecutionRun['status'],
    ): Promise<void> {
        this.updateRun(runId, { status });
        await this.emit(runId, { type: 'run:status', status });
    }

    private updateRun(runId: RunId, patch: Partial<ExecutionRun>): void {
        const run = this.requireRun(runId);
        this.runs.set(runId, { ...run, ...clone(patch), id: run.id, rootRunId: run.rootRunId });
    }

    private requireRun(runId: RunId): ExecutionRun {
        const run = this.runs.get(runId);
        if (!run) throw new Error(`Run not found: ${runId}`);
        return run;
    }

    private async emit(
        runId: RunId,
        event: RunEvent,
        processId?: ProcessId,
    ): Promise<void> {
        await this.eventStore.append({
            runId,
            processId,
            occurredAt: Date.now(),
            event,
        });
    }
}

class KernelRunHandle implements RunHandle {
    constructor(
        private readonly kernel: HarnessKernel,
        readonly runId: RunId,
    ) {}

    events(fromSequence?: number): AsyncIterable<RunEventEnvelope> {
        return this.kernel.eventStream(this.runId, fromSequence);
    }

    signal(signal: ProcessSignal): Promise<void> {
        return this.kernel.signalRun(this.runId, signal);
    }

    cancel(): Promise<void> {
        return this.kernel.cancelRun(this.runId);
    }

    async snapshot(): Promise<RunSnapshot> {
        return this.kernel.snapshotRun(this.runId);
    }
}

async function* streamEvents(
    store: RunEventStore,
    runId: RunId,
    fromSequence: number,
): AsyncGenerator<RunEventEnvelope> {
    const queue = new AsyncEventQueue();
    const unsubscribe = store.subscribe(runId, event => queue.push(event));
    let sequence = fromSequence;
    try {
        for (const event of await store.after(runId, sequence)) {
            sequence = event.sequence;
            yield event;
            if (isTerminalEvent(event)) return;
        }
        while (true) {
            const event = await queue.next(sequence);
            sequence = event.sequence;
            yield event;
            if (isTerminalEvent(event)) return;
        }
    } finally {
        unsubscribe();
    }
}

class AsyncEventQueue {
    private readonly events: RunEventEnvelope[] = [];
    private resolve?: () => void;

    push(event: RunEventEnvelope): void {
        this.events.push(event);
        this.resolve?.();
        this.resolve = undefined;
    }

    async next(afterSequence: number): Promise<RunEventEnvelope> {
        while (true) {
            const event = this.events.find(item => item.sequence > afterSequence);
            if (event) return event;
            await new Promise<void>(resolve => { this.resolve = resolve; });
        }
    }
}

function isTerminalEvent(envelope: RunEventEnvelope): boolean {
    return envelope.event.type === 'run:completed'
        || envelope.event.type === 'run:failed'
        || (
            envelope.event.type === 'run:status'
            && envelope.event.status === 'cancelled'
        );
}

function createId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}
