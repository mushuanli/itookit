import type {
    DagPluginCatalog,
    DagPluginPresentation,
    FlowDraft,
    FlowRevision,
    ICommandBus,
    JsonValue,
    ToolDefinition,
} from '@itookit/common';
import type { Kernel, TaskSnapshot } from '@itookit/durable-kernel';
import type { FlowDefinitionStore } from '../flow-definition-store';
import { flowToDag } from './to-dag';
import { hasValidationErrors, validateFlowRevision } from './validation';
import { validateFlowParameters } from './parameters';
import { FlowCommand } from './command-names';
import { DurableFlowExecutor, type FlowExecutionHandle } from './executor';

export interface DagCommandServiceOptions {
    flowStore: FlowDefinitionStore;
    kernel: Kernel;
    plugins: DagPluginCatalog;
    resolveTools?: (sessionId: string, allowedIds: string[]) => Promise<{
        definitions: ToolDefinition[];
        externalIds: string[];
    }>;
}

export interface DurableFlowSnapshot {
    root: TaskSnapshot;
    nodes: Array<{ nodeId: string; snapshot: TaskSnapshot }>;
    /** Per-node execution instance count (loop nodes exceed 1). */
    iterations: Record<string, number>;
}

export class DagCommandService {
    private readonly handles = new Map<string, FlowExecutionHandle>();

    constructor(private readonly options: DagCommandServiceOptions) {}

    register(bus: ICommandBus): void {
        registerDraftCommands(bus, this.options.flowStore, this.options.plugins);
        bus.register(FlowCommand.Presentations, async () =>
            loadPresentations(this.options.plugins));
        bus.register(FlowCommand.RunStart, async args => {
            const input = args as { sessionId: string; flow: FlowRevision; parameters?: Record<string, JsonValue> };
            return this.start(input.sessionId, input.flow, input.parameters);
        });
        bus.register(FlowCommand.RunGet, async args => this.snapshot(String((args as { taskId: string }).taskId)));
        bus.register(FlowCommand.RunCancel, async args => this.cancel(String((args as { taskId: string }).taskId)));
        bus.register(FlowCommand.RunRespond, async args => {
            const input = args as { taskId: string; requestId: string; value: unknown };
            return this.respond(String(input.taskId), String(input.requestId), input.value);
        });
    }

    private async start(
        sessionId: string,
        flow: FlowRevision,
        parameters?: Record<string, JsonValue>,
    ) {
        if (!sessionId) throw new Error('DAG run requires sessionId');
        const issues = [
            ...validateFlowRevision(flow, this.options.plugins),
            ...validateFlowParameters(flow.parameters, parameters),
        ];
        if (hasValidationErrors(issues)) throw new Error(issues.map(issue => issue.message).join('; '));
        const handle = await new DurableFlowExecutor(this.options)
            .submit(sessionId, await flowToDag(flow), parameters);
        this.handles.set(handle.root.id, handle);
        return { taskId: handle.root.id };
    }

    private async snapshot(taskId: string): Promise<DurableFlowSnapshot> {
        const handle = this.requireHandle(taskId);
        return {
            root: await handle.root.status(),
            nodes: await Promise.all([...handle.nodes].map(async ([nodeId, task]) => ({
                nodeId, snapshot: await task.status(),
            }))),
            iterations: Object.fromEntries(handle.iterations),
        };
    }

    private async respond(taskId: string, requestId: string, value: unknown) {
        const handle = this.requireHandle(taskId);
        for (const task of handle.nodes.values()) {
            const snapshot = await task.status();
            const interaction = snapshot.task.interactions?.[requestId];
            if (interaction?.status === 'pending') {
                await task.respond({ interactionId: requestId, value: jsonValue(value) });
                return { taskId, responded: true };
            }
        }
        throw new Error(`No pending interaction ${requestId} for DAG task ${taskId}`);
    }

    private async cancel(taskId: string) {
        const handle = this.requireHandle(taskId);
        await Promise.all([...handle.nodes.values()].map(task => task.cancel()));
        await handle.root.cancel();
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
