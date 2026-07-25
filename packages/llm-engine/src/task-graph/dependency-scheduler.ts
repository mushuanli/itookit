import type {
    Artifact,
    TaskEdgeDefinition,
    TaskEdgeId,
    TaskGraphRun,
    TaskRun,
    TaskRunId,
    TaskRunStatus,
    TaskOutcome,
} from '@itookit/common';
import { handlerKey } from './validation';

export interface SchedulerSnapshot {
    version: number;
    tasks: Record<string, TaskRunStatus>;
    edges: Record<string, { state: string; artifactIds?: string[]; reason?: string }>;
}

export interface SchedulerDelta {
    version: number;
    ready: TaskRunId[];
    changed: TaskRunId[];
    edgeStates: SchedulerSnapshot['edges'];
}

export interface GraphDelta {
    expectedVersion?: number;
    tasks: TaskRun[];
    edges: TaskEdgeDefinition[];
}

const TERMINAL = new Set<TaskRunStatus>(['succeeded', 'failed', 'interrupted', 'cancelled', 'skipped']);
const SETTLED = new Set<TaskRunStatus>(['succeeded', 'failed', 'interrupted', 'cancelled', 'skipped']);

export class TaskGraphCycleError extends Error {
    constructor(nodes: string[]) { super(`Task graph contains a cycle: ${nodes.join(', ')}`); this.name = 'TaskGraphCycleError'; }
}

export class TaskGraphUnknownIdError extends Error {
    constructor(id: string) { super(`Unknown TaskGraph id: ${id}`); this.name = 'TaskGraphUnknownIdError'; }
}

/**
 * Pure TaskRun state machine. It owns no executor or persistence dependency.
 * Runtime edge state is kept next to the scheduler state so route decisions
 * never accidentally wait on declaration-time predecessors.
 */
export class DependencyScheduler {
    private readonly tasks = new Map<TaskRunId, TaskRun>();
    private readonly edges = new Map<string, TaskEdgeDefinition>();
    private readonly edgeStates = new Map<string, { state: 'pending' | 'activated' | 'satisfied' | 'skipped' | 'failed'; artifactIds?: string[]; reason?: string }>();
    private version = 0;
    private readonly waiters = new Set<() => void>();

    constructor(graph: TaskGraphRun) {
        for (const task of Object.values(graph.tasks ?? {})) {
            if (this.tasks.has(task.id)) throw new Error(`Duplicate TaskRun ID: ${task.id}`);
            this.tasks.set(task.id, structuredClone(task));
        }
        for (const edge of graph.edges ?? []) this.addEdge(edge);
        for (const edge of graph.edges ?? []) {
            const state = graph.edgeStates?.[edge.id as TaskEdgeId];
            if (state) this.edgeStates.set(String(edge.id), { state: state.state, artifactIds: state.artifactIds?.map(String), reason: state.reason });
        }
        this.assertAcyclic();
        this.refreshPending();
    }

    snapshot(): SchedulerSnapshot {
        const tasks: Record<string, TaskRunStatus> = {};
        for (const [id, task] of this.tasks) tasks[String(id)] = task.status;
        const edges: SchedulerSnapshot['edges'] = {};
        for (const [id, state] of this.edgeStates) edges[id] = { ...state };
        return { version: this.version, tasks, edges };
    }

    getTask(id: TaskRunId): TaskRun {
        return structuredClone(this.requireTask(id));
    }

    getEdgeState(edgeId: TaskEdgeId): SchedulerSnapshot['edges'][string] | undefined {
        const state = this.edgeStates.get(String(edgeId));
        return state ? { ...state } : undefined;
    }

    readyIds(): TaskRunId[] {
        this.refreshPending();
        return [...this.tasks.values()]
            .filter(task => task.status === 'ready')
            .sort((a, b) => (b.spec.resourcePolicy?.priority ?? 0) - (a.spec.resourcePolicy?.priority ?? 0) || String(a.id).localeCompare(String(b.id)))
            .map(task => task.id);
    }

    start(id: TaskRunId): SchedulerDelta {
        const task = this.requireTask(id);
        this.refreshPending();
        if (task.status === 'running') return this.delta([]);
        if (task.status !== 'ready') throw new Error(`TaskRun ${id} is not ready (${task.status})`);
        task.status = 'running';
        this.bump();
        return this.delta([id]);
    }

    retry(id: TaskRunId): SchedulerDelta {
        const task = this.requireTask(id);
        if (!['running', 'failed', 'retrying'].includes(task.status)) throw new Error(`TaskRun ${id} cannot retry from ${task.status}`);
        task.status = 'retrying';
        this.bump();
        task.status = 'ready';
        this.bump();
        return this.delta([id]);
    }

    awaitSignal(id: TaskRunId): SchedulerDelta {
        const task = this.requireTask(id);
        if (task.status === 'awaiting_signal') return this.delta([]);
        if (!['ready', 'running'].includes(task.status)) throw new Error(`TaskRun ${id} cannot await signal from ${task.status}`);
        task.status = 'awaiting_signal';
        this.bump();
        return this.delta([id]);
    }

    settle(id: TaskRunId, outcome: TaskOutcome): SchedulerDelta {
        const task = this.requireTask(id);
        if (TERMINAL.has(task.status)) {
            if (task.status === outcome.status) return this.delta([]);
            throw new Error(`TaskRun ${id} is already ${task.status}`);
        }
        task.status = outcome.status;
        task.completedAt = Date.now();
        const artifactIds = (outcome.artifacts ?? []).map(artifact => String(artifact.id));
        if (outcome.status === 'succeeded') {
            task.outputArtifactIds = [...new Set([...task.outputArtifactIds.map(String), ...artifactIds])] as TaskRun['outputArtifactIds'];
        }
        this.bump();
        for (const edge of this.outgoing(id)) {
            const state = this.edgeStates.get(String(edge.id))!;
            if (state.state !== 'pending') continue;
            // A conditional outgoing edge is controlled by a RouteDecision effect.
            if (edge.condition) continue;
            state.state = outcome.status === 'succeeded'
                ? edge.kind === 'data' ? 'satisfied' : 'activated'
                : 'failed';
            state.artifactIds = edge.kind === 'data'
                ? (outcome.artifacts ?? [])
                    .filter(artifact => !edge.binding?.outputName || artifact.outputName === edge.binding.outputName)
                    .map(artifact => String(artifact.id))
                : artifactIds;
            state.reason = outcome.error?.message;
            this.bump();
        }
        this.refreshPending();
        return this.delta([id]);
    }

    decideEdges(decision: { activatedEdgeIds: TaskEdgeId[]; skippedEdgeIds: TaskEdgeId[]; reason?: string }, byTaskRunId?: TaskRunId): SchedulerDelta {
        const activated = new Set(decision.activatedEdgeIds.map(String));
        const skipped = new Set(decision.skippedEdgeIds.map(String));
        if (!activated.size && !skipped.size) throw new Error('RouteDecision must decide at least one edge');
        for (const id of activated) if (skipped.has(id)) throw new Error(`RouteDecision cannot both activate and skip edge ${id}`);
        for (const id of [...activated, ...skipped]) {
            const edge = this.edges.get(id);
            if (!edge) throw new TaskGraphUnknownIdError(id);
            if (byTaskRunId && String(edge.from) !== String(byTaskRunId)) throw new Error(`Edge ${id} is not outgoing from TaskRun ${byTaskRunId}`);
            const state = this.edgeStates.get(id)!;
            if (state.state !== 'pending') continue;
            state.state = activated.has(id) ? 'activated' : 'skipped';
            state.reason = decision.reason;
            this.bump();
        }
        this.refreshPending();
        return this.delta([...activated, ...skipped].map(id => this.edges.get(id)!.to as TaskRunId));
    }

    cancel(id: TaskRunId): SchedulerDelta {
        const task = this.requireTask(id);
        if (TERMINAL.has(task.status)) return this.delta([]);
        task.status = 'cancelled';
        task.completedAt = Date.now();
        this.bump();
        for (const edge of this.outgoing(id)) {
            const state = this.edgeStates.get(String(edge.id))!;
            if (state.state === 'pending' || state.state === 'activated') {
                state.state = 'failed';
                state.reason = 'source task cancelled';
                this.bump();
            }
        }
        this.refreshPending();
        return this.delta([id]);
    }

    cancelRemainingForJoin(id: TaskRunId): SchedulerDelta {
        const task = this.requireTask(id);
        if (task.spec.joinPolicy.kind !== 'race' || !task.spec.joinPolicy.cancelRemaining) return this.delta([]);
        const incoming = this.incoming(id);
        const changed: TaskRunId[] = [];
        for (const edge of incoming) {
            const sourceId = edge.from as TaskRunId;
            const source = this.tasks.get(sourceId);
            if (!source || source.status === 'succeeded' || TERMINAL.has(source.status)) continue;
            const servesOtherTask = this.outgoing(sourceId).some(candidate => String(candidate.to) !== String(id));
            if (!servesOtherTask) { this.cancel(sourceId); changed.push(sourceId); }
        }
        return this.delta(changed);
    }

    applyGraphDelta(delta: GraphDelta): SchedulerDelta {
        if (delta.expectedVersion !== undefined && delta.expectedVersion !== this.version) {
            throw new Error(`Scheduler version conflict: expected ${delta.expectedVersion}, actual ${this.version}`);
        }
        const taskIds = new Set(this.tasks.keys());
        for (const task of delta.tasks) {
            if (taskIds.has(task.id)) throw new Error(`Duplicate TaskRun ID: ${task.id}`);
            taskIds.add(task.id);
        }
        const existingEdges = new Set(this.edges.keys());
        for (const edge of delta.edges) {
            if (existingEdges.has(String(edge.id))) throw new Error(`Duplicate TaskEdge ID: ${edge.id}`);
            if (!taskIds.has(edge.from as TaskRunId) || !taskIds.has(edge.to as TaskRunId)) throw new TaskGraphUnknownIdError(`${edge.from}->${edge.to}`);
            existingEdges.add(String(edge.id));
        }
        for (const task of delta.tasks) this.tasks.set(task.id, structuredClone(task));
        for (const edge of delta.edges) this.addEdge(edge);
        this.assertAcyclic();
        this.bump();
        this.refreshPending();
        return this.delta(delta.tasks.map(task => task.id));
    }

    finished(): boolean {
        return [...this.tasks.values()].every(task => TERMINAL.has(task.status));
    }

    changedAfter(version: number): Promise<SchedulerSnapshot> {
        if (this.version > version) return Promise.resolve(this.snapshot());
        return new Promise(resolve => {
            const waiter = () => { this.waiters.delete(waiter); resolve(this.snapshot()); };
            this.waiters.add(waiter);
        });
    }

    resolveInputs(id: TaskRunId, artifacts: ReadonlyMap<string, Artifact>): Array<{ port: TaskRun['spec']['inputPorts'][number]; artifacts: string[]; bindings: TaskRun['spec']['explicitInputs'] }> {
        const task = this.requireTask(id);
        const inputEdges = this.incoming(id).filter(edge => edge.kind === 'data' && ['activated', 'satisfied'].includes(this.edgeStates.get(String(edge.id))!.state));
        const ports = task.spec.inputPorts.length ? task.spec.inputPorts : task.spec.explicitInputs.length ? [{ name: '__explicit', cardinality: 'many' as const, required: false, order: Number.MAX_SAFE_INTEGER }] : [];
        return [...ports]
            .sort((a, b) => a.order - b.order)
            .map(port => {
                const edges = inputEdges.filter(edge => edge.binding?.inputName === port.name)
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));
                const artifactIds = edges.flatMap(edge => (this.edgeStates.get(String(edge.id))?.artifactIds ?? [])
                    .filter(artifactId => !edge.binding?.outputName || artifacts.get(artifactId)?.outputName === edge.binding.outputName)
                    .map(artifactId => ({ artifactId, edgeOrder: edge.order ?? 0, edgeId: String(edge.id) })))
                    .sort((a, b) => a.edgeOrder - b.edgeOrder || a.edgeId.localeCompare(b.edgeId) || a.artifactId.localeCompare(b.artifactId))
                    .map(item => item.artifactId);
                const bindings = task.spec.explicitInputs.filter(input => input.kind === 'artifact' || input.kind === 'text' || input.kind === 'round')
                    .sort((a, b) => a.order - b.order);
                const validIds = artifactIds.filter(artifactId => artifacts.has(artifactId));
                if (port.cardinality === 'one' && validIds.length > 1) throw new Error(`Input port ${port.name} accepts one Artifact`);
                if (port.required && !validIds.length && !bindings.length) throw new Error(`Required input port ${port.name} is not satisfied`);
                return { port, artifacts: validIds, bindings };
            });
    }

    private refreshPending(): void {
        let changed = true;
        while (changed) {
            changed = false;
            for (const task of this.tasks.values()) {
                if (task.status !== 'pending') continue;
                const next = this.readiness(task);
                if (next !== task.status) {
                    task.status = next;
                    this.bump();
                    changed = true;
                }
            }
        }
    }

    private readiness(task: TaskRun): TaskRunStatus {
        const incoming = this.incoming(task.id);
        if (!incoming.length) return 'ready';
        const states = incoming.map(edge => ({ edge, state: this.edgeStates.get(String(edge.id))! }));
        const policy = task.spec.joinPolicy;
        const participating = states.filter(item => item.state.state !== 'skipped');
        if (!participating.length) return 'skipped';
        const active = participating.filter(item => item.state.state === 'activated' || item.state.state === 'satisfied');
        const activeStatuses = active.map(item => this.tasks.get(item.edge.from as TaskRunId)?.status ?? 'failed');
        const success = activeStatuses.filter(status => status === 'succeeded').length;
        if (states.some(item => item.state.state === 'pending')) {
            if ((policy.kind === 'any-success' || policy.kind === 'race') && success > 0) return 'ready';
            if (policy.kind === 'quorum' && success >= policy.minimum) return 'ready';
            return 'pending';
        }
        const sourceStatuses = participating.map(item => this.tasks.get(item.edge.from as TaskRunId)?.status ?? 'failed');
        const done = sourceStatuses.filter(status => SETTLED.has(status)).length;
        const failed = sourceStatuses.filter(status => ['failed', 'interrupted', 'cancelled', 'skipped'].includes(status)).length;
        if (policy.kind === 'any-success') return success > 0 ? 'ready' : done === participating.length ? 'skipped' : 'pending';
        if (policy.kind === 'quorum') {
            if (success >= policy.minimum) return 'ready';
            return success + (participating.length - done) >= policy.minimum ? 'pending' : 'skipped';
        }
        if (policy.kind === 'race') return success > 0 ? 'ready' : done === participating.length ? 'skipped' : 'pending';
        if (failed > 0 && (policy.kind === 'all-success' || (policy.kind === 'all-done' && !policy.allowFailed))) return 'skipped';
        return done === participating.length ? 'ready' : 'pending';
    }

    private addEdge(edge: TaskEdgeDefinition): void {
        const id = String(edge.id);
        if (this.edges.has(id)) throw new Error(`Duplicate TaskEdge ID: ${id}`);
        if (!this.tasks.has(edge.from as TaskRunId)) throw new TaskGraphUnknownIdError(String(edge.from));
        if (!this.tasks.has(edge.to as TaskRunId)) throw new TaskGraphUnknownIdError(String(edge.to));
        if (String(edge.from) === String(edge.to)) throw new TaskGraphCycleError([String(edge.from)]);
        this.edges.set(id, structuredClone(edge));
        this.edgeStates.set(id, { state: 'pending' });
    }

    private assertAcyclic(): void {
        const outgoing = new Map<string, string[]>();
        for (const edge of this.edges.values()) outgoing.set(String(edge.from), [...(outgoing.get(String(edge.from)) ?? []), String(edge.to)]);
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const visit = (id: string): void => {
            if (visiting.has(id)) throw new TaskGraphCycleError([...visiting, id]);
            if (visited.has(id)) return;
            visiting.add(id);
            for (const next of outgoing.get(id) ?? []) visit(next);
            visiting.delete(id);
            visited.add(id);
        };
        for (const id of this.tasks.keys()) visit(String(id));
    }

    private incoming(id: TaskRunId): TaskEdgeDefinition[] { return [...this.edges.values()].filter(edge => String(edge.to) === String(id)); }
    private outgoing(id: TaskRunId): TaskEdgeDefinition[] { return [...this.edges.values()].filter(edge => String(edge.from) === String(id)); }
    private requireTask(id: TaskRunId): TaskRun { const task = this.tasks.get(id); if (!task) throw new TaskGraphUnknownIdError(String(id)); return task; }
    private bump(): void { this.version++; for (const waiter of [...this.waiters]) waiter(); }
    private delta(changed: TaskRunId[]): SchedulerDelta { return { version: this.version, ready: this.readyIds(), changed, edgeStates: this.snapshot().edges }; }
}

export { handlerKey };
