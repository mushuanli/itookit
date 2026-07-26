import type {
    BudgetView,
    CapabilitySet,
    DirectRunSpec,
    ProcessCheckpoint,
    ProcessCheckpointStore,
    ProcessContext,
    ProcessEvent,
    ProcessId,
    ProcessRecord,
    ProcessResourcePorts,
    ProcessSignal,
    ProcessTransition,
    RunEvent,
    RunId,
    SchedulingPolicy,
} from '@itookit/common';
import { ProcessProgramRegistry } from './program-registry';
import { ProcessTable } from './process-table';

interface ProcessRuntimeConfig {
    capabilities: CapabilitySet;
    budget: BudgetView;
    pendingSignal?: ProcessSignal;
}

export interface ProcessDispatcherOptions {
    maxConcurrent: number;
    resources: ProcessResourcePorts;
    programs: ProcessProgramRegistry;
    table: ProcessTable;
    policy: SchedulingPolicy;
    checkpoints: ProcessCheckpointStore;
    emit(runId: RunId, processId: ProcessId, event: RunEvent): Promise<void>;
    onChanged(record: ProcessRecord): Promise<void>;
}

export class ProcessDispatcher {
    private readonly active = new Map<ProcessId, AbortController>();
    private readonly runtime = new Map<ProcessId, ProcessRuntimeConfig>();
    private readonly checkpointSequences = new Map<ProcessId, number>();
    private drainQueued = false;

    constructor(private readonly options: ProcessDispatcherOptions) {}

    async submit(
        runId: RunId,
        spec: DirectRunSpec,
        ownerRoundId?: string,
    ): Promise<ProcessId> {
        const program = this.options.programs.resolve(spec.programKind);
        const processId = spec.processId ?? createId('process');
        const state = await program.initialize(spec.input);
        const record = this.options.table.create(createRecord(processId, runId, spec, state, ownerRoundId));
        this.runtime.set(processId, createRuntime(spec));
        await this.options.emit(runId, processId, { type: 'process:created', process: record });
        await this.options.onChanged(record);
        this.queueDrain();
        return processId;
    }

    async signal(processId: ProcessId, signal: ProcessSignal): Promise<void> {
        const record = this.requireProcess(processId);
        if (record.status !== 'waiting') {
            throw new Error(`Process ${processId} is not waiting`);
        }
        const runtime = this.requireRuntime(processId);
        runtime.pendingSignal = signal;
        const ready = this.options.table.update(processId, { status: 'ready' });
        await this.emitStatus(ready);
        this.queueDrain();
    }

    async signalRun(runId: RunId, signal: ProcessSignal): Promise<void> {
        const waiting = this.options.table.listByRun(runId)
            .filter(process => process.status === 'waiting');
        const requestId = signalRequestId(signal);
        for (const process of waiting) {
            const checkpoint = await this.options.checkpoints.get(process.id);
            if (!requestId || checkpointRequestId(checkpoint) === requestId) {
                await this.signal(process.id, signal);
                return;
            }
        }
        throw new Error(`Run ${runId} has no matching waiting process`);
    }

    async cancel(processId: ProcessId): Promise<void> {
        const record = this.requireProcess(processId);
        if (isTerminal(record.status)) return;
        const controller = this.active.get(processId);
        if (controller) {
            controller.abort();
            return;
        }
        await this.options.checkpoints.delete(processId);
        this.clearRuntime(processId);
        const cancelled = this.options.table.update(processId, {
            status: 'cancelled',
            completedAt: Date.now(),
        });
        await this.emitStatus(cancelled);
    }

    setMaxConcurrent(value: number): void {
        if (!Number.isInteger(value) || value < 1) {
            throw new Error('maxConcurrent must be a positive integer');
        }
        this.options.maxConcurrent = value;
        this.queueDrain();
    }

    private queueDrain(): void {
        if (this.drainQueued) return;
        this.drainQueued = true;
        queueMicrotask(() => {
            this.drainQueued = false;
            this.drain();
        });
    }

    private drain(): void {
        const available = this.options.maxConcurrent - this.active.size;
        if (available <= 0) return;
        const selected = this.options.policy.select(
            this.options.table.listByStatus('ready'),
            { available, total: this.options.maxConcurrent },
        );
        for (const processId of selected) void this.run(processId);
    }

    private async run(processId: ProcessId): Promise<void> {
        const controller = new AbortController();
        this.active.set(processId, controller);
        const running = this.options.table.update(processId, {
            status: 'running',
            startedAt: this.requireProcess(processId).startedAt ?? Date.now(),
        });
        await this.emitStatus(running);
        try {
            const transition = await this.execute(running, controller.signal);
            await this.applyTransition(running, transition);
        } catch (error) {
            await this.fail(running, error, controller.signal.aborted);
        } finally {
            this.active.delete(processId);
            this.queueDrain();
        }
    }

    private async execute(
        record: ProcessRecord,
        abortSignal: AbortSignal,
    ): Promise<ProcessTransition<unknown, unknown>> {
        const program = this.options.programs.resolve(record.programKind);
        const runtime = this.requireRuntime(record.id);
        const context = createContext(record, runtime, this.options.resources, abortSignal);
        const generator = program.run(record.state, context, runtime.pendingSignal);
        runtime.pendingSignal = undefined;
        return consume(generator, event => this.emitProgramEvent(record, event));
    }

    private async emitProgramEvent(record: ProcessRecord, event: ProcessEvent): Promise<void> {
        await this.options.emit(record.runId, record.id, {
            type: 'process:event',
            event,
        });
    }

    private async applyTransition(
        record: ProcessRecord,
        transition: ProcessTransition<unknown, unknown>,
    ): Promise<void> {
        if (transition.type === 'completed') {
            await this.complete(record, transition.output);
            return;
        }
        if (transition.type === 'failed') {
            await this.fail(record, transition.error, false);
            return;
        }
        await this.checkpoint(record, transition);
    }

    private async checkpoint(
        record: ProcessRecord,
        transition: Extract<ProcessTransition<unknown, unknown>, { type: 'waiting' | 'yielded' }>,
    ): Promise<void> {
        const sequence = (this.checkpointSequences.get(record.id) ?? 0) + 1;
        this.checkpointSequences.set(record.id, sequence);
        const checkpoint = createCheckpoint(record, transition, sequence);
        await this.options.checkpoints.save(checkpoint);
        const status = transition.type === 'waiting' ? 'waiting' : 'ready';
        const updated = this.options.table.update(record.id, {
            state: transition.state,
            status,
        });
        await this.options.emit(record.runId, record.id, {
            type: 'process:checkpoint',
            checkpoint,
        });
        await this.emitStatus(updated);
    }

    private async complete(record: ProcessRecord, output: unknown): Promise<void> {
        await this.options.checkpoints.delete(record.id);
        this.clearRuntime(record.id);
        const completed = this.options.table.update(record.id, {
            status: 'completed',
            output,
            completedAt: Date.now(),
        });
        await this.emitStatus(completed);
    }

    private async fail(
        record: ProcessRecord,
        error: unknown,
        cancelled: boolean,
    ): Promise<void> {
        await this.options.checkpoints.delete(record.id);
        this.clearRuntime(record.id);
        const failed = this.options.table.update(record.id, {
            status: cancelled ? 'cancelled' : 'failed',
            error: cancelled ? undefined : serializeError(error),
            completedAt: Date.now(),
        });
        await this.emitStatus(failed);
    }

    private async emitStatus(record: ProcessRecord): Promise<void> {
        await this.options.emit(record.runId, record.id, {
            type: 'process:status',
            status: record.status,
        });
        await this.options.onChanged(record);
    }

    private requireProcess(processId: ProcessId): ProcessRecord {
        const record = this.options.table.get(processId);
        if (!record) throw new Error(`Process not found: ${processId}`);
        return record;
    }

    private requireRuntime(processId: ProcessId): ProcessRuntimeConfig {
        const runtime = this.runtime.get(processId);
        if (!runtime) throw new Error(`Process runtime config not found: ${processId}`);
        return runtime;
    }

    private clearRuntime(processId: ProcessId): void {
        this.runtime.delete(processId);
        this.checkpointSequences.delete(processId);
    }
}

async function consume(
    generator: AsyncGenerator<ProcessEvent, ProcessTransition<unknown, unknown>>,
    emit: (event: ProcessEvent) => Promise<void>,
): Promise<ProcessTransition<unknown, unknown>> {
    while (true) {
        const result = await generator.next();
        if (result.done) return result.value;
        await emit(result.value);
    }
}

function createRecord(
    id: ProcessId,
    runId: RunId,
    spec: DirectRunSpec,
    state: unknown,
    ownerRoundId?: string,
): ProcessRecord {
    return {
        id,
        runId,
        programKind: spec.programKind,
        status: 'ready',
        state,
        priority: spec.priority ?? 0,
        ownerRoundId,
        createdAt: Date.now(),
    };
}

function createRuntime(spec: DirectRunSpec): ProcessRuntimeConfig {
    return {
        capabilities: { ids: [...(spec.capabilities ?? [])] },
        budget: { limits: { ...(spec.budget ?? {}) }, usage: {} },
    };
}

function createContext(
    record: ProcessRecord,
    runtime: ProcessRuntimeConfig,
    resources: ProcessResourcePorts,
    abortSignal: AbortSignal,
): ProcessContext {
    return {
        processId: record.id,
        runId: record.runId,
        resources,
        capabilities: runtime.capabilities,
        budget: runtime.budget,
        abortSignal,
    };
}

function createCheckpoint(
    record: ProcessRecord,
    transition: Extract<ProcessTransition<unknown, unknown>, { type: 'waiting' | 'yielded' }>,
    sequence: number,
): ProcessCheckpoint {
    return {
        processId: record.id,
        runId: record.runId,
        programKind: record.programKind,
        state: transition.state,
        waitFor: transition.type === 'waiting' ? transition.waitFor : undefined,
        sequence,
        createdAt: Date.now(),
    };
}

function signalRequestId(signal: ProcessSignal): string | undefined {
    return signal.type === 'respond' || signal.type === 'authorize'
        ? signal.requestId
        : undefined;
}

function checkpointRequestId(checkpoint: ProcessCheckpoint | null): string | undefined {
    return checkpoint?.waitFor?.type === 'human-signal'
        ? checkpoint.waitFor.requestId
        : undefined;
}

function serializeError(error: unknown) {
    if (isProcessError(error)) return error;
    if (error instanceof Error) {
        return { message: error.message, code: error.name, stack: error.stack };
    }
    return { message: String(error) };
}

function isProcessError(error: unknown): error is import('@itookit/common').ProcessError {
    return Boolean(error)
        && typeof error === 'object'
        && typeof (error as { message?: unknown }).message === 'string';
}

function isTerminal(status: ProcessRecord['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function createId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
