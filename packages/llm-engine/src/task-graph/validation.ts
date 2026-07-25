import type {
    FlowRevision,
    TaskEdgeDefinition,
    TaskNodeDefinition,
    RouteTaskConfig,
    SerializableExpression,
} from '@itookit/common';
import { canonicalJson, digest } from './utils';

export interface ValidationIssue {
    code: string;
    message: string;
    nodeId?: string;
    edgeId?: string;
    severity?: 'error' | 'warning';
}

export function flowRevisionDigest(flow: Omit<FlowRevision, 'digest'>): string {
    return digest({
        id: flow.id,
        revision: flow.revision,
        name: flow.name,
        nodes: flow.nodes,
        edges: flow.edges,
    });
}

export function validateFlowRevision(flow: FlowRevision, knownHandlers?: ReadonlySet<string>): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const nodes = new Map<string, TaskNodeDefinition>();
    for (const node of flow.nodes) {
        if (nodes.has(node.id)) issues.push({ code: 'duplicate-node', message: `Duplicate node ${node.id}`, nodeId: node.id });
        nodes.set(node.id, node);
        validateNode(node, issues, knownHandlers);
    }

    const edges = new Set<string>();
    const edgeIds = new Set<string>();
    const incomingData = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    for (const edge of flow.edges) {
        if (edgeIds.has(String(edge.id))) issues.push({ code: 'duplicate-edge-id', message: `Duplicate edge id ${edge.id}`, edgeId: String(edge.id) });
        edgeIds.add(String(edge.id));
        const edgeKey = `${edge.from}|${edge.to}|${edge.kind}|${edge.binding?.outputName ?? ''}|${edge.binding?.inputName ?? ''}`;
        if (edges.has(edgeKey)) issues.push({ code: 'duplicate-edge', message: `Duplicate edge ${edge.id}`, edgeId: String(edge.id) });
        edges.add(edgeKey);
        if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
            issues.push({ code: 'unknown-edge-node', message: `Edge ${edge.id} references an unknown node`, edgeId: String(edge.id) });
            continue;
        }
        if (edge.from === edge.to) issues.push({ code: 'self-edge', message: `Edge ${edge.id} is a self-edge`, edgeId: String(edge.id) });
        adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
        validateEdge(edge, nodes.get(edge.from)!, nodes.get(edge.to)!, issues, incomingData);
    }
    validateRouteEdges(flow.nodes, flow.edges, issues);

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
        if (visiting.has(id)) {
            issues.push({ code: 'cycle', message: `Cycle detected at node ${id}`, nodeId: id });
            return;
        }
        if (visited.has(id)) return;
        visiting.add(id);
        for (const next of adjacency.get(id) ?? []) visit(next);
        visiting.delete(id);
        visited.add(id);
    };
    for (const id of nodes.keys()) visit(id);
    return deduplicateIssues(issues);
}

function validateRouteEdges(
    nodes: TaskNodeDefinition[],
    edges: TaskEdgeDefinition[],
    issues: ValidationIssue[],
): void {
    for (const node of nodes.filter(item => item.handler.kind === 'route')) {
        const config = node.config as unknown as Partial<RouteTaskConfig>;
        const outgoing = new Set(edges.filter(edge => edge.from === node.id).map(edge => String(edge.id)));
        for (const rule of config.rules ?? []) {
            if (!outgoing.has(String(rule.edgeId))) {
                issues.push({
                    code: 'unknown-route-edge',
                    message: `Route ${node.id} rule references unknown outgoing edge ${rule.edgeId}`,
                    nodeId: node.id,
                    edgeId: String(rule.edgeId),
                });
            }
        }
        if (config.defaultEdgeId && !outgoing.has(String(config.defaultEdgeId))) {
            issues.push({
                code: 'unknown-route-default',
                message: `Route ${node.id} default references unknown outgoing edge ${config.defaultEdgeId}`,
                nodeId: node.id,
                edgeId: String(config.defaultEdgeId),
            });
        }
    }
}

function validateNode(node: TaskNodeDefinition, issues: ValidationIssue[], knownHandlers?: ReadonlySet<string>): void {
    if (knownHandlers && !knownHandlers.has(handlerKey(node.handler))) {
        issues.push({ code: 'unknown-handler', message: `Handler ${handlerKey(node.handler)} is not registered`, nodeId: node.id });
    }
    if (!Number.isInteger(node.retryPolicy.maxAttempts) || node.retryPolicy.maxAttempts < 1) {
        issues.push({ code: 'invalid-retry', message: `Node ${node.id} must have maxAttempts >= 1`, nodeId: node.id });
    }
    const inputNames = new Set<string>();
    for (const port of node.inputPorts) {
        if (inputNames.has(port.name)) issues.push({ code: 'duplicate-input-port', message: `Duplicate input port ${port.name}`, nodeId: node.id });
        inputNames.add(port.name);
        if (!Number.isInteger(port.order) || port.order < 0) issues.push({ code: 'invalid-port-order', message: `Invalid input order ${port.name}`, nodeId: node.id });
    }
    const outputNames = new Set<string>();
    for (const port of node.outputPorts) {
        if (outputNames.has(port.name)) issues.push({ code: 'duplicate-output-port', message: `Duplicate output port ${port.name}`, nodeId: node.id });
        outputNames.add(port.name);
    }
    if (node.handler.kind === 'route') {
        const config = node.config as unknown as Partial<RouteTaskConfig>;
        if (config.mode === 'exclusive' && !config.defaultEdgeId) {
            issues.push({ code: 'missing-route-default', message: `Exclusive route ${node.id} needs a default edge`, nodeId: node.id });
        }
    }
}

function validateEdge(
    edge: TaskEdgeDefinition,
    from: TaskNodeDefinition,
    to: TaskNodeDefinition,
    issues: ValidationIssue[],
    incomingData: Map<string, number>,
): void {
    if (edge.condition) {
        for (const error of validateSerializableExpression(edge.condition.expression)) {
            issues.push({ code: 'invalid-route-expression', message: `${edge.id}: ${error}`, edgeId: String(edge.id) });
        }
    }
    if (edge.kind !== 'data') return;
    const outputName = edge.binding?.outputName;
    const inputName = edge.binding?.inputName;
    const output = from.outputPorts.find(port => port.name === outputName);
    const input = to.inputPorts.find(port => port.name === inputName);
    if (!output || !input) {
        issues.push({ code: 'incompatible-port', message: `Data edge ${edge.id} has incompatible ports`, edgeId: String(edge.id) });
        return;
    }
    if (input.cardinality === 'one') {
        const key = `${to.id}:${input.name}`;
        const count = (incomingData.get(key) ?? 0) + 1;
        incomingData.set(key, count);
        if (count > 1) issues.push({ code: 'one-port-overflow', message: `Input ${to.id}.${input.name} accepts one edge`, edgeId: String(edge.id) });
    }
    if (output.schema?.id && input.schema?.id && output.schema.id !== input.schema.id) {
        issues.push({ code: 'schema-mismatch', message: `Schema mismatch ${output.schema.id} -> ${input.schema.id}`, edgeId: String(edge.id) });
    }
}

export function validateSerializableExpression(expression: SerializableExpression): string[] {
    const errors: string[] = [];
    if (expression.kind === 'path' && (!expression.path || expression.path.some(part => !part))) errors.push('path expression requires non-empty path');
    if (['not', 'exists'].includes(expression.kind) && (expression.args?.length ?? 0) !== 1) errors.push(`${expression.kind} requires one argument`);
    if (['and', 'or', 'eq', 'neq', 'in'].includes(expression.kind) && !expression.args?.length) errors.push(`${expression.kind} requires arguments`);
    return errors;
}

export function handlerKey(handler: { kind: string; provider: string; version: string; schemaVersion: number }): string {
    return `${handler.provider}/${handler.kind}@${handler.version}#${handler.schemaVersion}`;
}

export function canonicalFlow(flow: Omit<FlowRevision, 'digest'>): string {
    return canonicalJson({ ...flow, layout: undefined });
}

function deduplicateIssues(issues: ValidationIssue[]): ValidationIssue[] {
    const seen = new Set<string>();
    return issues.filter(issue => {
        const key = `${issue.code}|${issue.nodeId ?? ''}|${issue.edgeId ?? ''}|${issue.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
