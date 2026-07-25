import type {
    Artifact,
    ArtifactDraft,
    FlowRevision,
    GraphRunLimits,
    TaskGraphRun,
    TaskGraphRunId,
    TaskRun,
    TaskRunId,
    TaskRunSpec,
    TaskEdgeDefinition,
} from '@itookit/common';
import { ulid } from '../persistence/ulid';
import { digest } from './utils';
import { validateFlowRevision } from './validation';

export const DEFAULT_GRAPH_RUN_LIMITS: GraphRunLimits = {
    maxTasks: 256,
    maxSpawnChildrenPerTask: 32,
    maxSpawnDepth: 4,
    maxConcurrentTasks: 8,
};

export interface CreateTaskGraphRunOptions {
    goalId?: import('@itookit/common').GoalIdV3;
    limits?: Partial<GraphRunLimits>;
    taskRunIds?: Record<string, TaskRunId>;
}

export function createTaskGraphRun(flow: FlowRevision, options: CreateTaskGraphRunOptions = {}): TaskGraphRun {
    const issues = validateFlowRevision(flow);
    if (issues.some(issue => issue.severity !== 'warning')) {
        throw new Error(`Invalid FlowRevision: ${issues.map(issue => issue.message).join('; ')}`);
    }
    const graphRunId = ulid() as TaskGraphRunId;
    const taskRunIds = options.taskRunIds ?? Object.fromEntries(flow.nodes.map(node => [String(node.id), ulid() as TaskRunId]));
    const tasks: Record<string, TaskRun> = {};
    for (const node of flow.nodes) {
        const id = taskRunIds[String(node.id)] ?? (ulid() as TaskRunId);
        const spec: TaskRunSpec = {
            id,
            sourceNodeId: node.id,
            handler: structuredClone(node.handler),
            inputPorts: structuredClone(node.inputPorts),
            outputPorts: structuredClone(node.outputPorts),
            explicitInputs: [],
            config: structuredClone(node.config),
            joinPolicy: structuredClone(node.joinPolicy),
            retryPolicy: structuredClone(node.retryPolicy),
            resourcePolicy: node.resourcePolicy ? structuredClone(node.resourcePolicy) : undefined,
        };
        tasks[String(id)] = {
            id,
            graphRunId,
            spec,
            status: 'pending',
            attempts: [],
            outputArtifactIds: [],
            spawnDepth: 0,
            createdAt: Date.now(),
        };
    }
    const edges = flow.edges.map(edge => ({
        ...structuredClone(edge),
        from: taskRunIds[String(edge.from)],
        to: taskRunIds[String(edge.to)],
    })) as TaskEdgeDefinition[];
    const nodeRuns: Record<string, TaskRunId[]> = {};
    for (const node of flow.nodes) nodeRuns[String(node.id)] = [taskRunIds[String(node.id)]];
    const incoming = new Set(edges.map(edge => String(edge.to)));
    const rootTaskRunIds = Object.values(tasks).filter(task => !incoming.has(String(task.id))).map(task => task.id);
    return {
        id: graphRunId,
        goalId: options.goalId,
        flow: { id: flow.id, revision: flow.revision, digest: flow.digest },
        status: 'pending',
        graphVersion: 0,
        nodeRuns,
        rootTaskRunIds,
        createdAt: Date.now(),
        limits: { ...DEFAULT_GRAPH_RUN_LIMITS, ...options.limits },
        tasks,
        edges,
        edgeStates: Object.fromEntries(edges.map(edge => [String(edge.id), {
            edgeId: edge.id, graphRunId, state: 'pending' as const, updatedAt: Date.now(),
        }])),
    };
}

export function commitArtifact(taskRunId: TaskRunId, draft: ArtifactDraft, now = Date.now(), graphRunId?: TaskGraphRunId): Artifact {
    if (!draft.outputName) throw new Error('Artifact outputName is required');
    if (draft.content === undefined) throw new Error(`Artifact ${draft.outputName} has no content`);
    const id = ulid();
    return {
        id: id as import('@itookit/common').ArtifactId,
        taskRunId,
        graphRunId,
        outputName: draft.outputName,
        type: draft.type,
        content: draft.content as string | Record<string, unknown>,
        contentHash: digest(draft.content),
        createdAt: now,
        metadata: draft.metadata,
    };
}

export function inputDigest(inputs: unknown): string { return digest(inputs); }
