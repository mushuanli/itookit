import type {
    DagEdgeDefinition,
    DagNodeDefinition,
    DagRunSpec,
    GraphEffect,
} from '@itookit/common';

export type DagNodeStatus =
    | 'pending'
    | 'ready'
    | 'running'
    | 'waiting'
    | 'completed'
    | 'skipped'
    | 'failed'
    | 'cancelled';

export interface DagRuntimeState {
    nodes: Map<string, DagNodeDefinition>;
    edges: Map<string, DagEdgeDefinition>;
    edgeStates: Map<string, 'active' | 'disabled'>;
    nodeStates: Map<string, DagNodeStatus>;
    outputs: Map<string, Record<string, unknown>>;
    appliedPatchKeys: Set<string>;
}

export function createGraph(spec: DagRunSpec): DagRuntimeState {
    validateSpec(spec);
    return {
        nodes: new Map(spec.nodes.map(node => [node.id, structuredClone(node)])),
        edges: new Map(spec.edges.map(edge => [edge.id, structuredClone(edge)])),
        edgeStates: new Map(spec.edges.map(edge => [edge.id, 'active'])),
        nodeStates: new Map(spec.nodes.map(node => [node.id, 'pending'])),
        outputs: new Map(),
        appliedPatchKeys: new Set(),
    };
}

export function readyNodes(graph: DagRuntimeState): DagNodeDefinition[] {
    skipDisconnected(graph);
    return [...graph.nodes.values()].filter(node =>
        graph.nodeStates.get(node.id) === 'pending'
        && dependenciesCompleted(graph, node.id),
    );
}

export function nodeInputs(
    graph: DagRuntimeState,
    node: DagNodeDefinition,
): Record<string, unknown> {
    const inputs: Record<string, unknown> = structuredClone(node.inputs);
    for (const edge of incomingEdges(graph, node.id)) {
        if (graph.edgeStates.get(edge.id) === 'disabled') continue;
        const output = graph.outputs.get(edge.from)?.[edge.output];
        inputs[edge.input] = mergeInput(inputs[edge.input], output);
    }
    return inputs;
}

export function applyEffects(
    graph: DagRuntimeState,
    effects: GraphEffect[],
    maxNodes: number,
): void {
    for (const effect of effects) {
        if (effect.type === 'activate-edge') graph.edgeStates.set(String(effect.edgeId), 'active');
        if (effect.type === 'disable-edge') graph.edgeStates.set(String(effect.edgeId), 'disabled');
        if (effect.type === 'patch-graph') applyPatch(graph, effect.patch, maxNodes);
    }
}

export function terminalOutputs(graph: DagRuntimeState): Record<string, unknown> {
    return Object.fromEntries([...graph.nodes.keys()]
        .filter(id => !activeOutgoingEdges(graph, id).length)
        .filter(id => graph.nodeStates.get(id) === 'completed')
        .map(id => [id, structuredClone(graph.outputs.get(id) ?? {})]));
}

export function allSettled(graph: DagRuntimeState): boolean {
    return [...graph.nodeStates.values()].every(status =>
        status === 'completed' || status === 'skipped',
    );
}

export function validateSpec(spec: DagRunSpec): void {
    if (!spec.nodes.length) throw new Error('DAG requires at least one node');
    const ids = new Set<string>();
    for (const node of spec.nodes) {
        if (ids.has(node.id)) throw new Error(`Duplicate DAG node: ${node.id}`);
        if (!node.plugin || !node.pluginVersion) {
            throw new Error(`DAG node ${node.id} requires plugin and pluginVersion`);
        }
        ids.add(node.id);
    }
    validateEdges(spec.edges, ids);
    assertAcyclic(spec.nodes, spec.edges);
}

function validateEdges(edges: DagEdgeDefinition[], nodeIds: Set<string>): void {
    const edgeIds = new Set<string>();
    for (const edge of edges) {
        if (edgeIds.has(edge.id)) throw new Error(`Duplicate DAG edge: ${edge.id}`);
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
            throw new Error(`DAG edge ${edge.id} references an unknown node`);
        }
        if (edge.from === edge.to) throw new Error(`DAG edge ${edge.id} is a self edge`);
        edgeIds.add(edge.id);
    }
}

function assertAcyclic(nodes: DagNodeDefinition[], edges: DagEdgeDefinition[]): void {
    const indegree = new Map(nodes.map(node => [node.id, 0]));
    for (const edge of edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
    for (let index = 0; index < queue.length; index++) {
        for (const edge of edges.filter(item => item.from === queue[index])) {
            const next = (indegree.get(edge.to) ?? 0) - 1;
            indegree.set(edge.to, next);
            if (next === 0) queue.push(edge.to);
        }
    }
    if (queue.length !== nodes.length) throw new Error('DAG contains a cycle');
}

function dependenciesCompleted(graph: DagRuntimeState, nodeId: string): boolean {
    const incoming = incomingEdges(graph, nodeId)
        .filter(edge => graph.edgeStates.get(edge.id) === 'active');
    return incoming.every(edge => graph.nodeStates.get(edge.from) === 'completed');
}

function skipDisconnected(graph: DagRuntimeState): void {
    let changed = true;
    while (changed) {
        changed = false;
        for (const node of graph.nodes.values()) {
            if (!shouldSkip(graph, node.id)) continue;
            graph.nodeStates.set(node.id, 'skipped');
            changed = true;
        }
    }
}

function shouldSkip(graph: DagRuntimeState, nodeId: string): boolean {
    if (graph.nodeStates.get(nodeId) !== 'pending') return false;
    const incoming = incomingEdges(graph, nodeId);
    if (!incoming.length) return false;
    return incoming.every(edge =>
        graph.edgeStates.get(edge.id) === 'disabled'
        || graph.nodeStates.get(edge.from) === 'skipped',
    );
}

function incomingEdges(graph: DagRuntimeState, nodeId: string): DagEdgeDefinition[] {
    return [...graph.edges.values()].filter(edge => edge.to === nodeId);
}

function activeOutgoingEdges(graph: DagRuntimeState, nodeId: string): DagEdgeDefinition[] {
    return [...graph.edges.values()].filter(edge =>
        edge.from === nodeId && graph.edgeStates.get(edge.id) === 'active',
    );
}

function mergeInput(current: unknown, next: unknown): unknown {
    if (current === undefined) return structuredClone(next);
    return Array.isArray(current)
        ? [...current, structuredClone(next)]
        : [current, structuredClone(next)];
}

function applyPatch(
    graph: DagRuntimeState,
    patch: import('@itookit/common').GraphPatch,
    maxNodes: number,
): void {
    if (graph.appliedPatchKeys.has(patch.idempotencyKey)) return;
    if (graph.nodes.size + patch.nodes.length > maxNodes) {
        throw new Error(`DAG graph patch exceeds ${maxNodes} nodes`);
    }
    const nodes = patch.nodes.map(node => structuredClone(node));
    const edges = patch.edges.map(edge => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        output: edge.output ?? 'result',
        input: edge.input ?? 'input',
    }));
    validatePatchIds(graph, nodes, edges);
    for (const node of nodes) {
        graph.nodes.set(node.id, node);
        graph.nodeStates.set(node.id, 'pending');
    }
    for (const edge of edges) {
        graph.edges.set(edge.id, edge);
        graph.edgeStates.set(edge.id, 'active');
    }
    graph.appliedPatchKeys.add(patch.idempotencyKey);
}

function validatePatchIds(
    graph: DagRuntimeState,
    nodes: DagNodeDefinition[],
    edges: DagEdgeDefinition[],
): void {
    const nodeIds = new Set([...graph.nodes.keys(), ...nodes.map(node => node.id)]);
    if (nodeIds.size !== graph.nodes.size + nodes.length) {
        throw new Error('DAG graph patch contains duplicate nodes');
    }
    if (edges.some(edge => graph.edges.has(edge.id))) {
        throw new Error('DAG graph patch contains duplicate edges');
    }
    validateEdges(edges, nodeIds);
    assertAcyclic([...graph.nodes.values(), ...nodes], [...graph.edges.values(), ...edges]);
}
