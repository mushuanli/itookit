import type {
    DagNodeOutcome,
    GraphEffect,
    JsonValue,
    SerializableExpression,
} from '@itookit/common';

export function transformOutcome(
    config: Record<string, unknown>,
    inputs: Record<string, unknown>,
): DagNodeOutcome {
    const source = config.value ?? firstInput(inputs) ?? null;
    const content = config.operation === 'pick'
        ? pick(source, stringArray(config.path))
        : source;
    const outputName = string(config.outputName, 'result');
    return {
        outputs: {
            [outputName]: artifact(outputName, string(config.type, 'json'), content),
        },
    };
}

export function reduceOutcome(
    config: Record<string, unknown>,
    inputs: Record<string, unknown>,
): DagNodeOutcome {
    const values = Object.values(inputs).flatMap(value =>
        Array.isArray(value) ? value : [value],
    ).map(artifactContent);
    const type = string(config.type, 'json');
    const content = type === 'text'
        ? values.map(String).join(string(config.separator, '\n'))
        : values;
    const outputName = string(config.outputName, 'result');
    return { outputs: { [outputName]: artifact(outputName, type, content) } };
}

export function routeOutcome(
    config: Record<string, unknown>,
    inputs: Record<string, unknown>,
): DagNodeOutcome {
    const rules = Array.isArray(config.rules) ? config.rules.filter(isRecord) : [];
    const selected = selectEdges(rules, config, inputs);
    const all = rules.map(rule => String(rule.edgeId ?? ''));
    const effects: GraphEffect[] = [
        ...selected.map(edgeId => ({ type: 'activate-edge' as const, edgeId: edgeId as never })),
        ...all.filter(id => id && !selected.includes(id))
            .map(edgeId => ({ type: 'disable-edge' as const, edgeId: edgeId as never })),
    ];
    return { outputs: {}, effects };
}

export function graphPatchOutcome(
    config: Record<string, unknown>,
): DagNodeOutcome {
    const patch = isRecord(config.patch) ? config.patch : config;
    return {
        outputs: {},
        effects: [{
            type: 'patch-graph',
            patch: {
                idempotencyKey: string(patch.idempotencyKey, ''),
                nodes: Array.isArray(patch.nodes) ? patch.nodes as never : [],
                edges: Array.isArray(patch.edges) ? patch.edges as never : [],
            },
        }],
    };
}

function selectEdges(
    rules: Record<string, unknown>[],
    config: Record<string, unknown>,
    inputs: Record<string, unknown>,
): string[] {
    const mode = string(config.mode, 'exclusive');
    const selected: string[] = [];
    for (const rule of rules.sort(compareRule)) {
        const expression = rule.expression ?? asRecord(rule.condition).expression;
        if (!evaluate(expression as SerializableExpression, inputs)) continue;
        selected.push(String(rule.edgeId));
        if (mode !== 'multicast') break;
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
    if (expression.kind === 'in') return Array.isArray(expression.value)
        && expression.value.includes(resolve(expression.args?.[0], value) as JsonValue);
    return resolve(expression, value) !== undefined;
}

function resolve(expression: SerializableExpression | undefined, value: unknown): unknown {
    if (!expression) return undefined;
    if (expression.kind === 'literal') return expression.value;
    if (expression.kind !== 'path') return evaluate(expression, value);
    return pick(value, expression.path ?? []);
}

function artifact(outputName: string, type: string, content: unknown) {
    return {
        outputName,
        type: type as 'text' | 'json' | 'summary' | 'final-answer',
        content: content as never,
    };
}

function artifactContent(value: unknown): unknown {
    return isRecord(value) && 'content' in value ? value.content : value;
}

function firstInput(inputs: Record<string, unknown>): unknown {
    return artifactContent(Object.values(inputs)[0]);
}

function pick(value: unknown, path: string[]): unknown {
    let current = value;
    for (const part of path) current = asRecord(current)[part];
    return artifactContent(current);
}

function compareRule(left: Record<string, unknown>, right: Record<string, unknown>): number {
    return Number(left.priority ?? 0) - Number(right.priority ?? 0)
        || String(left.edgeId).localeCompare(String(right.edgeId));
}

function string(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
