import type {
    DirectRunSpec,
    SchedulerContext,
    SchedulerModule,
    SchedulerRun,
    SchedulerSnapshot,
} from '@itookit/common';

export class DirectScheduler implements SchedulerModule<DirectRunSpec> {
    readonly kind = 'direct';

    async start(
        spec: DirectRunSpec,
        context: SchedulerContext,
    ): Promise<SchedulerRun> {
        validate(spec);
        const processId = await context.submitProcess(spec);
        return new DirectSchedulerRun(context.runId, processId, spec);
    }

    async restore(
        snapshot: SchedulerSnapshot,
        context: SchedulerContext,
    ): Promise<SchedulerRun> {
        if (snapshot.kind !== this.kind) {
            throw new Error(`Cannot restore ${snapshot.kind} with DirectScheduler`);
        }
        const state = snapshot.state as DirectSchedulerSnapshot;
        validate(state.spec);
        if (!context.getProcess(state.processId)) {
            throw new Error(`Cannot restore missing process: ${state.processId}`);
        }
        return new DirectSchedulerRun(context.runId, state.processId, state.spec);
    }
}

class DirectSchedulerRun implements SchedulerRun {
    readonly processIds: readonly string[];

    constructor(
        readonly runId: string,
        private readonly processId: string,
        private readonly spec: DirectRunSpec,
    ) {
        this.processIds = [processId];
    }

    async onProcessChanged(
        process: import('@itookit/common').ProcessRecord,
    ): Promise<import('@itookit/common').SchedulerTransition> {
        if (process.id !== this.processId) {
            return { type: 'failed', error: { message: `Unknown process: ${process.id}` } };
        }
        if (process.status === 'completed') {
            return { type: 'completed', output: { result: structuredClone(process.output) } };
        }
        if (process.status === 'failed') {
            return { type: 'failed', error: process.error ?? { message: 'Process failed' } };
        }
        if (process.status === 'cancelled') return { type: 'cancelled' };
        if (process.status === 'waiting') return { type: 'status', status: 'waiting' };
        return {
            type: 'status',
            status: process.status === 'running' ? 'running' : 'ready',
        };
    }

    snapshot(): SchedulerSnapshot {
        return {
            kind: 'direct',
            runId: this.runId,
            state: {
                spec: structuredClone(this.spec),
                processId: this.processId,
            } satisfies DirectSchedulerSnapshot,
        };
    }
}

interface DirectSchedulerSnapshot {
    spec: DirectRunSpec;
    processId: string;
}

function validate(spec: DirectRunSpec): void {
    if (!spec || typeof spec !== 'object') throw new Error('Direct run spec is required');
    if (!spec.programKind) throw new Error('Direct run spec requires programKind');
}
