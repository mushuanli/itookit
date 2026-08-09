import type { DagNodeOutcome, JsonValue, SerializableExpression } from '@itookit/common';

export function transformOutcome(
    config: Record<string, unknown>,
    inputs: Record<string, unknown>,
): DagNodeOutcome {
    const source = config.value ?? firstInput(inputs) ?? null;
    const content = config.operation === 'pick' ? pick(source, stringArray(config.path)) : source;
    return outcome(config, content);
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
    const all = rules.map(rule => String(rule.edgeId ?? '')).filter(Boolean);
    return {
        outputs: {},
        effects: [
            ...selected.map(edgeId => ({ type: 'activate-edge' as const, edgeId: edgeId as never })),
            ...all.filter(id => !selected.includes(id))
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
