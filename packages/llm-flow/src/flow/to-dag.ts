import type {
    DagRunSpec,
    FlowRevision,
    FlowNodeDefinition,
} from '@itookit/common';
import { resolveNodeConnection } from './connections';

export type FlowNodeBinder = (
    node: FlowNodeDefinition,
    flowDefaults?: FlowNodeDefinition['config'],
) =>
    | Partial<Pick<FlowNodeDefinition, 'config' | 'inputs' | 'capabilities' | 'budget'>>
    | Promise<Partial<Pick<FlowNodeDefinition, 'config' | 'inputs' | 'capabilities' | 'budget'>>>;

export async function flowToDag(
    flow: FlowRevision,
    bind?: FlowNodeBinder,
    fallbackConnectionId?: string,
): Promise<DagRunSpec> {
    const nodes = await Promise.all(flow.nodes.map(async node => {
        const defaults = node.plugin === 'builtin.agent' ? flowAgentDefaults(flow) : undefined;
        const patch = (await bind?.(node, defaults as FlowNodeDefinition['config'])) ?? {};
        const config = cloneJson((patch.config ?? (defaults ? mergeAgentConfig(defaults, node.config) : node.config)) as FlowNodeDefinition['config']);
        resolveNodeConnection(config, flow.connections, flow.defaultConnection, fallbackConnectionId);
        return {
            id: String(node.id),
            name: node.name,
            plugin: node.plugin,
            pluginVersion: node.pluginVersion,
            config,
            inputs: cloneJson(patch.inputs ?? node.inputs),
            priority: node.priority,
            retry: node.retry,
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
            kind: edge.kind,
        })),
    };
}

/** Apply Flow defaults before the session/agent binder applies its higher layers. */
function flowAgentDefaults(flow: FlowRevision): Record<string, unknown> {
    const defaults = isRecord(flow.defaults) ? { ...flow.defaults } : {};
    return {
        ...defaults,
        systemPrompt: [
            ...(Array.isArray(flow.systemPrompt) ? flow.systemPrompt : []),
            ...(Array.isArray(defaults.systemPrompt) ? defaults.systemPrompt : []),
        ],
        toolIds: [...new Set([
            ...(Array.isArray(flow.toolIds) ? flow.toolIds : []),
            ...(Array.isArray(defaults.toolIds) ? defaults.toolIds : []),
        ].map(String))],
    };
}

function mergeAgentConfig(defaultsValue: Record<string, unknown>, nodeConfig: FlowNodeDefinition['config']): Record<string, unknown> {
    const defaults = defaultsValue;
    const node = isRecord(nodeConfig) ? nodeConfig : {};
    const defaultPrompt = Array.isArray(defaults.systemPrompt) ? defaults.systemPrompt : [];
    const nodePrompt = Array.isArray(node.systemPrompt) ? node.systemPrompt : [];
    const defaultTools = Array.isArray(defaults.toolIds) ? defaults.toolIds : [];
    const nodeTools = Array.isArray(node.toolIds) ? node.toolIds : [];
    return {
        ...defaults,
        ...node,
        systemPrompt: [...defaultPrompt, ...nodePrompt],
        toolIds: [...new Set([...defaultTools, ...nodeTools].map(String))],
        skillIds: [...new Set([
            ...(Array.isArray(defaults.skillIds) ? defaults.skillIds : []),
            ...(Array.isArray(node.skillIds) ? node.skillIds : []),
        ].map(String))],
    };
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
