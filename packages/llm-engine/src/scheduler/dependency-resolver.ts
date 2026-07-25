// @file: llm-engine/src/scheduler/dependency-resolver.ts
//
// Generic dependency resolution utilities shared by Mission and session-graph
// flow builders. The TaskGraph reconciler owns execution readiness.

export interface DependableItem {
    id: string;
    dependsOn: string[];
    priority?: number;
}

/**
 * Returns items that are ready to execute: pending (not in completedIds or
 * runningIds) with all dependencies satisfied.
 *
 * @param items       Full list of items
 * @param completedIds Set of item IDs that have finished successfully
 * @param runningIds   Set of item IDs currently running
 * @param maxConcurrent Max number of items to return (slots available)
 */
export function getReadyItems<T extends DependableItem>(
    items: T[],
    completedIds: Set<string>,
    runningIds: Set<string>,
    maxConcurrent = Infinity,
): T[] {
    const available = maxConcurrent - runningIds.size;
    if (available <= 0) return [];

    const ready = items.filter(
        item =>
            !completedIds.has(item.id) &&
            !runningIds.has(item.id) &&
            item.dependsOn.every(depId => completedIds.has(depId)),
    );

    // Higher priority first (larger number = higher priority)
    ready.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return ready.slice(0, available);
}

/**
 * Topological sort of items based on their dependsOn[] arrays.
 * Returns items in execution order (dependencies before dependents).
 * Throws if a cycle is detected.
 */
export function topologicalSort<T extends DependableItem>(items: T[]): T[] {
    const byId = new Map(items.map(item => [item.id, item]));
    const sorted: T[] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    function visit(id: string): void {
        if (visited.has(id)) return;
        if (inStack.has(id)) throw new Error(`Dependency cycle detected involving: ${id}`);
        const item = byId.get(id);
        if (!item) return; // Unknown dep — skip
        inStack.add(id);
        for (const depId of item.dependsOn) visit(depId);
        inStack.delete(id);
        visited.add(id);
        sorted.push(item);
    }

    for (const item of items) visit(item.id);
    return sorted;
}
