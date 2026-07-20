// DependencyScheduler — the ONE dependency scheduler for the LLM subsystem.
//
// Phase 4 (WP-07): Updated to use AgentRunSpec + RunEdge. Adds joinPolicy
// support, versioned snapshots, and readyIds() returning IDs not fake nodes.
//
// Uses Kahn's algorithm for topological sort + cycle detection.
// Event-driven (onChange) instead of polling.

import type { GoalNodeStatus, AgentRunSpec, RunEdge, AgentRunId } from '@itookit/common';

// ─── Types ───────────────────────────────────────────────────────────

export interface SchedulerSnapshot {
    version: number;
    nodes: Record<string, GoalNodeStatus>;
    order: string[];
}

export class CycleError extends Error {
    constructor(public readonly cycle: string[]) {
        super(`Dependency cycle detected: ${cycle.join(' → ')}`);
        this.name = 'CycleError';
    }
}

export class UnknownNodeError extends Error {
    constructor(nodeId: string) {
        super(`Unknown node in edge: ${nodeId}`);
        this.name = 'UnknownNodeError';
    }
}

// ─── DependencyScheduler ─────────────────────────────────────────────

export class DependencyScheduler {
    private statuses = new Map<string, GoalNodeStatus>();
    private readonly adjacency = new Map<string, string[]>(); // node → dependents
    private readonly inDegree = new Map<string, number>();    // node → remaining deps
    private readonly joinPolicies = new Map<string, AgentRunSpec['joinPolicy']>();
    private readonly depCounts = new Map<string, number>();   // total control + data deps per node
    private readonly topoOrder: string[];
    private version = 0;

    // eslint-disable-next-line @typescript-eslint/prefer-readonly
    private resolveNotify: () => void;
    // eslint-disable-next-line @typescript-eslint/prefer-readonly
    private onChangePromise: Promise<void>;

    constructor(nodes: AgentRunSpec[], edges: RunEdge[] = []) {
        // Validate all nodes have unique IDs
        const ids = new Set<string>();
        for (const node of nodes) {
            if (ids.has(node.id)) throw new Error(`Duplicate node ID: ${node.id}`);
            ids.add(node.id);
        }

        // Initialize statuses
        for (const node of nodes) {
            this.statuses.set(node.id, 'pending');
            this.adjacency.set(node.id, []);
            this.inDegree.set(node.id, 0);
            this.joinPolicies.set(node.id, node.joinPolicy ?? 'all-success');
            this.depCounts.set(node.id, 0);
        }

        // Validate and build adjacency from edges
        for (const edge of edges) {
            if (!this.statuses.has(edge.from)) throw new UnknownNodeError(edge.from);
            if (!this.statuses.has(edge.to)) throw new UnknownNodeError(edge.to);
            if (edge.from === edge.to) throw new Error(`Self-edge not allowed: ${edge.from}`);

            // Both edge kinds gate execution. A data consumer cannot start until
            // the producer has created the referenced Artifact.
            this.adjacency.get(edge.from)!.push(edge.to);
            this.inDegree.set(edge.to, (this.inDegree.get(edge.to) ?? 0) + 1);
            this.depCounts.set(edge.to, (this.depCounts.get(edge.to) ?? 0) + 1);
        }

        // Kahn topological sort + cycle detection
        this.topoOrder = this.kahnSort();

        // Event-driven notification
        let notify: () => void;
        this.onChangePromise = new Promise<void>(resolve => { notify = resolve; });
        this.resolveNotify = notify!;
    }

    // ── Public API ──────────────────────────────────────────────────

    /** Returns IDs (not fake nodes) of all ready nodes. */
    readyIds(): AgentRunId[] {
        const ready: AgentRunId[] = [];
        for (const [id, status] of this.statuses) {
            if (status !== 'pending') continue;
            if ((this.inDegree.get(id) ?? 0) === 0) {
                ready.push(id);
            }
        }
        return ready;
    }

    /** Mark a node as done. Unblocks dependents. Idempotent. */
    complete(id: string): void {
        if (!this.statuses.has(id)) return;
        const current = this.statuses.get(id);
        if (current === 'done' || current === 'failed' || current === 'skipped') return;
        this.statuses.set(id, 'done');
        this.version++;

        // Decrement in-degree of control/data dependents
        for (const dep of this.adjacency.get(id) ?? []) {
            const degree = this.inDegree.get(dep) ?? 0;
            this.inDegree.set(dep, Math.max(0, degree - 1));
        }
        this.notify();
    }

    /** Mark a node as failed. Propagates to dependents based on joinPolicy. Idempotent. */
    fail(id: string): void {
        if (!this.statuses.has(id)) return;
        const current = this.statuses.get(id);
        if (current === 'failed' || current === 'skipped') return;
        this.statuses.set(id, 'failed');
        this.version++;
        this.propagateSkipped(id);
        this.notify();
    }

    /** Skip a node (e.g. when dependency fails and joinPolicy is all-success). */
    skip(id: string): void {
        if (!this.statuses.has(id)) return;
        const current = this.statuses.get(id);
        if (current === 'done' || current === 'failed' || current === 'skipped') return;
        this.statuses.set(id, 'skipped');
        this.version++;
        this.propagateSkipped(id);
        this.notify();
    }

    /** Check if all nodes are resolved. */
    finished(): boolean {
        for (const status of this.statuses.values()) {
            if (status === 'pending' || status === 'ready' || status === 'running'
                || status === 'retrying' || status === 'awaiting_signal') {
                return false;
            }
        }
        return true;
    }

    /** Event-driven wakeup — resolves when the DAG state changes. */
    onChange(): Promise<void> {
        return this.onChangePromise;
    }

    /** Versioned snapshot for goal:progress events. */
    snapshot(): SchedulerSnapshot {
        const nodes: Record<string, GoalNodeStatus> = {};
        for (const [id, status] of this.statuses) {
            nodes[id] = status;
        }
        return { version: this.version, nodes, order: [...this.topoOrder] };
    }

    /** Wait for a snapshot newer than the given version (eliminates lost wakeup). */
    async changedAfter(minVersion: number): Promise<SchedulerSnapshot> {
        while (this.version <= minVersion && !this.finished()) {
            await this.onChange();
        }
        return this.snapshot();
    }

    /** Update node status (for running/retrying/awaiting_signal). */
    setStatus(id: string, status: GoalNodeStatus): void {
        if (this.statuses.has(id)) {
            this.statuses.set(id, status);
            this.version++;
            this.notify();
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

        if (result.length !== this.statuses.size) {
            const remaining = new Set(this.statuses.keys());
            for (const id of result) remaining.delete(id);
            throw new CycleError([...remaining]);
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
                if (this.statuses.get(dep) === 'pending') {
                    const policy = this.joinPolicies.get(dep) ?? 'all-success';
                    if (policy === 'all-success') {
                        // Any dependency failure → skip
                        this.statuses.set(dep, 'skipped');
                        queue.push(dep);
                    }
                    // all-settled / any-success: don't skip, let remaining deps resolve
                }
            }
        }
    }

    private notify(): void {
        this.resolveNotify();
        this.resetNotify();
    }

    private resetNotify(): void {
        let notify: (() => void) | undefined;
        this.onChangePromise = new Promise<void>(resolve => { notify = resolve; });
        this.resolveNotify = notify!;
    }
}
