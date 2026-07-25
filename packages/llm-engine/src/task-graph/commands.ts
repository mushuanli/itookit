import type {
    FlowDraft,
    FlowRevision,
    TaskGraphRun,
    TaskGraphRunId,
    TaskRunId,
} from '@itookit/common';
import type { ICommandBus, TaskGraphEventStore as TaskGraphEventStoreContract } from '@itookit/common';
import type { FlowDefinitionStore } from '../persistence/flow-definition-store';
import { TaskGraphReconciler } from './reconciler';
import { createTaskGraphRun } from './runtime';
import { validateFlowRevision } from './validation';
import type { TaskGraphRunStore, ArtifactStore } from '@itookit/common';
import type { ContextSnapshotStore } from '@itookit/common';
import type { AgentStateStore } from './stores';
import type { HarnessContributionRegistry, TaskExecutorRegistry } from './registry';

export interface TaskGraphCommandServiceOptions {
    flowStore: FlowDefinitionStore;
    reconciler: TaskGraphReconciler;
    runStore: TaskGraphRunStore;
    eventStore: TaskGraphEventStoreContract;
    artifactStore: ArtifactStore;
    contextSnapshotStore?: ContextSnapshotStore;
    stateStore?: AgentStateStore;
    taskExecutorRegistry?: TaskExecutorRegistry;
    contributionRegistry?: HarnessContributionRegistry;
}

/** CommandBus adapter; UI never mutates graph/task stores directly. */
export class TaskGraphCommandService {
    private readonly aborts = new Map<string, AbortController>();

    constructor(private readonly options: TaskGraphCommandServiceOptions) {}

    register(bus: ICommandBus): void {
        bus.register('flow.draft.list', async () => this.options.flowStore.listDrafts());
        bus.register('flow.draft.create', async args => {
            const input = args as { id: string; name: string };
            return this.options.flowStore.createDraft({ id: input.id, name: input.name });
        });
        bus.register('flow.draft.load', async args => this.options.flowStore.loadDraft(String((args as { id: string }).id)));
        bus.register('flow.draft.save', async args => {
            const input = args as { draft: FlowDraft; expectedDraftVersion: number };
            return this.saveDraft(input.draft, input.expectedDraftVersion);
        });
        bus.register('flow.draft.validate', async args => this.validateDraft(args as FlowDraft));
        bus.register('flow.revision.create', async args => {
            const input = args as { draftId: string; expectedDraftVersion: number };
            return this.createRevision(input.draftId, input.expectedDraftVersion);
        });
        bus.register('flow.revision.get', async args => {
            const input = args as { id: string; revision?: number };
            return this.options.flowStore.loadRevision(input.id, input.revision);
        });
        bus.register('flow.revision.list', async args => this.options.flowStore.listRevisions(String((args as { id: string }).id)));
        bus.register('taskGraph.run.start', async args => this.start(args as { flow: FlowRevision; goalId?: string }));
        bus.register('taskGraph.run.get', async args => this.options.runStore.get((args as { graphRunId: TaskGraphRunId }).graphRunId));
        bus.register('taskGraph.run.cancel', async args => this.cancel((args as { graphRunId: TaskGraphRunId }).graphRunId));
        bus.register('taskGraph.retryTask', async args => this.options.reconciler.retryTask((args as { graphRunId: TaskGraphRunId; taskRunId: TaskRunId }).graphRunId, (args as { taskRunId: TaskRunId }).taskRunId));
        bus.register('taskGraph.respond', async args => {
            const input = args as { graphRunId: TaskGraphRunId; taskRunId: TaskRunId; response: unknown };
            return this.options.reconciler.respond(input.graphRunId, input.taskRunId, input.response);
        });
        bus.register('taskGraph.events.after', async args => {
            const input = args as { graphRunId: TaskGraphRunId; sequence: number };
            return this.options.eventStore.after(input.graphRunId, input.sequence);
        });
        bus.register('taskGraph.artifact.get', async args => this.options.artifactStore.get((args as { artifactId: string }).artifactId));
        bus.register('taskGraph.cancelTask', async args => this.cancelTask(args as { graphRunId: TaskGraphRunId; taskRunId: TaskRunId }));
        bus.register('taskGraph.context.preview', async args => this.context(args as { graphRunId: TaskGraphRunId; taskRunId: TaskRunId }));
        bus.register('taskGraph.context.get', async args => this.context(args as { graphRunId: TaskGraphRunId; taskRunId: TaskRunId }));
        bus.register('taskGraph.context.explain', async args => this.context(args as { graphRunId: TaskGraphRunId; taskRunId: TaskRunId }));
        bus.register('taskGraph.agentState.get', async args => this.state(args as { agentId: import('@itookit/common').AgentId; namespace: string; revision?: number }));
        bus.register('taskGraph.agentState.diff', async args => this.state(args as { agentId: import('@itookit/common').AgentId; namespace: string; revision?: number }));
        bus.register('taskGraph.spawn.inspect', async args => this.inspect((args as { graphRunId: TaskGraphRunId; taskRunId?: TaskRunId }).graphRunId, (args as { taskRunId?: TaskRunId }).taskRunId));
        bus.register('plugin.taskKinds.list', async args => {
            const descriptors = this.options.contributionRegistry?.listTaskKindDescriptors() ?? [];
            return (args as { handlersOnly?: boolean } | undefined)?.handlersOnly
                ? (descriptors.length
                    ? descriptors.map(item => item.handler)
                    : this.options.taskExecutorRegistry?.list() ?? [])
                : descriptors;
        });
    }

    private async saveDraft(draft: FlowDraft, expectedDraftVersion: number): Promise<{ draft: FlowDraft; version: number; validationIssues: ReturnType<typeof validateFlowRevision> }> {
        const saved = await this.options.flowStore.saveDraft(draft, expectedDraftVersion);
        const validationIssues = this.validateDraft(saved).validationIssues;
        return { draft: saved, version: saved.draftVersion, validationIssues };
    }

    private validateDraft(draft: FlowDraft): { valid: boolean; validationIssues: ReturnType<typeof validateFlowRevision> } {
        const revision = { id: draft.id, revision: draft.baseRevision ?? 0, name: draft.name, nodes: draft.nodes, edges: draft.edges, createdAt: draft.updatedAt, digest: '' } as FlowRevision;
        const validationIssues = validateFlowRevision(
            revision,
            this.options.taskExecutorRegistry?.keys(),
        );
        for (const node of draft.nodes) {
            const configErrors = this.options.contributionRegistry?.validateConfig(node.handler, node.config) ?? [];
            for (const message of configErrors) validationIssues.push({ code: 'invalid-config', message: `${node.id}: ${message}`, nodeId: String(node.id) });
        }
        return { valid: !validationIssues.some(issue => issue.severity !== 'warning'), validationIssues };
    }

    private async createRevision(draftId: string, expectedDraftVersion: number) {
        const draft = await this.options.flowStore.loadDraft(draftId);
        if (!draft) throw new Error(`Flow draft not found: ${draftId}`);
        if (draft.draftVersion !== expectedDraftVersion) {
            throw new Error(`Flow draft ${draftId} version conflict: expected ${expectedDraftVersion}, actual ${draft.draftVersion}`);
        }
        const validation = this.validateDraft(draft);
        const validationIssues = validation.validationIssues;
        if (validationIssues.some(issue => issue.severity !== 'warning')) throw new Error(validationIssues.map(issue => issue.message).join('; '));
        const saved = await this.options.flowStore.createRevision(draft);
        return { revision: saved, version: saved.revision, validationIssues };
    }

    private async start(input: { flow: FlowRevision; goalId?: string }): Promise<{ graphRun: TaskGraphRun; version: number }> {
        const graph = createTaskGraphRun(input.flow, { goalId: input.goalId as never });
        const controller = new AbortController();
        this.aborts.set(String(graph.id), controller);
        const result = await this.options.reconciler.run(graph, { signal: controller.signal });
        this.aborts.delete(String(graph.id));
        return { graphRun: result.graphRun, version: result.graphRun.graphVersion };
    }

    private async cancel(graphRunId: TaskGraphRunId): Promise<{ graphRunId: TaskGraphRunId; cancelled: boolean }> {
        const controller = this.aborts.get(String(graphRunId));
        if (!controller) return { graphRunId, cancelled: false };
        controller.abort();
        return { graphRunId, cancelled: true };
    }

    private async cancelTask(input: { graphRunId: TaskGraphRunId; taskRunId: TaskRunId }): Promise<{ taskRunId: TaskRunId; cancelled: boolean }> {
        const graph = await this.options.runStore.get(input.graphRunId);
        const task = graph?.tasks?.[input.taskRunId];
        if (!task || ['succeeded', 'failed', 'cancelled', 'skipped'].includes(task.status)) return { taskRunId: input.taskRunId, cancelled: false };
        await this.options.reconciler.cancelTask(input.graphRunId, input.taskRunId);
        return { taskRunId: input.taskRunId, cancelled: true };
    }

    private async context(input: { graphRunId: TaskGraphRunId; taskRunId: TaskRunId }): Promise<unknown> {
        const graph = await this.options.runStore.get(input.graphRunId);
        const task = graph?.tasks?.[input.taskRunId];
        if (!task?.agent) return null;
        const snapshot = await this.options.contextSnapshotStore?.get(task.agent.contextSnapshotId);
        return snapshot ? { snapshot, explanation: snapshot.explanation } : { contextSnapshotId: task.agent.contextSnapshotId };
    }

    private async state(input: { agentId: import('@itookit/common').AgentId; namespace: string; revision?: number }): Promise<unknown> {
        if (!this.options.stateStore) return null;
        return this.options.stateStore.get(input.agentId, input.namespace, input.revision);
    }

    private async inspect(graphRunId: TaskGraphRunId, taskRunId?: TaskRunId): Promise<unknown> {
        const graph = await this.options.runStore.get(graphRunId);
        if (!graph) return null;
        if (!taskRunId) return { graphVersion: graph.graphVersion, taskRunIds: Object.keys(graph.tasks ?? {}) };
        const task = graph.tasks?.[taskRunId];
        return task ? { taskRunId, parentTaskRunId: task.parentTaskRunId, spawnKey: task.spawnKey, spawnDepth: task.spawnDepth } : null;
    }
}

export function registerTaskGraphCommands(bus: ICommandBus, options: TaskGraphCommandServiceOptions): TaskGraphCommandService {
    const service = new TaskGraphCommandService(options);
    service.register(bus);
    return service;
}
