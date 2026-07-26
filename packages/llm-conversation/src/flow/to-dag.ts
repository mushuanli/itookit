import type {
    DagRunSpec,
    FlowRevision,
    FlowNodeDefinition,
} from '@itookit/common';

export type FlowNodeBinder = (
    node: FlowNodeDefinition,
) => Partial<Pick<FlowNodeDefinition, 'config' | 'inputs' | 'capabilities' | 'budget'>>;

export function flowToDag(
    flow: FlowRevision,
    bind?: FlowNodeBinder,
): DagRunSpec {
    return {
        nodes: flow.nodes.map(node => {
            const patch = bind?.(node) ?? {};
            return {
                id: String(node.id),
                name: node.name,
                plugin: node.plugin,
                pluginVersion: node.pluginVersion,
                config: cloneJson(patch.config ?? node.config),
                inputs: cloneJson(patch.inputs ?? node.inputs),
                priority: node.priority,
                capabilities: [...(patch.capabilities ?? node.capabilities ?? [])],
                budget: {
                    ...(node.budget ?? {}),
                    ...(patch.budget ?? {}),
                },
            };
        }),
        edges: flow.edges.map(edge => ({
            id: String(edge.id),
            from: String(edge.from),
            to: String(edge.to),
            output: edge.output ?? 'result',
            input: edge.input ?? 'input',
        })),
    };
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value ?? null)) as T;
}
