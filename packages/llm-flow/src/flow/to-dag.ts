import type {
    DagRunSpec,
    FlowRevision,
    FlowNodeDefinition,
} from '@itookit/common';
import { resolveNodeConnection } from './connections';

export type FlowNodeBinder = (
    node: FlowNodeDefinition,
) =>
    | Partial<Pick<FlowNodeDefinition, 'config' | 'inputs' | 'capabilities' | 'budget'>>
    | Promise<Partial<Pick<FlowNodeDefinition, 'config' | 'inputs' | 'capabilities' | 'budget'>>>;

export async function flowToDag(
    flow: FlowRevision,
    bind?: FlowNodeBinder,
    fallbackConnectionId?: string,
): Promise<DagRunSpec> {
    const nodes = await Promise.all(flow.nodes.map(async node => {
        const patch = (await bind?.(node)) ?? {};
        const config = cloneJson(patch.config ?? node.config);
        resolveNodeConnection(config, flow.connections, flow.defaultConnection, fallbackConnectionId);
        return {
            id: String(node.id),
            name: node.name,
            plugin: node.plugin,
            pluginVersion: node.pluginVersion,
            config,
            inputs: cloneJson(patch.inputs ?? node.inputs),
            priority: node.priority,
            capabilities: [...(patch.capabilities ?? node.capabilities ?? [])],
            budget: {
                ...(node.budget ?? {}),
                ...(patch.budget ?? {}),
            },
        };
    }));
    return {
        nodes,
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
