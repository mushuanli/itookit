import type {
    ProcessId,
    ProcessRecord,
    ResourceCapacity,
    SchedulingPolicy,
} from '@itookit/common';

export class FifoSchedulingPolicy implements SchedulingPolicy {
    select(
        ready: readonly ProcessRecord[],
        capacity: ResourceCapacity,
    ): readonly ProcessId[] {
        return [...ready]
            .sort(compare)
            .slice(0, capacity.available)
            .map(record => record.id);
    }
}

function compare(left: ProcessRecord, right: ProcessRecord): number {
    return right.priority - left.priority
        || left.createdAt - right.createdAt
        || left.id.localeCompare(right.id);
}
