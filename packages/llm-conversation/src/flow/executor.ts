import type {
    DagPluginCatalog,
    DagRunSpec,
    JsonValue as CommonJsonValue,
    ToolDefinition,
} from '@itookit/common';
import type {
    Harness,
    JsonValue,
    SessionHandle,
    TaskHandle,
    TaskSpec,
} from '@itookit/harness';

export interface FlowExecutionHandle {
    root: TaskHandle<JsonValue>;
    nodes: Map<string, TaskHandle>;
}

export interface DurableFlowExecutorOptions {
    harness: Harness;
    plugins: DagPluginCatalog;
    resolveTools?(sessionId: string, allowedIds: string[]): Promise<{
        definitions: ToolDefinition[];
        externalIds: string[];
    }>;
}

export class DurableFlowExecutor {
    constructor(private readonly options: DurableFlowExecutorOptions) {}

    async submit(sessionId: string, spec: DagRunSpec): Promise<FlowExecutionHandle> {
        const session = await this.options.harness.openSession(sessionId);
        const nodes = new Map<string, TaskHandle>();
        for (const node of topologicalNodes(spec)) {
            const incoming = spec.edges.filter(edge => edge.to === node.id);
            const dependencies = incoming.map(edge => ({
                taskId: requireTask(nodes, edge.from).id,
                input: edge.input,
                output: edge.output,
                edgeId: edge.id,
            }));
            const runtime = await this.options.plugins.loadRuntime(node.plugin, node.pluginVersion);
            const task = runtime.createTask({
                sessionId,
                nodeRunId: node.id,
                config: node.config,
                inputs: node.inputs,
                dependencies,
            });
            const handle = await session.submit(await this.taskSpec(sessionId, node, task, dependencies));
            nodes.set(node.id, handle);
            await this.bindCapabilities(handle, task.programKind, node.capabilities ?? []);
        }
        const root = await this.aggregate(session, nodes);
        return { root, nodes };
    }

    private async taskSpec(
        sessionId: string,
        node: DagRunSpec['nodes'][number],
        task: import('@itookit/common').DagTaskDefinition,
        dependencies: import('@itookit/common').DagTaskDependencyBinding[],
    ): Promise<TaskSpec<unknown>> {
        const allowed = node.capabilities ?? [];
        const catalog = await this.options.resolveTools?.(sessionId, allowed)
            ?? { definitions: [], externalIds: [] };
        const input = task.programKind === 'llm.agent'
            ? { ...record(task.input), tools: catalog.definitions, externalToolIds: catalog.externalIds }
            : task.input;
        return {
            program: { kind: task.programKind, version: task.programVersion },
            input: jsonValue(input),
            dependsOn: dependencies.map(binding => ({ task: binding.taskId })),
            retry: node.retry,
            priority: node.priority ?? task.priority,
            labels: { flowNodeId: node.id, plugin: node.plugin },
            deferStart: task.programKind === 'llm.agent' || task.programKind === 'llm.chat',
        };
    }

    private async bindCapabilities(
        task: TaskHandle,
        programKind: string,
        toolIds: string[],
    ): Promise<void> {
        if (programKind !== 'llm.agent' && programKind !== 'llm.chat') return;
        const llm = await task.createResource({
            kind: 'llm', uri: 'llm://flow', rights: ['execute'],
        });
        const tool = toolIds.length ? await task.createResource({
            kind: 'tool', uri: 'tool://flow', rights: ['execute'],
        }) : undefined;
        await task.signal({
            type: 'capabilities',
            payload: { llmHandleId: llm.handle.id, ...(tool ? { toolHandleId: tool.handle.id } : {}) },
        });
        await task.start();
    }

    private async aggregate(
        session: SessionHandle,
        nodes: Map<string, TaskHandle>,
    ): Promise<TaskHandle<JsonValue>> {
        const dependencies = [...nodes].map(([nodeId, task]) => ({ taskId: task.id, nodeId }));
        return session.submit({
            program: { kind: 'flow.aggregate', version: '1' },
            input: { dependencies },
            dependsOn: dependencies.map(item => ({ task: item.taskId })),
            labels: { kind: 'flow-root' },
        });
    }
}

function topologicalNodes(spec: DagRunSpec): DagRunSpec['nodes'] {
    const indegree = new Map(spec.nodes.map(node => [node.id, 0]));
    for (const edge of spec.edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
    for (let index = 0; index < queue.length; index++) {
        for (const edge of spec.edges.filter(item => item.from === queue[index])) {
            const next = (indegree.get(edge.to) ?? 0) - 1;
            indegree.set(edge.to, next);
            if (next === 0) queue.push(edge.to);
        }
    }
    if (queue.length !== spec.nodes.length) throw new Error('Flow contains a cycle');
    const byId = new Map(spec.nodes.map(node => [node.id, node]));
    return queue.map(id => byId.get(id)!);
}

function requireTask(tasks: Map<string, TaskHandle>, nodeId: string): TaskHandle {
    const task = tasks.get(nodeId);
    if (!task) throw new Error(`Flow dependency task is missing: ${nodeId}`);
    return task;
}

function jsonValue(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function record(value: unknown): Record<string, CommonJsonValue> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, CommonJsonValue>
        : {};
}
