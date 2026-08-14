import type { DagNodeOutcome, JsonValue, SerializableExpression } from '@itookit/common';

export function transformOutcome(
    config: Record<string, unknown>,
    inputs: Record<string, unknown>,
): DagNodeOutcome {
    const source = config.value ?? firstInput(inputs) ?? null;
    const content = config.operation === 'pick' ? pick(source, stringArray(config.path)) : source;
    return outcome(config, content);
}

/** 产出本节点的输出，并附带 patch-graph effect 动态添加节点/边。 */
export function spawnOutcome(
    config: Record<string, unknown>,
    inputs: Record<string, unknown>,
): DagNodeOutcome {
    const base = transformOutcome(config, inputs);
    const spawn = record(config.spawn);
    const patch = {
        idempotencyKey: string(spawn.idempotencyKey, 'spawn'),
        nodes: Array.isArray(spawn.nodes) ? spawn.nodes.filter(isRecord) : [],
        edges: Array.isArray(spawn.edges)
            ? spawn.edges.filter(isRecord).map(edge => ({
                ...(edge.id !== undefined ? { id: String(edge.id) } : {}),
                from: String(edge.from ?? ''),
                to: String(edge.to ?? ''),
                ...(edge.input !== undefined ? { input: String(edge.input) } : {}),
                ...(edge.output !== undefined ? { output: String(edge.output) } : {}),
            }))
            : [],
    };
    return { ...base, effects: [{ type: 'patch-graph' as const, patch: patch as never }] };
}

export function reduceOutcome(
    config: Record<string, unknown>,
    inputs: Record<string, unknown>,
): DagNodeOutcome {
    const values = Object.values(inputs).flatMap(value => Array.isArray(value) ? value : [value])
        .map(artifactContent);
    const content = config.type === 'text'
        ? values.map(String).join(string(config.separator, '\n'))
        : values;
    return outcome(config, content);
}

export function routeOutcome(
    config: Record<string, unknown>,
    inputs: Record<string, unknown>,
): DagNodeOutcome {
    const rules = Array.isArray(config.rules) ? config.rules.filter(isRecord) : [];
    const selected = selectEdges(rules, config, inputs);
    const defaultEdgeId = typeof config.defaultEdgeId === 'string' ? config.defaultEdgeId : '';
    // 待决定边 = 所有规则边 + 默认边；未选中的一律禁用（含默认边，当规则命中时）。
    const candidates = [...rules.map(rule => String(rule.edgeId ?? '')), defaultEdgeId].filter(Boolean);
    return {
        outputs: {},
        effects: [
            ...selected.map(edgeId => ({ type: 'activate-edge' as const, edgeId: edgeId as never })),
            ...candidates.filter(id => !selected.includes(id))
                .map(edgeId => ({ type: 'disable-edge' as const, edgeId: edgeId as never })),
        ],
    };
}

function outcome(config: Record<string, unknown>, content: unknown): DagNodeOutcome {
    const outputName = string(config.outputName, 'result');
    return {
        outputs: {
            [outputName]: {
                outputName,
                type: string(config.type, 'json') as 'text' | 'json',
                content: cloneJson(content),
            },
        },
    };
}

function selectEdges(
    rules: Record<string, unknown>[],
    config: Record<string, unknown>,
    inputs: Record<string, unknown>,
): string[] {
    const selected: string[] = [];
    for (const rule of rules.sort(compareRule)) {
        const expression = rule.expression ?? record(rule.condition).expression;
        if (!evaluate(expression as SerializableExpression, inputs)) continue;
        selected.push(String(rule.edgeId));
        if (config.mode !== 'multicast') break;
    }
    if (!selected.length && config.defaultEdgeId) selected.push(String(config.defaultEdgeId));
    return selected;
}

function evaluate(expression: SerializableExpression | undefined, value: unknown): boolean {
    if (!expression) return false;
    if (expression.kind === 'literal') return Boolean(expression.value);
    if (expression.kind === 'exists') return resolve(expression.args?.[0], value) !== undefined;
    if (expression.kind === 'not') return !evaluate(expression.args?.[0], value);
    if (expression.kind === 'and') return (expression.args ?? []).every(item => evaluate(item, value));
    if (expression.kind === 'or') return (expression.args ?? []).some(item => evaluate(item, value));
    if (expression.kind === 'eq') return resolve(expression.args?.[0], value) === resolve(expression.args?.[1], value);
    if (expression.kind === 'neq') return resolve(expression.args?.[0], value) !== resolve(expression.args?.[1], value);
    if (expression.kind === 'in') {
        return Array.isArray(expression.value)
            && expression.value.includes(resolve(expression.args?.[0], value) as JsonValue);
    }
    return resolve(expression, value) !== undefined;
}

function resolve(expression: SerializableExpression | undefined, value: unknown): unknown {
    if (!expression) return undefined;
    if (expression.kind === 'literal') return expression.value;
    return expression.kind === 'path' ? pick(value, expression.path ?? []) : evaluate(expression, value);
}

function firstInput(inputs: Record<string, unknown>): unknown {
    return artifactContent(Object.values(inputs)[0]);
}

function artifactContent(value: unknown): unknown {
    return isRecord(value) && 'content' in value ? value.content : value;
}

function pick(value: unknown, path: string[]): unknown {
    let current = value;
    for (const part of path) current = record(current)[part];
    return artifactContent(current);
}

function compareRule(left: Record<string, unknown>, right: Record<string, unknown>): number {
    return Number(left.priority ?? 0) - Number(right.priority ?? 0)
        || String(left.edgeId).localeCompare(String(right.edgeId));
}

function string(value: unknown, fallback: string): string { return typeof value === 'string' ? value : fallback; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : []; }
function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function cloneJson(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value ?? null)) as JsonValue; }
