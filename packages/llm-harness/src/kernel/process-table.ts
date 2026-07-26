import type {
    ProcessId,
    ProcessRecord,
    ProcessStatus,
    RunId,
} from '@itookit/common';

export class ProcessTable {
    private readonly records = new Map<ProcessId, ProcessRecord>();

    create(record: ProcessRecord): ProcessRecord {
        if (this.records.has(record.id)) throw new Error(`Process already exists: ${record.id}`);
        this.records.set(record.id, clone(record));
        return clone(record);
    }

    get(processId: ProcessId): ProcessRecord | null {
        const record = this.records.get(processId);
        return record ? clone(record) : null;
    }

    update(
        processId: ProcessId,
        patch: Partial<ProcessRecord>,
    ): ProcessRecord {
        const current = this.records.get(processId);
        if (!current) throw new Error(`Process not found: ${processId}`);
        const next = { ...current, ...clone(patch), id: current.id, runId: current.runId };
        this.records.set(processId, next);
        return clone(next);
    }

    listByRun(runId: RunId): ProcessRecord[] {
        return [...this.records.values()]
            .filter(record => record.runId === runId)
            .map(clone);
    }

    listByStatus(status: ProcessStatus): ProcessRecord[] {
        return [...this.records.values()]
            .filter(record => record.status === status)
            .map(clone);
    }
}

function clone<T>(value: T): T {
    return structuredClone(value);
}
