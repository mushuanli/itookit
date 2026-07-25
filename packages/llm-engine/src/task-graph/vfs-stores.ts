import type {
    Artifact,
    AgentId,
    AgentStatePatch,
    AgentStateRevision,
    TaskGraphEvent,
    TaskGraphEventEnvelope,
    TaskGraphEventStore as TaskGraphEventStoreContract,
    TaskGraphRun,
    TaskGraphRunId,
    TaskRun,
    ArtifactId,
} from '@itookit/common';
import type { IChatEngine } from '../persistence/types';
import { digest } from './utils';
import { AgentStateStore, InMemoryArtifactStore, InMemoryContextSnapshotStore, InMemoryTaskGraphRunStore } from './stores';

/** File-backed event stream. The JSONL file is the control-plane source of truth. */
export class VfsTaskGraphEventStore implements TaskGraphEventStoreContract {
    private readonly queues = new Map<string, Promise<void>>();
    constructor(private readonly engine: IChatEngine, private readonly nodeId: string) {}

    async append<T extends TaskGraphEvent>(event: TaskGraphEventEnvelope<T>, expectedSequence: number): Promise<TaskGraphEventEnvelope<T>> {
        const key = String(event.graphRunId);
        const previous = this.queues.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => { release = resolve; });
        const tail = previous.then(() => current);
        this.queues.set(key, tail);
        await previous;
        try {
            const events = await this.read(event.graphRunId);
            if (events.length !== expectedSequence) throw new Error(`Event sequence conflict: expected ${expectedSequence}, actual ${events.length}`);
            const persisted = { ...event, sequence: events.length + 1 } as TaskGraphEventEnvelope<T>;
            events.push(persisted);
            await this.engine.createAsset(this.nodeId, this.eventName(event.graphRunId), `${events.map(item => JSON.stringify(item)).join('\n')}\n`);
            return persisted;
        } finally {
            release();
            if (this.queues.get(key) === tail) this.queues.delete(key);
        }
    }

    async after(graphRunId: TaskGraphRunId, sequence: number): Promise<TaskGraphEventEnvelope[]> {
        return (await this.read(graphRunId)).filter(event => event.sequence > sequence);
    }

    async latestSequence(graphRunId: TaskGraphRunId): Promise<number> { return (await this.read(graphRunId)).length; }

    async saveSnapshot<T>(graphRunId: TaskGraphRunId, sequence: number, value: T): Promise<void> {
        const current = await this.loadSnapshot<T>(graphRunId);
        if (current && current.sequence >= sequence) return;
        const payload = JSON.stringify({ sequence, value }, null, 2);
        await this.engine.createAsset(this.nodeId, `runs/${String(graphRunId)}/snapshots/snapshot-${sequence}.json`, payload);
        await this.engine.createAsset(this.nodeId, `runs/${String(graphRunId)}/snapshots/latest.json`, payload);
    }

    async loadSnapshot<T>(graphRunId: TaskGraphRunId): Promise<{ sequence: number; value: T } | null> {
        try {
            const text = await this.engine.openFile(this.nodeId).asset(`runs/${String(graphRunId)}/snapshots/latest.json`).readText();
            return text ? JSON.parse(text) as { sequence: number; value: T } : null;
        } catch { return null; }
    }

    private async read(graphRunId: TaskGraphRunId): Promise<TaskGraphEventEnvelope[]> {
        try {
            const text = await this.engine.openFile(this.nodeId).asset(this.eventName(graphRunId)).readText();
            return (text ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as TaskGraphEventEnvelope);
        } catch { return []; }
    }

    private eventName(graphRunId: TaskGraphRunId): string { return `runs/${String(graphRunId)}/events.jsonl`; }
}

/** Durable JSON projection for restart/recovery. Events remain the control-plane SSOT. */
export class VfsTaskGraphRunStore extends InMemoryTaskGraphRunStore {
    constructor(private readonly engine: IChatEngine, private readonly nodeId: string, validateHandler?: (handler: TaskRun['spec']['handler']) => void) {
        super(validateHandler);
    }

    override async get(graphRunId: TaskGraphRunId): Promise<TaskGraphRun | null> {
        const cached = await super.get(graphRunId);
        if (cached) return cached;
        try {
            const text = await this.engine.openFile(this.nodeId).asset(this.metaName(graphRunId)).readText();
            if (!text) return null;
            const run = JSON.parse(text) as TaskGraphRun;
            await super.save(run);
            return structuredClone(run);
        } catch { return null; }
    }

    override async save(run: TaskGraphRun, expectedGraphVersion?: number): Promise<TaskGraphRun> {
        const saved = await super.save(run, expectedGraphVersion);
        await this.engine.createAsset(this.nodeId, this.metaName(run.id), JSON.stringify(saved, null, 2));
        return saved;
    }

    override async applyExpansion(graphRunId: TaskGraphRunId, expectedGraphVersion: number, plan: import('@itookit/common').SpawnPlan): Promise<import('@itookit/common').AppliedExpansion> {
        const expansion = await super.applyExpansion(graphRunId, expectedGraphVersion, plan);
        const updated = await super.get(graphRunId);
        if (updated) await this.save(updated);
        return expansion;
    }

    private metaName(graphRunId: TaskGraphRunId): string { return `runs/${String(graphRunId)}/meta.json`; }
}

/** Immutable Artifact files colocated with a graph run. */
export class VfsArtifactStore extends InMemoryArtifactStore {
    constructor(private readonly engine: IChatEngine, private readonly nodeId: string, private readonly graphRunId?: TaskGraphRunId) { super(); }

    override async save(artifact: Artifact): Promise<Artifact> {
        const persisted = await super.save(artifact);
        const owner = persisted.graphRunId ?? this.graphRunId;
        const path = owner
            ? `runs/${String(owner)}/artifacts/${String(persisted.id)}.json`
            : `runs/artifacts/${String(persisted.id)}.json`;
        await this.engine.createAsset(this.nodeId, path, JSON.stringify(persisted, null, 2));
        await this.engine.createAsset(this.nodeId, `runs/artifacts/index-${String(persisted.id)}.json`, JSON.stringify({ graphRunId: owner }));
        return persisted;
    }

    override async get(id: ArtifactId | string): Promise<Artifact | null> {
        const cached = await super.get(id);
        if (cached) return cached;
        try {
            const indexText = await this.engine.openFile(this.nodeId).asset(`runs/artifacts/index-${String(id)}.json`).readText();
            const indexed = indexText ? JSON.parse(indexText) as { graphRunId?: string } : undefined;
            const owner = indexed?.graphRunId ?? this.graphRunId;
            const path = owner
                ? `runs/${String(owner)}/artifacts/${String(id)}.json`
                : `runs/artifacts/${String(id)}.json`;
            const text = await this.engine.openFile(this.nodeId).asset(path).readText();
            if (!text) return null;
            const artifact = JSON.parse(text) as Artifact;
            await super.save(artifact);
            return artifact;
        } catch { return null; }
    }
}

/** Durable immutable ContextSnapshot projection. */
export class VfsContextSnapshotStore extends InMemoryContextSnapshotStore {
    constructor(private readonly engine: IChatEngine, private readonly nodeId: string) { super(); }

    override async save(snapshot: import('@itookit/common').ContextSnapshot): Promise<import('@itookit/common').ContextSnapshot> {
        const saved = await super.save(snapshot);
        await this.engine.createAsset(this.nodeId, `runs/contexts/${String(saved.id)}.json`, JSON.stringify(saved, null, 2));
        return saved;
    }

    override async get(id: import('@itookit/common').ContextSnapshotId | string): Promise<import('@itookit/common').ContextSnapshot | null> {
        const cached = await super.get(id);
        if (cached) return cached;
        try {
            const text = await this.engine.openFile(this.nodeId).asset(`runs/contexts/${String(id)}.json`).readText();
            if (!text) return null;
            const snapshot = JSON.parse(text) as import('@itookit/common').ContextSnapshot;
            await super.save(snapshot);
            return snapshot;
        } catch { return null; }
    }
}

/** Durable AgentState head/revision projection with CAS delegated to the base store. */
export class VfsAgentStateStore extends AgentStateStore {
    constructor(private readonly engine: IChatEngine, private readonly nodeId: string) { super(); }

    override async get(agentId: AgentId, namespace: string, revision?: number): Promise<AgentStateRevision> {
        try {
            let path = this.revisionName(agentId, namespace, revision);
            if (revision === undefined) {
                const headText = await this.engine.openFile(this.nodeId).asset(path).readText();
                const head = headText ? JSON.parse(headText) as { revision?: number } : undefined;
                if (head?.revision !== undefined) path = this.revisionName(agentId, namespace, head.revision);
            }
            const text = await this.engine.openFile(this.nodeId).asset(path).readText();
            if (text) {
                const loaded = JSON.parse(text) as AgentStateRevision;
                this.importRevision(loaded);
                return structuredClone(loaded);
            }
        } catch { /* fall back to the in-memory zero revision */ }
        return super.get(agentId, namespace, revision);
    }

    override async commit(patch: AgentStatePatch, taskRunId?: import('@itookit/common').TaskRunId): Promise<AgentStateRevision> {
        const next = await super.commit(patch, taskRunId);
        const directory = this.directory(next.agentId, next.namespace);
        const payload = JSON.stringify(next, null, 2);
        await this.engine.createAsset(this.nodeId, `${directory}/revision-${next.revision}.json`, payload);
        await this.engine.createAsset(this.nodeId, `${directory}/head.json`, JSON.stringify({ revision: next.revision }));
        return next;
    }

    private directory(agentId: AgentId, namespace: string): string { return `agent-state/${String(agentId)}/${digest(namespace).slice(0, 24)}`; }
    private revisionName(agentId: AgentId, namespace: string, revision?: number): string {
        const directory = this.directory(agentId, namespace);
        return revision === undefined ? `${directory}/head.json` : `${directory}/revision-${revision}.json`;
    }
}
