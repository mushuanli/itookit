import { workspaceFinalizationKey, type WorkspaceFinalization } from './workspace-finalization';
import type {
    DagPluginCatalog,
    DagPluginPresentation,
    FlowDraft,
    FlowNodeDefinition,
    FlowRevision,
    ICommandBus,
    JsonValue,
    FlowRunGoal,
    ToolDefinition,
} from '@itookit/common';
import type { Kernel, TaskRecord, TaskSnapshot } from '@itookit/durable-kernel';
import type { FlowDefinitionStore } from '../flow-definition-store';
import { flowToDag, type FlowNodeBinder } from './to-dag';
import { hasValidationErrors, validateFlowRevision } from './validation';
import { validateFlowParameters } from './parameters';
import { FlowCommand } from './command-names';
import { retryFlowTask } from './retry-task';
import { readFlowRunMembers } from './run-members';
import { restoreFlowHandle } from './restore-handle';
import { readFlowTaskTranscript, type FlowTranscriptQuery } from './transcript';
import { DurableFlowExecutor, type FlowExecutionHandle } from './executor';

export interface DagCommandServiceOptions {
    workspaceManager?: import('./executor').FlowWorkspaceManager;
    flowStore: FlowDefinitionStore;
    bindNode?: (sessionId: string, ...args: Parameters<FlowNodeBinder>) => ReturnType<FlowNodeBinder>;
    kernel: Kernel;
    plugins: DagPluginCatalog;
    resolveSessionContext?: (sessionId: string, userMessage: string) => Promise<{ projectInstructions: string; skillInstructions: string; skillIndex: string }>;
    resolveTools?: (sessionId: string, allowedIds: string[]) => Promise<{
        definitions: ToolDefinition[];
        externalIds: string[];
    }>;
}

export interface DurableFlowSnapshot {
    workspaceFinalization?: WorkspaceFinalization;
    attachedFromStorage?: boolean;
    root: TaskSnapshot;
    nodes: Array<{ nodeId: string; snapshot: TaskSnapshot }>;
    /** Per-node execution instance count (loop nodes exceed 1). */
    iterations: Record<string, number>;
    taskTree: TaskRecord[];
    detachedNodes: string[];
    goal?: FlowRunGoal;
    usage: FlowExecutionHandle['usage'];
}

export class DagCommandService {
    private readonly handles = new Map<string, FlowExecutionHandle>();

    constructor(private readonly options: DagCommandServiceOptions) {}

    register(bus: ICommandBus): void {
        registerDraftCommands(bus, this.options.flowStore, this.options.plugins);
        bus.register(FlowCommand.Presentations, async () =>
            loadPresentations(this.options.plugins));
        bus.register(FlowCommand.RunStart, async args => {
            const input = args as { sessionId: string; flow: FlowRevision; parameters?: Record<string, JsonValue>; goal?: FlowRunGoal };
            return this.start(input.sessionId, input.flow, input.parameters, input.goal);
        });
        bus.register(FlowCommand.RunGet, async args => {
            const input = args as { taskId: string; sessionId?: string };
            return this.snapshot(String(input.taskId), input.sessionId);
        });
        bus.register(FlowCommand.RunTranscript, async args => {
            const input = args as { sessionId: string; taskId: string; targetTaskId: string; query?: FlowTranscriptQuery };
            return readFlowTaskTranscript(this.options.kernel, input.sessionId, input.taskId, input.targetTaskId, input.query);
        });
        bus.register(FlowCommand.RunCancel, async args => this.cancel(String((args as { taskId: string }).taskId)));
        bus.register(FlowCommand.RunRespond, async args => {
            const input = args as { taskId: string; requestId: string; value: unknown; targetTaskId?: string };
            return this.respond(String(input.taskId), String(input.requestId), input.value, input.targetTaskId);
        });
        bus.register(FlowCommand.RunSignal, async args => {
            const input = args as { taskId: string; nodeId?: string; targetTaskId?: string; signal: { type: string; payload?: unknown } };
            return this.signal(input);
        });
        bus.register(FlowCommand.RunTaskRetry, async args => {
            const input = args as { sessionId: string; taskId: string; targetTaskId: string; requestId: string };
            const session = await this.options.kernel.openSession(input.sessionId);
            const task = await retryFlowTask(session, input.taskId, input.targetTaskId, input.requestId);
            await this.snapshot(input.taskId, input.sessionId);
            return { taskId: input.taskId, targetTaskId: task.id, retryOfTaskId: input.targetTaskId };
        });
        bus.register(FlowCommand.RunTaskCancel, async args => {
            const input = args as { taskId: string; targetTaskId: string; reason?: string };
            await this.snapshot(String(input.taskId));
            const handle = this.requireHandle(String(input.taskId));
            if (!handle.taskIds.has(input.targetTaskId)) throw new Error(`Task is outside this run: ${input.targetTaskId}`);
            const session = await this.options.kernel.openSession(handle.sessionId);
            await (await session.attachTask(input.targetTaskId)).cancel(input.reason ?? 'Cancelled from DAG run console');
            return { taskId: input.taskId, targetTaskId: input.targetTaskId, cancelled: true };
        });
        bus.register(FlowCommand.RunGoalUpdate, async args => {
            const input = args as { taskId: string; goal: Partial<FlowRunGoal> };
            const handle = this.requireHandle(String(input.taskId));
            const session = await this.options.kernel.openSession(handle.sessionId);
            const key = `flow.run.${input.taskId}.goal`;
            const saved = await session.getShared(key);
            const goal = { ...((saved?.value as unknown as FlowRunGoal) ?? handle.goal ?? { objective: '' }), ...input.goal };
            await session.setShared(key, jsonValue(goal), { expectedVersion: saved?.version ?? null });
            handle.goal = goal;
            if (handle.goal.status === 'paused') await session.suspend();
            if (handle.goal.status === 'active') await session.resume();
            return { taskId: input.taskId, goal: handle.goal };
        });
    }

    private async start(
        sessionId: string,
        flow: FlowRevision,
        parameters?: Record<string, JsonValue>,
        goal?: FlowRunGoal,
    ) {
        if (!sessionId) throw new Error('DAG run requires sessionId');
        const issues = [
            ...validateFlowRevision(flow, this.options.plugins),
            ...validateFlowParameters(flow.parameters, parameters),
        ];
        if (hasValidationErrors(issues)) throw new Error(issues.map(issue => issue.message).join('; '));
        const compiled = await flowToDag(flow, this.options.bindNode ? (node, defaults) => this.options.bindNode!(sessionId, node, defaults) : undefined, undefined, (id, revision) =>
            this.options.flowStore.loadRevision(id, revision));
        const sessionContext = await this.options.resolveSessionContext?.(sessionId, '');
        const handle = await new DurableFlowExecutor({ ...this.options, sessionContext,
            bindPatchNode: this.options.bindNode ? async (id, node, defaults) =>
                this.options.bindNode!(id, node as FlowNodeDefinition, defaults as FlowNodeDefinition['config']) : undefined,
        })
            .submit(sessionId, { ...compiled, ...(goal ? { goal } : {}) }, parameters);
        this.handles.set(handle.root.id, handle);
        return { taskId: handle.root.id };
    }

    private async snapshot(taskId: string, sessionId?: string): Promise<DurableFlowSnapshot> {
        if (!this.handles.has(taskId) && sessionId) {
            this.handles.set(taskId, await restoreFlowHandle(await this.options.kernel.openSession(sessionId), taskId));
        }
        const handle = this.requireHandle(taskId);
        if (sessionId && sessionId !== handle.sessionId) throw new Error('Run Session mismatch');
        const session = await this.options.kernel.openSession(handle.sessionId);
        for (const entry of await readFlowRunMembers(session, (await handle.root.status()).task)) {
            handle.taskIds.add(entry.taskId);
            if (entry.detached) handle.detachedNodes.add(entry.nodeId);
            if (entry.iteration <= (handle.iterations.get(entry.nodeId) ?? 0)) continue;
            handle.iterations.set(entry.nodeId, entry.iteration);
            handle.nodes.set(entry.nodeId, await session.attachTask(entry.taskId));
        }
        const savedGoal = await session.getShared(`flow.run.${taskId}.goal`);
        if (savedGoal) handle.goal = savedGoal.value as unknown as FlowRunGoal;
        const savedWorkspace = await session.getShared(workspaceFinalizationKey(taskId));
        return {
            workspaceFinalization: handle.workspaceFinalization ?? savedWorkspace?.value as unknown as WorkspaceFinalization | undefined,
            attachedFromStorage: handle.attachedFromStorage,
            root: await handle.root.status(),
            nodes: await Promise.all([...handle.nodes].map(async ([nodeId, task]) => ({
                nodeId, snapshot: await task.status(),
            }))),
            iterations: Object.fromEntries(handle.iterations),
            taskTree: await Promise.all([...handle.taskIds].map(async id => (await (await session.attachTask(id)).status()).task)),
            detachedNodes: [...handle.detachedNodes],
            goal: handle.goal,
            usage: handle.usage,
        };
    }

    private async signal(input: {
        taskId: string;
        nodeId?: string;
        targetTaskId?: string;
        signal: { type: string; payload?: unknown };
    }) {
        await this.snapshot(String(input.taskId));
        const handle = this.requireHandle(String(input.taskId));
        if (input.targetTaskId && !handle.taskIds.has(input.targetTaskId)) throw new Error(`Task is outside this run: ${input.targetTaskId}`);
        const target = input.targetTaskId
            ? await (await this.options.kernel.openSession(handle.sessionId)).attachTask(input.targetTaskId)
            : input.nodeId ? handle.nodes.get(input.nodeId) : undefined;
        if (!target) throw new Error('A valid nodeId or targetTaskId is required');
        await target.signal(input.signal);
        return { taskId: input.taskId, targetTaskId: target.id, signalled: true };
    }

    private async respond(taskId: string, requestId: string, value: unknown, targetTaskId?: string) {
        await this.snapshot(taskId);
        const handle = this.requireHandle(taskId);
        if (targetTaskId && !handle.taskIds.has(targetTaskId)) throw new Error(`Task is outside this run: ${targetTaskId}`);
        const session = await this.options.kernel.openSession(handle.sessionId);
        const matches = [];
        for (const id of targetTaskId ? [targetTaskId] : handle.taskIds) {
            const task = await session.attachTask(id);
            const interaction = (await task.status()).task.interactions?.[requestId];
            if (interaction?.status === 'pending' || (targetTaskId && interaction?.status === 'resolved')) matches.push(task);
        }
        if (matches.length > 1) throw new Error(`Ambiguous interaction ${requestId}; targetTaskId is required`);
        if (!matches.length) throw new Error(`No pending interaction ${requestId} for DAG task ${taskId}`);
        await matches[0].respond({ interactionId: requestId, value: jsonValue(value) });
        return { taskId, targetTaskId: matches[0].id, responded: true };
    }

    private async cancel(taskId: string) {
        await this.snapshot(taskId);
        const handle = this.requireHandle(taskId);
        const session = await this.options.kernel.openSession(handle.sessionId);
        const results = await Promise.allSettled([...handle.taskIds].map(async id => (await session.attachTask(id)).cancel()));
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Run cancellation failed');
        return { taskId, cancelled: true };
    }

    private requireHandle(taskId: string): FlowExecutionHandle {
        const handle = this.handles.get(taskId);
        if (!handle) throw new Error(`DAG task is not attached: ${taskId}`);
        return handle;
    }
}

async function loadPresentations(
    plugins: DagPluginCatalog,
): Promise<DagPluginPresentation[]> {
    return Promise.all(plugins.listManifests().map(async manifest => ({
        manifest,
        ui: await plugins.loadUI(manifest.id, manifest.version),
    })));
}

function registerDraftCommands(
    bus: ICommandBus,
    store: FlowDefinitionStore,
    plugins: DagPluginCatalog,
): void {
    bus.register(FlowCommand.DraftList, async () => store.listDrafts());
    bus.register(FlowCommand.DraftCreate, async args => store.createDraft(args as { id: string; name: string }));
    bus.register(FlowCommand.DraftAdopt, async args => {
        const { nodeId, name } = args as { nodeId: string; name: string };
        return store.adoptDraft(nodeId, name);
    });
    bus.register(FlowCommand.DraftLoad, async args => store.loadDraft(String((args as { id: string }).id)));
    bus.register(FlowCommand.DraftSave, async args => saveDraft(
        store,
        plugins,
        args as { draft: FlowDraft; expectedDraftVersion: number },
    ));
    bus.register(FlowCommand.DraftValidate, async args => validateDraft(args as FlowDraft, plugins));
    bus.register(FlowCommand.RevisionCreate, async args => createRevision(
        store,
        plugins,
        args as { draftId: string; expectedDraftVersion: number },
    ));
    bus.register(FlowCommand.RevisionGet, async args => {
        const input = args as { id: string; revision?: number };
        return store.loadRevision(input.id, input.revision);
    });
    bus.register(FlowCommand.RevisionList, async args =>
        store.listRevisions(String((args as { id: string }).id)),
    );
}

async function saveDraft(
    store: FlowDefinitionStore,
    plugins: DagPluginCatalog,
    input: { draft: FlowDraft; expectedDraftVersion: number },
) {
    const draft = await store.saveDraft(input.draft, input.expectedDraftVersion);
    return { draft, version: draft.draftVersion, ...validateDraft(draft, plugins) };
}

function validateDraft(draft: FlowDraft, plugins: DagPluginCatalog) {
    const revision = {
        id: draft.id,
        revision: draft.baseRevision ?? 0,
        name: draft.name,
        nodes: draft.nodes,
        edges: draft.edges,
        connections: draft.connections,
        defaultConnection: draft.defaultConnection,
        systemPrompt: draft.systemPrompt,
        toolIds: draft.toolIds,
        defaults: draft.defaults,
        parameters: draft.parameters,
        runPolicy: draft.runPolicy,
        createdAt: draft.updatedAt,
        digest: '',
    };
    const validationIssues = validateFlowRevision(revision, plugins);
    return { valid: !hasValidationErrors(validationIssues), validationIssues };
}

async function createRevision(
    store: FlowDefinitionStore,
    plugins: DagPluginCatalog,
    input: { draftId: string; expectedDraftVersion: number },
) {
    const draft = await store.loadDraft(input.draftId);
    if (!draft) throw new Error(`Flow draft not found: ${input.draftId}`);
    if (draft.draftVersion !== input.expectedDraftVersion) {
        throw new Error(`Flow draft ${input.draftId} version conflict`);
    }
    const validation = validateDraft(draft, plugins);
    if (!validation.valid) {
        throw new Error(validation.validationIssues.map(issue => issue.message).join('; '));
    }
    const revision = await store.createRevision(draft);
    return { revision, version: revision.revision, ...validation };
}

function jsonValue(value: unknown): import('@itookit/durable-kernel').JsonValue {
    return JSON.parse(JSON.stringify(value ?? null));
}
