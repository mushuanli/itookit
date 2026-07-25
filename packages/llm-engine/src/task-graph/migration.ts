import type { Artifact, FlowRevision, TaskEdgeDefinition, TaskNodeDefinition, TaskRunId, TaskAttempt, TaskGraphRun, ContextSnapshot } from '@itookit/common';
import { createTaskGraphRun } from './runtime';
import { digest } from './utils';
import { flowRevisionDigest } from './validation';

export interface LegacyHarnessAsset {
    goal: LegacyGoal;
    runs?: LegacyAgentRun[];
    artifacts?: LegacyArtifact[];
}

interface LegacyGoal {
    id: string;
    nodes: LegacyAgentRunSpec[];
    edges?: LegacyRunEdge[];
}

interface LegacyAgentRunSpec {
    id: string;
    agent: { id: string; version: string };
    prompt: string;
    joinPolicy?: 'all-success' | 'all-settled' | 'any-success';
    maxRetries?: number;
}

interface LegacyRunEdge {
    from: string;
    to: string;
    kind: 'control' | 'data';
    outputPort?: string;
    inputPort?: string;
    order?: number;
}

interface LegacyAgentRun {
    id: string;
    status: 'pending' | 'ready' | 'running' | 'awaiting_signal' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled' | 'skipped';
    attempts: Array<{ attempt: number; startedAt: number; completedAt?: number; status: 'running' | 'succeeded' | 'failed' | 'cancelled' }>;
}

interface LegacyArtifact {
    id: string;
    taskRunId?: string;
    runId?: string;
    outputName?: string;
    type: Artifact['type'];
    content: Artifact['content'];
    contentHash: string;
    createdAt: number;
    metadata?: Artifact['metadata'];
}

export interface HarnessMigrationReport {
    harnessSchemaVersion: 3;
    idempotencyKey: string;
    flow: FlowRevision;
    graphRun: TaskGraphRun;
    taskRunIdByAgentRunId: Record<string, TaskRunId>;
    migratedArtifactIds: string[];
    migratedArtifacts: Artifact[];
    warnings: string[];
    errors: string[];
}

const reports = new Map<string, HarnessMigrationReport>();

/** Convert a legacy AgentRun graph into one immutable v3 flow and run projection. */
export function migrateLegacyHarnessAsset(asset: LegacyHarnessAsset): HarnessMigrationReport {
    const idempotencyKey = digest(asset);
    const previous = reports.get(idempotencyKey);
    if (previous) return structuredClone(previous);
    const warnings: string[] = [];
    const errors: string[] = [];
    const nodes: TaskNodeDefinition[] = asset.goal.nodes.map(node => ({
        id: node.id,
        name: node.prompt || String(node.id),
        handler: { kind: 'agent', provider: 'builtin', version: node.agent.version, schemaVersion: 1 },
        inputPorts: [{ name: 'source', cardinality: 'many', required: false, order: 0 }],
        outputPorts: [{ name: 'final', required: true, order: 0 }],
        config: { agent: node.agent, prompt: node.prompt, legacyAgentRunId: node.id },
        joinPolicy: node.joinPolicy === 'all-settled' ? { kind: 'all-done', allowFailed: true } : node.joinPolicy === 'any-success' ? { kind: 'any-success' } : { kind: 'all-success' },
        retryPolicy: { maxAttempts: (node.maxRetries ?? 0) + 1, backoff: { kind: 'none' } },
    }));
    const edges: TaskEdgeDefinition[] = (asset.goal.edges ?? []).map((edge, index) => ({
        id: `migrated-edge-${index}-${edge.from}-${edge.to}` as TaskEdgeDefinition['id'],
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        order: edge.order,
        binding: edge.kind === 'data' ? { outputName: edge.outputPort ?? 'final', inputName: edge.inputPort ?? 'source', mode: 'artifact', required: false } : undefined,
    }));
    if (nodes.some(node => node.inputPorts.length && !edges.some(edge => edge.to === node.id))) warnings.push('Some migrated input ports have no source edge');
    const flowWithoutDigest: Omit<FlowRevision, 'digest'> = { id: `migrated-${asset.goal.id}` as FlowRevision['id'], revision: 1, name: `Migrated ${asset.goal.id}`, nodes, edges, createdAt: Date.now() };
    const flow: FlowRevision = { ...flowWithoutDigest, digest: flowRevisionDigest(flowWithoutDigest) } as FlowRevision;
    let graphRun: TaskGraphRun;
    try { graphRun = createTaskGraphRun(flow); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); throw error; }
    const taskRunIdByAgentRunId: Record<string, TaskRunId> = {};
    for (const node of asset.goal.nodes) taskRunIdByAgentRunId[String(node.id)] = graphRun.nodeRuns[node.id][0];
    for (const [legacyId, taskRunId] of Object.entries(taskRunIdByAgentRunId)) {
        const old = asset.runs?.find(run => String(run.id) === legacyId);
        const task = graphRun.tasks?.[taskRunId];
        if (!old || !task) continue;
        task.status = ['pending', 'ready', 'running', 'awaiting_signal'].includes(old.status) ? 'interrupted' : old.status === 'succeeded' ? 'succeeded' : old.status;
        task.attempts = old.attempts.map((attempt, index): TaskAttempt => ({ id: `${legacyId}-attempt-${index + 1}` as TaskAttempt['id'], number: attempt.attempt + 1, status: attempt.status === 'running' ? 'interrupted' : attempt.status, startedAt: attempt.startedAt, completedAt: attempt.completedAt, inputDigest: 'legacy' }));
    }
    const migratedArtifacts = (asset.artifacts ?? []).map(artifact => {
        const owner = taskRunIdByAgentRunId[String(artifact.taskRunId ?? artifact.runId ?? '')];
        if (!owner) warnings.push(`Artifact ${artifact.id} has no legacy Task owner; preserved as orphan`);
        const { runId: _legacyRunId, ...legacyArtifact } = artifact;
        const migrated: Artifact = {
            ...legacyArtifact,
            id: artifact.id as Artifact['id'],
            taskRunId: (owner ?? String(artifact.taskRunId ?? artifact.runId ?? 'orphan')) as TaskRunId,
            outputName: artifact.outputName ?? String(artifact.metadata?.outputPort ?? 'final'),
        };
        const task = owner ? graphRun.tasks?.[owner] : undefined;
        if (task && !task.outputArtifactIds.includes(migrated.id as never)) task.outputArtifactIds.push(migrated.id as never);
        return migrated;
    });
    const report: HarnessMigrationReport = { harnessSchemaVersion: 3, idempotencyKey, flow, graphRun, taskRunIdByAgentRunId, migratedArtifactIds: migratedArtifacts.map(artifact => String(artifact.id)), migratedArtifacts, warnings, errors };
    reports.set(idempotencyKey, report);
    return structuredClone(report);
}

export function clearMigrationReports(): void { reports.clear(); }

export function migrateContextSnapshot(snapshot: ContextSnapshot, taskRunId: TaskRunId): ContextSnapshot {
    return { ...structuredClone(snapshot), taskRunId };
}
