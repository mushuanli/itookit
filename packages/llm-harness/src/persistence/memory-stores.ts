import type {
    ProcessCheckpoint,
    ProcessCheckpointStore,
    ProcessId,
    RunEventEnvelope,
    RunEventStore,
    RunId,
} from '@itookit/common';

export class InMemoryProcessCheckpointStore implements ProcessCheckpointStore {
    private readonly checkpoints = new Map<ProcessId, ProcessCheckpoint>();

    async save(checkpoint: ProcessCheckpoint): Promise<void> {
        this.checkpoints.set(checkpoint.processId, structuredClone(checkpoint));
    }

    async get(processId: ProcessId): Promise<ProcessCheckpoint | null> {
        const checkpoint = this.checkpoints.get(processId);
        return checkpoint ? structuredClone(checkpoint) : null;
    }

    async delete(processId: ProcessId): Promise<void> {
        this.checkpoints.delete(processId);
    }
}

export class InMemoryRunEventStore implements RunEventStore {
    private readonly events = new Map<RunId, RunEventEnvelope[]>();
    private readonly listeners = new Map<
        RunId,
        Set<(event: RunEventEnvelope) => void>
    >();

    async append(
        event: Omit<RunEventEnvelope, 'sequence'>,
    ): Promise<RunEventEnvelope> {
        const list = this.events.get(event.runId) ?? [];
        const stored = { ...structuredClone(event), sequence: list.length + 1 };
        list.push(stored);
        this.events.set(event.runId, list);
        for (const listener of this.listeners.get(event.runId) ?? []) {
            listener(structuredClone(stored));
        }
        return structuredClone(stored);
    }

    async after(runId: RunId, sequence: number): Promise<RunEventEnvelope[]> {
        return (this.events.get(runId) ?? [])
            .filter(event => event.sequence > sequence)
            .map(event => structuredClone(event));
    }

    subscribe(runId: RunId, listener: (event: RunEventEnvelope) => void): () => void {
        const listeners = this.listeners.get(runId) ?? new Set();
        listeners.add(listener);
        this.listeners.set(runId, listeners);
        return () => {
            listeners.delete(listener);
            if (!listeners.size) this.listeners.delete(runId);
        };
    }
}
