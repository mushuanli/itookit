import type {
    DagRunSpec,
    FlowRevision,
    FlowNodeDefinition,
} from '@itookit/common';
import { resolveNodeConnection } from './connections';
import { resolveFlowParameters } from './parameters';

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
    resolveComposite?: (id: string, revision?: number) => Promise<FlowRevision | null>,
    compositeStack: string[] = [],
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
            compensate: node.compensate ? String(node.compensate) : undefined,
            capabilities: [...(patch.capabilities ?? node.capabilities ?? [])],
            budget: {
                ...(node.budget ?? {}),
                ...(patch.budget ?? {}),
            },
        };
    }));
    const base: DagRunSpec = {
        nodes,
        edges: flow.edges.map(edge => ({
            id: String(edge.id),
            from: String(edge.from),
            to: String(edge.to),
            output: edge.output ?? 'result',
            input: edge.input ?? 'input',
            kind: edge.kind,
            onFailure: edge.onFailure,
        })),
        ...(flow.runPolicy ? {
            runPolicy: cloneJson(flow.runPolicy),
            maxNodes: flow.runPolicy.maxNodes,
            maxConcurrency: flow.runPolicy.maxConcurrency,
            timeoutMs: flow.runPolicy.timeoutMs,
            maxTokens: flow.runPolicy.maxTokens,
        } : {}),
    };
    return expandCompositeNodes(base, bind, fallbackConnectionId, resolveComposite, compositeStack);
}

async function expandCompositeNodes(
    spec: DagRunSpec,
    bind: FlowNodeBinder | undefined,
    fallbackConnectionId: string | undefined,
    resolveComposite: ((id: string, revision?: number) => Promise<FlowRevision | null>) | undefined,
    compositeStack: string[],
): Promise<DagRunSpec> {
    const composites = spec.nodes.filter(node => node.plugin === 'builtin.flow');
    if (!composites.length) return spec;
    if (!resolveComposite) throw new Error('Composite Flow nodes require a Flow revision resolver');
    const replacement = new Map<string, { entries: string[]; exits: string[] }>();
    const expandedNodes = spec.nodes.filter(node => node.plugin !== 'builtin.flow');
    const expandedEdges = spec.edges.filter(edge =>
        !composites.some(node => node.id === edge.from || node.id === edge.to));
    for (const composite of composites) {
        const config = isRecord(composite.config) ? composite.config : {};
        const flowId = typeof config.flowId === 'string' ? config.flowId : '';
        if (!flowId) throw new Error(`Composite node ${composite.id} requires flowId`);
        const revision = typeof config.revision === 'number' ? config.revision : undefined;
        const reference = `${flowId}@${revision ?? 'latest'}`;
        if (compositeStack.includes(reference)) {
            throw new Error(`Composite Flow cycle: ${[...compositeStack, reference].join(' -> ')}`);
        }
        const flow = await resolveComposite(flowId, revision);
        if (!flow) throw new Error(`Composite Flow not found: ${flowId}${revision ? `@${revision}` : ''}`);
        const child = await flowToDag(flow, bind, fallbackConnectionId, resolveComposite, [...compositeStack, reference]);
        if (!child.nodes.length) throw new Error(`Composite Flow is empty: ${flowId}`);
        const prefix = `${composite.id}/`;
        const childIds = new Set(child.nodes.map(node => node.id));
        const incoming = new Set(child.edges.map(edge => edge.to));
        const outgoing = new Set(child.edges.map(edge => edge.from));
        const entries = child.nodes.filter(node => !incoming.has(node.id)).map(node => `${prefix}${node.id}`);
        const exits = child.nodes.filter(node => !outgoing.has(node.id)).map(node => `${prefix}${node.id}`);
        const parameters = isRecord(config.parameters) ? config.parameters as Record<string, import('@itookit/common').JsonValue> : undefined;
        for (const node of child.nodes) {
            expandedNodes.push({
                ...node,
                id: `${prefix}${node.id}`,
                name: `${composite.name} / ${node.name}`,
                config: parameters ? resolveFlowParameters(node.config, parameters) : node.config,
                inputs: {
                    ...node.inputs,
                    ...(entries.includes(`${prefix}${node.id}`) ? composite.inputs : {}),
                },
                ...(node.compensate && childIds.has(node.compensate) ? { compensate: `${prefix}${node.compensate}` } : {}),
            });
        }
        expandedEdges.push(...child.edges.map(edge => ({
            ...edge, id: `${prefix}${edge.id}`, from: `${prefix}${edge.from}`, to: `${prefix}${edge.to}`,
        })));
        replacement.set(composite.id, { entries, exits });
    }
    for (const edge of spec.edges) {
        const sources = replacement.get(edge.from)?.exits ?? [edge.from];
        const targets = replacement.get(edge.to)?.entries ?? [edge.to];
        if (!replacement.has(edge.from) && !replacement.has(edge.to)) continue;
        for (const source of sources) for (const target of targets) {
            expandedEdges.push({ ...edge, id: `${edge.id}:${source}->${target}`, from: source, to: target });
        }
    }
    return { ...spec, nodes: expandedNodes, edges: expandedEdges };
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
