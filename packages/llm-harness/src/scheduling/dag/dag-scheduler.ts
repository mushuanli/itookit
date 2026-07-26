import type {
    DagNodeOutcome,
    DagPluginCatalog,
    DagRunSpec,
    DirectRunSpec,
    ProcessRecord,
    SchedulerContext,
    SchedulerModule,
    SchedulerRun,
    SchedulerSnapshot,
    SchedulerTransition,
} from '@itookit/common';
import {
    allSettled,
    applyEffects,
    createGraph,
    DagRuntimeState,
    nodeInputs,
    readyNodes,
    terminalOutputs,
} from './dag-graph';

const DEFAULT_MAX_NODES = 256;

export class DagScheduler implements SchedulerModule<DagRunSpec> {
    readonly kind = 'dag';

    constructor(private readonly plugins: DagPluginCatalog) {}

    async start(spec: DagRunSpec, context: SchedulerContext): Promise<SchedulerRun> {
        const run = new DagSchedulerRun(
            context.runId,
            structuredClone(spec),
            createGraph(spec),
            this.plugins,
        );
        await run.scheduleReady(context);
        return run;
    }

    async restore(
        snapshot: SchedulerSnapshot,
        context: SchedulerContext,
    ): Promise<SchedulerRun> {
        if (snapshot.kind !== this.kind) throw new Error(`Invalid DAG snapshot: ${snapshot.kind}`);
        const saved = snapshot.state as DagSchedulerSnapshot;
        const graph = restoreGraph(saved);
        const run = new DagSchedulerRun(
            context.runId,
            structuredClone(saved.spec),
            graph,
            this.plugins,
        );
        run.restoreProcesses(saved.processToNode);
        await run.scheduleReady(context);
        return run;
    }
}

class DagSchedulerRun implements SchedulerRun {
    private readonly processToNode = new Map<string, string>();
    private readonly nodeToProcess = new Map<string, string>();

    constructor(
        readonly runId: string,
        private readonly spec: DagRunSpec,
        private readonly graph: DagRuntimeState,
        private readonly plugins: DagPluginCatalog,
    ) {}

    get processIds(): readonly string[] {
        return [...this.processToNode.keys()];
    }

    async onProcessChanged(
        process: ProcessRecord,
        context: SchedulerContext,
    ): Promise<SchedulerTransition> {
        const nodeId = this.processToNode.get(process.id);
        if (!nodeId) return failure(`DAG received unknown process ${process.id}`);
        this.graph.nodeStates.set(nodeId, processStatus(process.status));
        if (process.status === 'failed') return failure(process.error?.message ?? 'DAG node failed');
        if (process.status === 'cancelled') return { type: 'cancelled' };
        if (process.status === 'completed') {
            await this.completeNode(nodeId, process.output);
            await this.scheduleReady(context);
            if (allSettled(this.graph)) {
                return { type: 'completed', output: { nodes: terminalOutputs(this.graph) } };
            }
        }
        return { type: 'status', status: aggregateStatus(this.graph) };
    }

    async scheduleReady(context: SchedulerContext): Promise<void> {
        for (const node of readyNodes(this.graph)) {
            await this.scheduleNode(node.id, context);
        }
    }

    snapshot(): SchedulerSnapshot {
        return {
            kind: 'dag',
            runId: this.runId,
            state: snapshotState(this.spec.maxNodes, this.graph, this.processToNode),
        };
    }

    restoreProcesses(entries: Array<[string, string]>): void {
        for (const [processId, nodeId] of entries) {
            this.processToNode.set(processId, nodeId);
            this.nodeToProcess.set(nodeId, processId);
        }
    }

    private async scheduleNode(nodeId: string, context: SchedulerContext): Promise<void> {
        if (this.nodeToProcess.has(nodeId)) return;
        const node = this.graph.nodes.get(nodeId)!;
        const manifest = this.plugins.getManifest(node.plugin, node.pluginVersion);
        if (!manifest) throw new Error(`DAG plugin not found: ${node.plugin}@${node.pluginVersion}`);
        const runtime = await this.plugins.loadRuntime(node.plugin, node.pluginVersion);
        const validation = runtime.validate?.(node.config);
        if (validation && !validation.valid) {
            throw new Error(`${node.id}: ${validation.errors.join('; ')}`);
        }
        const processId = createProcessId(this.runId, node.id);
        this.nodeToProcess.set(node.id, processId);
        this.processToNode.set(processId, node.id);
        this.graph.nodeStates.set(node.id, 'ready');
        await context.submitProcess(processSpec(
            runtime.createProcess({
                runId: this.runId,
                nodeRunId: node.id,
                config: node.config,
                inputs: nodeInputs(this.graph, node),
            }),
            processId,
            node,
            manifest.requiredCapabilities ?? [],
        ));
    }

    private async completeNode(nodeId: string, output: unknown): Promise<void> {
        const node = this.graph.nodes.get(nodeId);
        if (!node) throw new Error(`DAG node not found: ${nodeId}`);
        const runtime = await this.plugins.loadRuntime(node.plugin, node.pluginVersion);
        const outcome = runtime.mapOutput?.(output) ?? normalizeOutcome(output);
        this.graph.nodeStates.set(nodeId, 'completed');
        this.graph.outputs.set(nodeId, outcome.outputs);
        applyEffects(
            this.graph,
            outcome.effects ?? [],
            this.spec.maxNodes ?? DEFAULT_MAX_NODES,
        );
    }
}

interface DagSchedulerSnapshot {
    spec: DagRunSpec;
    nodeStates: Array<[string, import('./dag-graph').DagNodeStatus]>;
    edgeStates: Array<[string, 'active' | 'disabled']>;
    outputs: Array<[string, Record<string, unknown>]>;
    processToNode: Array<[string, string]>;
    appliedPatchKeys: string[];
}

function snapshotState(
    maxNodes: number | undefined,
    graph: DagRuntimeState,
    processToNode: Map<string, string>,
): DagSchedulerSnapshot {
    return {
        spec: {
            nodes: structuredClone([...graph.nodes.values()]),
            edges: structuredClone([...graph.edges.values()]),
            maxNodes,
        },
        nodeStates: structuredClone([...graph.nodeStates]),
        edgeStates: structuredClone([...graph.edgeStates]),
        outputs: structuredClone([...graph.outputs]),
        processToNode: [...processToNode],
        appliedPatchKeys: [...graph.appliedPatchKeys],
    };
}

function restoreGraph(snapshot: DagSchedulerSnapshot): DagRuntimeState {
    const graph = createGraph(snapshot.spec);
    graph.nodeStates = new Map(structuredClone(snapshot.nodeStates));
    graph.edgeStates = new Map(structuredClone(snapshot.edgeStates));
    graph.outputs = new Map(structuredClone(snapshot.outputs));
    graph.appliedPatchKeys = new Set(snapshot.appliedPatchKeys);
    return graph;
}

function processSpec(
    spec: DirectRunSpec,
    processId: string,
    node: import('@itookit/common').DagNodeDefinition,
    requiredCapabilities: string[],
): DirectRunSpec {
    return {
        ...spec,
        processId,
        priority: node.priority ?? spec.priority,
        capabilities: [...new Set([
            ...requiredCapabilities,
            ...(node.capabilities ?? []),
            ...(spec.capabilities ?? []),
        ])],
        budget: { ...(spec.budget ?? {}), ...(node.budget ?? {}) },
    };
}

function normalizeOutcome(output: unknown): DagNodeOutcome {
    if (isOutcome(output)) return structuredClone(output);
    return {
        outputs: {
            result: {
                outputName: 'result',
                type: 'json',
                content: output as never,
            },
        },
    };
}

function isOutcome(output: unknown): output is DagNodeOutcome {
    return Boolean(output)
        && typeof output === 'object'
        && Boolean((output as { outputs?: unknown }).outputs)
        && typeof (output as { outputs?: unknown }).outputs === 'object';
}

function aggregateStatus(graph: DagRuntimeState): 'ready' | 'running' | 'waiting' {
    const states = [...graph.nodeStates.values()];
    if (states.some(state => state === 'running')) return 'running';
    if (states.some(state => state === 'ready')) return 'ready';
    if (states.some(state => state === 'waiting')) return 'waiting';
    return 'ready';
}

function processStatus(status: ProcessRecord['status']) {
    if (status === 'created') return 'pending' as const;
    return status;
}

function failure(message: string): SchedulerTransition {
    return { type: 'failed', error: { message } };
}

function createProcessId(runId: string, nodeId: string): string {
    return `process-${runId}-${nodeId}`;
}
