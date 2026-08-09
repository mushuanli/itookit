import type {
    DagPluginCatalog,
    DagPluginPresentation,
    FlowDraft,
    FlowRevision,
    ICommandBus,
    ToolDefinition,
} from '@itookit/common';
import type { Harness, TaskSnapshot } from '@itookit/harness';
import type { FlowDefinitionStore } from '../persistence/flow-definition-store';
import { flowToDag } from './to-dag';
import { validateFlowRevision } from './validation';
import { DurableFlowExecutor, type FlowExecutionHandle } from './executor';

export interface DagCommandServiceOptions {
    flowStore: FlowDefinitionStore;
    harness: Harness;
    plugins: DagPluginCatalog;
    resolveTools?: (sessionId: string, allowedIds: string[]) => Promise<{
        definitions: ToolDefinition[];
        externalIds: string[];
    }>;
}

export interface DurableFlowSnapshot {
    root: TaskSnapshot;
    nodes: Array<{ nodeId: string; snapshot: TaskSnapshot }>;
}

export class DagCommandService {
    private readonly handles = new Map<string, FlowExecutionHandle>();

    constructor(private readonly options: DagCommandServiceOptions) {}

    register(bus: ICommandBus): void {
        registerDraftCommands(bus, this.options.flowStore, this.options.plugins);
        bus.register('plugin.dag.presentations', async () =>
            loadPresentations(this.options.plugins));
        bus.register('dag.run.start', async args => {
            const input = args as { sessionId: string; flow: FlowRevision };
            return this.start(input.sessionId, input.flow);
        });
        bus.register('dag.run.get', async args => this.snapshot(String((args as { taskId: string }).taskId)));
        bus.register('dag.run.cancel', async args => this.cancel(String((args as { taskId: string }).taskId)));
    }

    private async start(sessionId: string, flow: FlowRevision) {
        if (!sessionId) throw new Error('DAG run requires sessionId');
        const issues = validateFlowRevision(flow, this.options.plugins);
        if (issues.length) throw new Error(issues.map(issue => issue.message).join('; '));
        const handle = await new DurableFlowExecutor(this.options).submit(sessionId, flowToDag(flow));
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
        };
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
    bus.register('flow.draft.list', async () => store.listDrafts());
    bus.register('flow.draft.create', async args => store.createDraft(args as { id: string; name: string }));
    bus.register('flow.draft.load', async args => store.loadDraft(String((args as { id: string }).id)));
    bus.register('flow.draft.save', async args => saveDraft(
        store,
        plugins,
        args as { draft: FlowDraft; expectedDraftVersion: number },
    ));
    bus.register('flow.draft.validate', async args => validateDraft(args as FlowDraft, plugins));
    bus.register('flow.revision.create', async args => createRevision(
        store,
        plugins,
        args as { draftId: string; expectedDraftVersion: number },
    ));
    bus.register('flow.revision.get', async args => {
        const input = args as { id: string; revision?: number };
        return store.loadRevision(input.id, input.revision);
    });
    bus.register('flow.revision.list', async args =>
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
        createdAt: draft.updatedAt,
        digest: '',
    };
    const validationIssues = validateFlowRevision(revision, plugins);
    return { valid: validationIssues.length === 0, validationIssues };
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
