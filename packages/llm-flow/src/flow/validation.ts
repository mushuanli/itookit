import type {
    DagPluginCatalog,
    FlowRevision,
    FlowConnection,
    JsonValue,
    FlowEdgeDefinition,
    FlowNodeDefinition,
} from '@itookit/common';
import { simpleHash } from '@itookit/common';
import { findCycles } from './graph';

export interface ValidationIssue {
    code: string;
    message: string;
    nodeId?: string;
    edgeId?: string;
    severity?: 'error' | 'warning';
}

export function flowRevisionDigest(flow: Omit<FlowRevision, 'digest'>): string {
    return simpleHash(canonicalJson({
        id: flow.id,
        revision: flow.revision,
        name: flow.name,
        nodes: flow.nodes,
        edges: flow.edges,
        parameters: flow.parameters,
        connections: flow.connections,
        defaultConnection: flow.defaultConnection,
    }));
}

export function validateFlowRevision(
    flow: FlowRevision,
    plugins?: DagPluginCatalog,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const nodes = validateNodes(flow.nodes, plugins, issues);
    validateEdges(flow.edges, nodes, plugins, issues);
    validateAcyclic(flow.nodes, flow.edges, issues);
    validateConnections(flow.connections, flow.defaultConnection, issues);
    return deduplicate(issues);
}

function validateNodes(
    definitions: FlowNodeDefinition[],
    plugins: DagPluginCatalog | undefined,
    issues: ValidationIssue[],
): Map<string, FlowNodeDefinition> {
    const nodes = new Map<string, FlowNodeDefinition>();
    for (const node of definitions) {
        if (nodes.has(node.id)) add(issues, 'duplicate-node', `Duplicate node ${node.id}`, node.id);
        nodes.set(node.id, node);
        const manifest = plugins?.getManifest(node.plugin, node.pluginVersion);
        if (plugins && !manifest) {
            add(issues, 'unknown-plugin', `Unknown plugin ${node.plugin}@${node.pluginVersion}`, node.id);
        }
        if (manifest) {
            for (const error of validateSchema(manifest.configSchema, node.config)) {
                add(issues, 'invalid-config', `${node.id}: ${error}`, node.id);
            }
        }
    }
    return nodes;
}

function validateEdges(
    edges: FlowEdgeDefinition[],
    nodes: Map<string, FlowNodeDefinition>,
    plugins: DagPluginCatalog | undefined,
    issues: ValidationIssue[],
): void {
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const edge of edges) {
        if (ids.has(String(edge.id))) edgeIssue(issues, 'duplicate-edge-id', edge, 'Duplicate edge id');
        ids.add(String(edge.id));
        const key = [edge.from, edge.to, edge.kind, edge.output, edge.input].join('|');
        if (keys.has(key)) edgeIssue(issues, 'duplicate-edge', edge, 'Duplicate edge');
        keys.add(key);
        const from = nodes.get(edge.from);
        const to = nodes.get(edge.to);
        if (!from || !to) edgeIssue(issues, 'unknown-edge-node', edge, 'Edge references an unknown node');
        else validatePorts(edge, from, to, plugins, issues);
        if (edge.from === edge.to) edgeIssue(issues, 'self-edge', edge, 'Self edges are forbidden');
    }
}

function validatePorts(
    edge: FlowEdgeDefinition,
    from: FlowNodeDefinition,
    to: FlowNodeDefinition,
    plugins: DagPluginCatalog | undefined,
    issues: ValidationIssue[],
): void {
    if (edge.kind !== 'data') return;
    if (!edge.output || !edge.input) {
        edgeIssue(issues, 'missing-port', edge, 'Data edge requires output and input');
        return;
    }
    const source = plugins?.getManifest(from.plugin, from.pluginVersion);
    const target = plugins?.getManifest(to.plugin, to.pluginVersion);
    if (source && !source.outputs.some(port => port.name === edge.output)) {
        edgeIssue(issues, 'unknown-output', edge, `Unknown output ${edge.output}`);
    }
    if (target && !target.inputs.some(port => port.name === edge.input)) {
        edgeIssue(issues, 'unknown-input', edge, `Unknown input ${edge.input}`);
    }
}

function validateAcyclic(
    nodes: FlowNodeDefinition[],
    edges: FlowEdgeDefinition[],
    issues: ValidationIssue[],
): void {
    // Loops are a first-class runtime feature (DurableFlowExecutor re-enters
    // loop nodes up to maxIterations). A cycle is therefore only a warning;
    // callers gate publish/run on hasValidationErrors() below, not on warnings.
    if (findCycles(nodes, edges).backEdges.size > 0) {
        issues.push({
            code: 'loop',
            severity: 'warning',
            message: 'Flow contains a loop (iterates up to maxIterations)',
        });
    }
}

/** True when any issue must block publish/run (warnings never block). */
export function hasValidationErrors(issues: ValidationIssue[]): boolean {
    return issues.some(issue => issue.severity !== 'warning');
}

function validateConnections(
    connections: FlowConnection[] | undefined,
    defaultConnection: string | undefined,
    issues: ValidationIssue[],
): void {
    const seen = new Set<string>();
    for (const connection of connections ?? []) {
        if (!connection.name?.trim()) {
            issues.push({ code: 'invalid-connection', message: 'Connection slot requires a name' });
            continue;
        }
        if (seen.has(connection.name)) {
            issues.push({ code: 'duplicate-connection', message: `Duplicate connection slot: ${connection.name}` });
        }
        seen.add(connection.name);
        if (!connection.connectionId?.trim()) {
            issues.push({ code: 'invalid-connection', message: `Connection ${connection.name} requires a connectionId` });
        }
    }
    if (defaultConnection && !seen.has(defaultConnection)) {
        issues.push({ code: 'invalid-default-connection', message: `defaultConnection ${defaultConnection} is not a defined connection slot` });
    }
}

function validateSchema(schema: JsonValue, value: JsonValue, path = '$'): string[] {
    if (!isRecord(schema)) return [];
    const errors: string[] = [];
    // A whole `${params.name}` placeholder is resolved at run time to the
    // parameter's native type, so skip static type checking for it here.
    if (typeof schema.type === 'string' && !isParameterTemplate(value) && !matchesType(schema.type, value)) {
        errors.push(`${path} must be ${schema.type}`);
    }
    if (Array.isArray(schema.required) && isRecord(value)) {
        for (const key of schema.required) {
            if (typeof key === 'string' && !(key in value)) errors.push(`${path}.${key} is required`);
        }
    }
    if (isRecord(schema.properties) && isRecord(value)) {
        for (const [key, child] of Object.entries(schema.properties)) {
            if (key in value) errors.push(...validateSchema(child, value[key], `${path}.${key}`));
        }
    }
    return errors;
}

function matchesType(type: string, value: JsonValue): boolean {
    if (type === 'object') return isRecord(value);
    if (type === 'array') return Array.isArray(value);
    if (type === 'null') return value === null;
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'number') return typeof value === 'number';
    return typeof value === type;
}

/** True when the value is exactly one `${params.path}` template placeholder. */
function isParameterTemplate(value: JsonValue): boolean {
    return typeof value === 'string' && /^\$\{params\.([A-Za-z0-9_.-]+)\}$/.test(value.trim());
}

function canonicalJson(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort()
        .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function add(
    issues: ValidationIssue[],
    code: string,
    message: string,
    nodeId: string,
): void {
    issues.push({ code, message, nodeId });
}

function edgeIssue(
    issues: ValidationIssue[],
    code: string,
    edge: FlowEdgeDefinition,
    message: string,
): void {
    issues.push({ code, message: `${message}: ${edge.id}`, edgeId: String(edge.id) });
}

function deduplicate(issues: ValidationIssue[]): ValidationIssue[] {
    const seen = new Set<string>();
    return issues.filter(issue => {
        const key = `${issue.code}|${issue.nodeId}|${issue.edgeId}|${issue.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
