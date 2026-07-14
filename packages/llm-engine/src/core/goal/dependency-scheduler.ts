// DependencyScheduler — the ONE dependency scheduler for the LLM subsystem.
//
// Replaces 4 separate implementations:
//   - kernel DagOrchestrator
//   - engine DependencyGraph (deleted S6c, replaced by resolveDependencyTree)
//   - engine MissionScheduler (embedded scheduling loop)
//   - engine scheduler/dependency-resolver
//
// Uses Kahn's algorithm for topological sort + cycle detection.
// Event-driven (onChange) instead of polling (500ms → 0ms).

import type { GoalNode, GoalNodeStatus } from '@itookit/common';

// ─── Types ───────────────────────────────────────────────────────────

export interface SchedulerSnapshot {
    nodes: Record<string, GoalNodeStatus>;
    order: string[]; // topological order
}

export class CycleError extends Error {
    constructor(public readonly cycle: string[]) {
        super(`Dependency cycle detected: ${cycle.join(' → ')}`);
        this.name = 'CycleError';
    }
}

// ─── DependencyScheduler ─────────────────────────────────────────────

export class DependencyScheduler {
    private statuses = new Map<string, GoalNodeStatus>();
    private readonly adjacency = new Map<string, string[]>(); // node → dependents
    private readonly inDegree = new Map<string, number>();    // node → remaining deps
    private readonly topoOrder: string[];
    private readonly resolveNotify: () => void;
    // eslint-disable-next-line @typescript-eslint/prefer-readonly
    private onChangePromise: Promise<void>;

    constructor(nodes: GoalNode[], edges: Array<[string, string]> = []) {
        // Initialize statuses
        for (const node of nodes) {
            this.statuses.set(node.id, 'pending');
            this.adjacency.set(node.id, []);
            this.inDegree.set(node.id, 0);
        }

        // Build adjacency and in-degree from edges
        for (const [from, to] of edges) {
            const adj = this.adjacency.get(from);
            if (adj) adj.push(to);
            this.inDegree.set(to, (this.inDegree.get(to) ?? 0) + 1);
            // Ensure 'from' exists
            if (!this.inDegree.has(from)) {
                throw new Error(`Unknown node in edge: ${from}`);
            }
        }
        if (!this.inDegree.has(edges[0]?.[1] ?? '')) {
            // Validate all 'to' nodes exist
            for (const [, to] of edges) {
                if (!this.statuses.has(to)) {
                    throw new Error(`Unknown node in edge target: ${to}`);
                }
            }
        }

        // Kahn topological sort + cycle detection
        this.topoOrder = this.kahnSort();

        // Event-driven notification
        let notify: () => void;
        this.onChangePromise = new Promise<void>(resolve => { notify = resolve; });
        this.resolveNotify = notify!;
    }

    // ── Public API ──────────────────────────────────────────────────

    /** Nodes with all dependencies satisfied that haven't started yet. */
    readySet(): GoalNode[] {
        const ready: GoalNode[] = [];
        for (const [id, status] of this.statuses) {
            if (status !== 'pending') continue;
            if ((this.inDegree.get(id) ?? 0) === 0) {
                ready.push({ id, task: { prompt: '' }, predicate: '' });
            }
        }
        return ready;
    }

    /** Mark a node as done. Unblocks dependents. */
    complete(id: string): void {
        if (!this.statuses.has(id)) return;
        this.statuses.set(id, 'done');
        // Decrement in-degree of dependents
        for (const dep of this.adjacency.get(id) ?? []) {
            const current = this.inDegree.get(dep) ?? 0;
            this.inDegree.set(dep, Math.max(0, current - 1));
        }
        this.resolveNotify();
        this.resetNotify();
    }

    /** Mark a node as failed. Automatically propagates to dependents. */
    fail(id: string): void {
        if (!this.statuses.has(id)) return;
        this.statuses.set(id, 'failed');
        this.propagateSkipped(id);
        this.resolveNotify();
        this.resetNotify();
    }

    /** Check if all nodes are resolved. */
    finished(): boolean {
        for (const status of this.statuses.values()) {
            if (status === 'pending' || status === 'ready' || status === 'running' || status === 'retrying' || status === 'awaiting_signal') {
                return false;
            }
        }
        return true;
    }

    /** Event-driven wakeup — resolves when the DAG state changes. */
    onChange(): Promise<void> {
        return this.onChangePromise;
    }

    /** Snapshot for goal:progress events. */
    snapshot(): SchedulerSnapshot {
        const nodes: Record<string, GoalNodeStatus> = {};
        for (const [id, status] of this.statuses) {
            nodes[id] = status;
        }
        return { nodes, order: [...this.topoOrder] };
    }

    /** Update node status directly (for running/retrying/awaiting_signal). */
    setStatus(id: string, status: GoalNodeStatus): void {
        if (this.statuses.has(id)) {
            this.statuses.set(id, status);
        }
    }

    getStatus(id: string): GoalNodeStatus | undefined {
        return this.statuses.get(id);
    }

    // ── Internal ─────────────────────────────────────────────────────

    private kahnSort(): string[] {
        const inDegree = new Map(this.inDegree);
        const queue: string[] = [];
        const result: string[] = [];

        // Start with nodes that have no dependencies
        for (const [id, degree] of inDegree) {
            if (degree === 0) queue.push(id);
        }

        while (queue.length > 0) {
            const current = queue.shift()!;
            result.push(current);
            for (const dep of this.adjacency.get(current) ?? []) {
                const newDegree = (inDegree.get(dep) ?? 1) - 1;
                inDegree.set(dep, newDegree);
                if (newDegree === 0) queue.push(dep);
            }
        }

        // Cycle detection: if not all nodes reached, there's a cycle
        if (result.length !== this.statuses.size) {
            const remaining = new Set(this.statuses.keys());
            for (const id of result) remaining.delete(id);
            const cycleNodes = [...remaining];
            throw new CycleError(cycleNodes);
        }

        return result;
    }

    private propagateSkipped(failedId: string): void {
        const visited = new Set<string>();
        const queue = [failedId];
        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const dep of this.adjacency.get(current) ?? []) {
                if (visited.has(dep)) continue;
                visited.add(dep);
                // Only skip nodes that are still pending
                if (this.statuses.get(dep) === 'pending') {
                    this.statuses.set(dep, 'skipped');
                    queue.push(dep);
                }
            }
        }
    }

    private resetNotify(): void {
        let notify: (() => void) | undefined;
        this.onChangePromise = new Promise<void>(resolve => { notify = resolve; });
        (this as any).resolveNotify = notify!;
    }
}
