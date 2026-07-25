import type {
    FlowDraft,
    FlowNodeId,
    TaskEdgeDefinition,
    TaskEdgeId,
    TaskKindDescriptor,
    TaskNodeDefinition,
} from '@itookit/common';

export interface DeleteNodeResult {
    nodeId: FlowNodeId;
    incidentEdgeCount: number;
}

export class TaskGraphDraftController {
    private draft: FlowDraft;
    private undoStack: FlowDraft[] = [];
    private redoStack: FlowDraft[] = [];

    constructor(draft: FlowDraft) {
        this.draft = clone(draft);
    }

    get value(): FlowDraft {
        return clone(this.draft);
    }

    replace(draft: FlowDraft): void {
        this.draft = clone(draft);
        this.undoStack = [];
        this.redoStack = [];
    }

    addNode(descriptor: TaskKindDescriptor, position?: { x: number; y: number }): TaskNodeDefinition {
        const node = createTaskNode(descriptor);
        this.change(draft => {
            draft.nodes.push(node);
            draft.layout.nodes = {
                ...draft.layout.nodes,
                [node.id]: position ?? autoPosition(draft.nodes.length - 1),
            };
        });
        return clone(node);
    }

    updateNode(node: TaskNodeDefinition): void {
        this.change(draft => {
            const index = draft.nodes.findIndex(item => item.id === node.id);
            if (index < 0) throw new Error(`Flow node not found: ${node.id}`);
            draft.nodes[index] = clone(node);
        });
    }

    duplicateNode(nodeId: FlowNodeId): TaskNodeDefinition {
        const source = this.requireNode(nodeId);
        const copy = { ...clone(source), id: uniqueId('node'), name: `${source.name} Copy` };
        this.change(draft => {
            draft.nodes.push(copy);
            const sourcePosition = draft.layout.nodes?.[nodeId] ?? { x: 40, y: 40 };
            draft.layout.nodes = {
                ...draft.layout.nodes,
                [copy.id]: { x: sourcePosition.x + 32, y: sourcePosition.y + 32 },
            };
        });
        return clone(copy);
    }

    deleteNode(nodeId: FlowNodeId): DeleteNodeResult {
        const incident = this.draft.edges.filter(edge => edge.from === nodeId || edge.to === nodeId);
        this.change(draft => {
            draft.nodes = draft.nodes.filter(node => node.id !== nodeId);
            for (const edge of incident) removeEdgeAndRouteRefs(draft, edge.id);
            if (draft.layout.nodes) delete draft.layout.nodes[nodeId];
        });
        return { nodeId, incidentEdgeCount: incident.length };
    }

    addEdge(edge: TaskEdgeDefinition): void {
        const error = edgeError(this.draft, edge);
        if (error) throw new Error(error);
        this.change(draft => draft.edges.push(clone(edge)));
    }

    updateEdge(edge: TaskEdgeDefinition): void {
        const withoutCurrent = { ...this.draft, edges: this.draft.edges.filter(item => item.id !== edge.id) };
        const error = edgeError(withoutCurrent, edge);
        if (error) throw new Error(error);
        this.change(draft => {
            const index = draft.edges.findIndex(item => item.id === edge.id);
            if (index < 0) throw new Error(`Flow edge not found: ${edge.id}`);
            draft.edges[index] = clone(edge);
        });
    }

    deleteEdge(edgeId: TaskEdgeId): void {
        this.change(draft => removeEdgeAndRouteRefs(draft, edgeId));
    }

    moveNode(nodeId: FlowNodeId, position: { x: number; y: number }): void {
        this.change(draft => {
            draft.layout.nodes = { ...draft.layout.nodes, [nodeId]: position };
        });
    }

    setZoom(zoom: number): void {
        this.change(draft => {
            const viewport = draft.layout.viewport ?? { x: 0, y: 0, zoom: 1 };
            draft.layout.viewport = { ...viewport, zoom: Math.min(2, Math.max(0.4, zoom)) };
        });
    }

    applyAutoLayout(): void {
        this.change(draft => {
            draft.layout.nodes = Object.fromEntries(
                topologicalOrder(draft).map((id, index) => [id, autoPosition(index)]),
            );
        });
    }

    undo(): boolean {
        const previous = this.undoStack.pop();
        if (!previous) return false;
        this.redoStack.push(clone(this.draft));
        this.draft = previous;
        return true;
    }

    redo(): boolean {
        const next = this.redoStack.pop();
        if (!next) return false;
        this.undoStack.push(clone(this.draft));
        this.draft = next;
        return true;
    }

    private requireNode(nodeId: FlowNodeId): TaskNodeDefinition {
        const node = this.draft.nodes.find(item => item.id === nodeId);
        if (!node) throw new Error(`Flow node not found: ${nodeId}`);
        return node;
    }

    private change(mutate: (draft: FlowDraft) => void): void {
        this.undoStack.push(clone(this.draft));
        this.redoStack = [];
        mutate(this.draft);
    }
}

export function createTaskNode(descriptor: TaskKindDescriptor): TaskNodeDefinition {
    return {
        id: uniqueId('node'),
        name: descriptor.displayName,
        handler: clone(descriptor.handler),
        inputPorts: clone(descriptor.defaultInputPorts),
        outputPorts: clone(descriptor.defaultOutputPorts),
        config: clone(descriptor.defaultConfig),
        joinPolicy: clone(descriptor.defaultJoinPolicy),
        retryPolicy: clone(descriptor.defaultRetryPolicy),
        resourcePolicy: descriptor.defaultResourcePolicy
            ? clone(descriptor.defaultResourcePolicy)
            : undefined,
    };
}

export function createTaskEdge(
    from: TaskNodeDefinition,
    to: TaskNodeDefinition,
    kind: 'control' | 'data',
): TaskEdgeDefinition {
    const edge: TaskEdgeDefinition = { id: uniqueId('edge') as TaskEdgeId, from: from.id, to: to.id, kind };
    if (kind === 'data') {
        const output = from.outputPorts[0];
        const input = to.inputPorts[0];
        if (!output || !input) throw new Error('Data edges require an output and input port');
        edge.binding = {
            outputName: output.name,
            inputName: input.name,
            mode: 'artifact',
            required: input.required,
        };
    }
    return edge;
}

function edgeError(draft: FlowDraft, edge: TaskEdgeDefinition): string | null {
    if (edge.from === edge.to) return 'Self edges are not allowed';
    const from = draft.nodes.find(node => node.id === edge.from);
    const to = draft.nodes.find(node => node.id === edge.to);
    if (!from || !to) return 'Edge references an unknown node';
    if (draft.edges.some(item => edgeKey(item) === edgeKey(edge))) return 'Duplicate edge is not allowed';
    if (edge.kind === 'data' && !validBinding(from, to, edge)) return 'Data edge ports are invalid';
    if (createsCycle(draft, edge)) return 'Edge would create a cycle';
    return null;
}

function validBinding(from: TaskNodeDefinition, to: TaskNodeDefinition, edge: TaskEdgeDefinition): boolean {
    return Boolean(
        from.outputPorts.some(port => port.name === edge.binding?.outputName)
        && to.inputPorts.some(port => port.name === edge.binding?.inputName),
    );
}

function createsCycle(draft: FlowDraft, candidate: TaskEdgeDefinition): boolean {
    const adjacency = new Map<string, string[]>();
    for (const edge of [...draft.edges, candidate]) {
        adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    }
    const seen = new Set<string>();
    const visit = (id: string): boolean => {
        if (id === candidate.from) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return (adjacency.get(id) ?? []).some(visit);
    };
    return visit(candidate.to);
}

function removeEdgeAndRouteRefs(draft: FlowDraft, edgeId: TaskEdgeId): void {
    draft.edges = draft.edges.filter(edge => edge.id !== edgeId);
    draft.nodes = draft.nodes.map(node => {
        if (node.handler.kind !== 'route' || !isRecord(node.config)) return node;
        const config = clone(node.config) as Record<string, unknown>;
        if (Array.isArray(config.rules)) {
            config.rules = config.rules.filter(rule => !isRecord(rule) || rule.edgeId !== edgeId);
        }
        if (config.defaultEdgeId === edgeId) delete config.defaultEdgeId;
        return { ...node, config: config as TaskNodeDefinition['config'] };
    });
}

function topologicalOrder(draft: FlowDraft): FlowNodeId[] {
    const pending = new Set(draft.nodes.map(node => node.id));
    const result: FlowNodeId[] = [];
    while (pending.size) {
        const next = [...pending].filter(id =>
            !draft.edges.some(edge => edge.to === id && pending.has(edge.from)),
        );
        const batch = next.length ? next : [pending.values().next().value as FlowNodeId];
        for (const id of batch) {
            pending.delete(id);
            result.push(id);
        }
    }
    return result;
}

function autoPosition(index: number): { x: number; y: number } {
    return { x: 40 + (index % 4) * 220, y: 40 + Math.floor(index / 4) * 150 };
}

function edgeKey(edge: TaskEdgeDefinition): string {
    return [edge.from, edge.to, edge.kind, edge.binding?.outputName, edge.binding?.inputName].join('|');
}

function uniqueId(prefix: string): string {
    const value = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${value}`;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
