import type {
    AgentStatePatch,
    AgentStateRevision,
    AppliedExpansion,
    Artifact,
    TaskGraphEvent,
    TaskGraphEventEnvelope,
    TaskGraphEventStore as TaskGraphEventStoreContract,
    TaskGraphRun,
    TaskGraphRunId,
    TaskGraphRunStore as TaskGraphRunStoreContract,
    TaskRun,
    TaskRunId,
    SpawnPlan,
    TaskEdgeDefinition,
    ArtifactId,
    AgentId,
    ContextSnapshot,
    ContextSnapshotId,
} from '@itookit/common';
import { ulid } from '../persistence/ulid';
import { digest, cloneJson } from './utils';

export class EventSequenceConflictError extends Error {
    constructor(expected: number, actual: number) { super(`Event sequence conflict: expected ${expected}, actual ${actual}`); this.name = 'EventSequenceConflictError'; }
}

export class GraphVersionConflictError extends Error {
    constructor(expected: number, actual: number) { super(`Graph version conflict: expected ${expected}, actual ${actual}`); this.name = 'GraphVersionConflictError'; }
}

export class InMemoryTaskGraphEventStore implements TaskGraphEventStoreContract {
    private readonly streams = new Map<string, TaskGraphEventEnvelope[]>();
    private readonly snapshots = new Map<string, { sequence: number; value: unknown }>();
    private readonly queues = new Map<string, Promise<void>>();

    async append<T extends TaskGraphEvent>(event: TaskGraphEventEnvelope<T>, expectedSequence: number): Promise<TaskGraphEventEnvelope<T>> {
        const key = String(event.graphRunId);
        const previous = this.queues.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => { release = resolve; });
        const tail = previous.then(() => current);
        this.queues.set(key, tail);
        await previous;
        try {
            const stream = this.streams.get(key) ?? [];
            if (stream.length !== expectedSequence) throw new EventSequenceConflictError(expectedSequence, stream.length);
            const persisted = { ...structuredClone(event), sequence: stream.length + 1 } as TaskGraphEventEnvelope<T>;
            stream.push(persisted);
            this.streams.set(key, stream);
            return structuredClone(persisted);
        } finally {
            release();
            if (this.queues.get(key) === tail) this.queues.delete(key);
        }
    }

    async after(graphRunId: TaskGraphRunId, sequence: number): Promise<TaskGraphEventEnvelope[]> {
        return structuredClone((this.streams.get(String(graphRunId)) ?? []).filter(event => event.sequence > sequence));
    }

    async latestSequence(graphRunId: TaskGraphRunId): Promise<number> { return (this.streams.get(String(graphRunId)) ?? []).length; }

    async saveSnapshot<T>(graphRunId: TaskGraphRunId, sequence: number, value: T): Promise<void> {
        const existing = this.snapshots.get(String(graphRunId));
        if (existing && existing.sequence >= sequence) return;
        this.snapshots.set(String(graphRunId), { sequence, value: structuredClone(value) });
    }

    async loadSnapshot<T>(graphRunId: TaskGraphRunId): Promise<{ sequence: number; value: T } | null> {
        const snapshot = this.snapshots.get(String(graphRunId));
        return snapshot ? structuredClone(snapshot) as { sequence: number; value: T } : null;
    }
}

/** Public name matching the v3 storage contract; the default implementation is in-memory. */
export class TaskGraphEventStore extends InMemoryTaskGraphEventStore {}

export class InMemoryArtifactStore {
    private readonly artifacts = new Map<string, Artifact>();

    async save(artifact: Artifact): Promise<Artifact> {
        const existing = this.artifacts.get(String(artifact.id));
        if (existing) {
            if (existing.contentHash !== artifact.contentHash) throw new Error(`Artifact ${artifact.id} is immutable`);
            return structuredClone(existing);
        }
        this.artifacts.set(String(artifact.id), structuredClone(artifact));
        return structuredClone(artifact);
    }

    async get(id: ArtifactId | string): Promise<Artifact | null> {
        const artifact = this.artifacts.get(String(id));
        return artifact ? structuredClone(artifact) : null;
    }

    async listByTask(taskRunId: TaskRunId): Promise<Artifact[]> {
        return [...this.artifacts.values()].filter(artifact => String(artifact.taskRunId) === String(taskRunId)).map(artifact => structuredClone(artifact));
    }
}

export class InMemoryContextSnapshotStore {
    private readonly snapshots = new Map<string, ContextSnapshot>();

    async save(snapshot: ContextSnapshot): Promise<ContextSnapshot> {
        const existing = this.snapshots.get(String(snapshot.id));
        if (existing) throw new Error(`ContextSnapshot ${snapshot.id} is immutable`);
        this.snapshots.set(String(snapshot.id), structuredClone(snapshot));
        return structuredClone(snapshot);
    }

    async get(id: ContextSnapshotId | string): Promise<ContextSnapshot | null> {
        const snapshot = this.snapshots.get(String(id));
        return snapshot ? structuredClone(snapshot) : null;
    }
}

export class InMemoryTaskGraphRunStore implements TaskGraphRunStoreContract {
    private readonly runs = new Map<string, TaskGraphRun>();
    private readonly applied = new Map<string, AppliedExpansion>();
    constructor(private readonly validateHandler?: (handler: TaskRun['spec']['handler']) => void) {}

    async get(graphRunId: TaskGraphRunId): Promise<TaskGraphRun | null> {
        const run = this.runs.get(String(graphRunId));
        return run ? structuredClone(run) : null;
    }

    async save(run: TaskGraphRun, expectedGraphVersion?: number): Promise<TaskGraphRun> {
        const existing = this.runs.get(String(run.id));
        if (existing && expectedGraphVersion !== undefined && existing.graphVersion !== expectedGraphVersion) {
            throw new GraphVersionConflictError(expectedGraphVersion, existing.graphVersion);
        }
        if (!existing && expectedGraphVersion !== undefined && expectedGraphVersion !== 0) {
            throw new GraphVersionConflictError(expectedGraphVersion, 0);
        }
        const persisted = structuredClone(run);
        this.runs.set(String(run.id), persisted);
        return structuredClone(persisted);
    }

    async applyExpansion(graphRunId: TaskGraphRunId, expectedGraphVersion: number, plan: SpawnPlan): Promise<AppliedExpansion> {
        const idempotencyKey = `${String(graphRunId)}:${plan.spawnKey}`;
        const previous = this.applied.get(idempotencyKey);
        if (previous) return structuredClone(previous);
        const current = this.runs.get(String(graphRunId));
        if (!current) throw new Error(`TaskGraphRun not found: ${graphRunId}`);
        if (current.graphVersion !== expectedGraphVersion) throw new GraphVersionConflictError(expectedGraphVersion, current.graphVersion);
        const parent = current.tasks?.[plan.parentTaskRunId];
        if (!parent) throw new Error(`Spawn parent not found: ${plan.parentTaskRunId}`);
        if (parent.status !== 'running' && parent.status !== 'succeeded') throw new Error(`Spawn parent must succeed: ${plan.parentTaskRunId}`);
        if (plan.children.length > current.limits.maxSpawnChildrenPerTask) throw new Error('maxSpawnChildrenPerTask exceeded');
        if (parent.spawnDepth >= current.limits.maxSpawnDepth) throw new Error('maxSpawnDepth exceeded');
        if (Object.keys(current.tasks ?? {}).length + plan.children.length + (plan.continuation ? 1 : 0) > current.limits.maxTasks) throw new Error('maxTasks exceeded');
        const childKeys = new Set<string>();
        for (const child of plan.children) {
            if (childKeys.has(child.key)) throw new Error(`Duplicate spawn child key: ${child.key}`);
            childKeys.add(child.key);
            this.validateHandler?.(child.handler);
        }
        if (plan.continuation) this.validateHandler?.(plan.continuation.handler);

        const next = structuredClone(current);
        next.tasks ??= {};
        next.edges ??= [];
        next.edgeStates ??= {};
        const taskRunIds: Record<string, TaskRunId> = {};
        const now = Date.now();
        for (const child of plan.children) {
            const id = ulid() as TaskRunId;
            taskRunIds[child.key] = id;
            next.tasks[id] = this.spawnTask(next.id, id, parent, child.handler, child.config, child.inputs, child.sourceNodeId, child.key);
            const edge = this.controlEdge(parent.id, id, `${plan.spawnKey}:parent:${child.key}`);
            next.edges.push(edge);
            next.edgeStates[edge.id] = { edgeId: edge.id, graphRunId, state: 'pending', updatedAt: now };
        }
        let continuationTaskRunId: TaskRunId | undefined;
        if (plan.continuation) {
            continuationTaskRunId = ulid() as TaskRunId;
            next.tasks[continuationTaskRunId] = this.spawnTask(next.id, continuationTaskRunId, parent, plan.continuation.handler, plan.continuation.config, plan.continuation.inputs, undefined, plan.continuation.key);
            const sources = plan.children.length ? Object.values(taskRunIds) : [parent.id];
            for (const source of sources) {
                const edge = this.controlEdge(source, continuationTaskRunId, `${plan.spawnKey}:continuation:${source}`);
                next.edges.push(edge);
                next.edgeStates[edge.id] = { edgeId: edge.id, graphRunId, state: 'pending', updatedAt: now };
            }
        }
        if (plan.children.length === 0 && !plan.continuation) throw new Error('SpawnPlan has no children or continuation');
        assertAcyclic(next.tasks, next.edges);
        next.graphVersion++;
        this.runs.set(String(graphRunId), next);
        const expansion: AppliedExpansion = {
            spawnKey: plan.spawnKey,
            graphRunId,
            taskRunIds,
            continuationTaskRunId,
            graphVersion: next.graphVersion,
            tasks: Object.values(next.tasks).filter(task => !current.tasks?.[task.id]),
            edges: next.edges.filter(edge => !current.edges?.some(existing => String(existing.id) === String(edge.id))),
        };
        this.applied.set(idempotencyKey, expansion);
        return structuredClone(expansion);
    }

    private spawnTask(
        graphRunId: TaskGraphRunId,
        id: TaskRunId,
        parent: TaskRun,
        handler: TaskRun['spec']['handler'],
        config: TaskRun['spec']['config'],
        inputs: TaskRun['spec']['explicitInputs'],
        sourceNodeId: TaskRun['spec']['sourceNodeId'],
        spawnKey: string,
    ): TaskRun {
        return {
            id,
            graphRunId,
            spec: {
                id,
                sourceNodeId,
                handler: structuredClone(handler),
                inputPorts: [],
                outputPorts: [],
                explicitInputs: structuredClone(inputs),
                config: structuredClone(config),
                joinPolicy: { kind: 'all-success' },
                retryPolicy: { maxAttempts: 1, backoff: { kind: 'none' } },
            },
            status: 'pending',
            attempts: [],
            outputArtifactIds: [],
            parentTaskRunId: parent.id,
            spawnKey,
            spawnDepth: parent.spawnDepth + 1,
            createdAt: Date.now(),
        };
    }

    private controlEdge(from: TaskRunId, to: TaskRunId, id: string): TaskEdgeDefinition {
        return { id: id as TaskEdgeDefinition['id'], from, to, kind: 'control' };
    }
}

export class AgentStateConflictError extends Error {}

export class AgentStateStore {
    private readonly revisions = new Map<string, AgentStateRevision>();
    private readonly locks = new Map<string, Promise<void>>();

    async get(agentId: AgentId, namespace: string, revision?: number): Promise<AgentStateRevision> {
        validateNamespace(namespace);
        const prefix = `${String(agentId)}:${namespace}:`;
        const candidates = [...this.revisions.values()].filter(item => item.agentId === agentId && item.namespace === namespace && (revision === undefined || item.revision === revision));
        const found = candidates.sort((a, b) => b.revision - a.revision)[0];
        if (found) return structuredClone(found);
        if (revision !== undefined && revision !== 0) throw new Error(`AgentState revision not found: ${String(agentId)}:${namespace}@${revision}`);
        return {
            id: ulid() as AgentStateRevision['id'], agentId, namespace, revision: 0, values: {}, memoryRefs: [], createdAt: Date.now(), digest: digest({ prefix, revision: 0 }),
        };
    }

    async commit(patch: AgentStatePatch, taskRunId?: TaskRunId): Promise<AgentStateRevision> {
        validateNamespace(patch.namespace);
        // Serialize the read/compare/write sequence. Without this lock two
        // concurrent Tasks can both observe the same head revision and both
        // commit, violating the advertised CAS contract.
        return this.withExclusive(`__state__:${String(patch.agentId)}:${patch.namespace}`, async () => {
            const current = await this.get(patch.agentId, patch.namespace);
            if (current.revision !== patch.baseRevision) throw new AgentStateConflictError(`State revision conflict: expected ${patch.baseRevision}, actual ${current.revision}`);
            const values = cloneJson(current.values);
            for (const operation of patch.operations) applyOperation(values, operation);
            const next: AgentStateRevision = {
                id: ulid() as AgentStateRevision['id'], agentId: patch.agentId, namespace: patch.namespace, revision: current.revision + 1,
                parentRevision: current.revision || undefined, values, memoryRefs: [...current.memoryRefs], createdAt: Date.now(), createdByTaskRunId: taskRunId,
                digest: digest({ agentId: patch.agentId, namespace: patch.namespace, revision: current.revision + 1, values, memoryRefs: current.memoryRefs }),
            };
            this.revisions.set(`${String(patch.agentId)}:${patch.namespace}:${next.revision}`, next);
            return structuredClone(next);
        });
    }

    async withExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => { release = resolve; });
        const tail = previous.then(() => current);
        this.locks.set(key, tail);
        await previous;
        try { return await operation(); } finally { release(); if (this.locks.get(key) === tail) this.locks.delete(key); }
    }

    /** Hydrate an immutable revision loaded from a durable projection. */
    protected importRevision(revision: AgentStateRevision): void {
        this.revisions.set(`${String(revision.agentId)}:${revision.namespace}:${revision.revision}`, structuredClone(revision));
    }
}

function validateNamespace(namespace: string): void {
    if (!/^(conversation|goal|project|agent):[^:]+$/.test(namespace)) {
        throw new Error(`Invalid AgentState namespace: ${namespace}`);
    }
}

function applyOperation(values: Record<string, import('@itookit/common').JsonValue>, operation: AgentStatePatch['operations'][number]): void {
    const path = operation.path;
    if (!path.length) throw new Error('State operation path cannot be empty');
    let cursor: Record<string, import('@itookit/common').JsonValue> = values;
    for (const part of path.slice(0, -1)) {
        const existing = cursor[part];
        if (!existing || typeof existing !== 'object' || Array.isArray(existing)) cursor[part] = {};
        cursor = cursor[part] as Record<string, import('@itookit/common').JsonValue>;
    }
    const key = path[path.length - 1];
    if (operation.kind === 'delete') delete cursor[key];
    else if (operation.kind === 'set') cursor[key] = cloneJson(operation.value);
    else cursor[key] = { ...(cursor[key] && typeof cursor[key] === 'object' && !Array.isArray(cursor[key]) ? cursor[key] as Record<string, import('@itookit/common').JsonValue> : {}), ...cloneJson(operation.value) };
}

function assertAcyclic(tasks: Record<string, TaskRun>, edges: TaskEdgeDefinition[]): void {
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) adjacency.set(String(edge.from), [...(adjacency.get(String(edge.from)) ?? []), String(edge.to)]);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
        if (visiting.has(id)) throw new Error(`Spawn expansion creates a cycle at ${id}`);
        if (visited.has(id)) return;
        if (!tasks[id]) throw new Error(`Spawn edge references unknown task ${id}`);
        visiting.add(id);
        for (const next of adjacency.get(id) ?? []) visit(next);
        visiting.delete(id);
        visited.add(id);
    };
    Object.keys(tasks).forEach(visit);
}
