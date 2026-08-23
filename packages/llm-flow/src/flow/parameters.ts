// @file: llm-flow/src/flow/parameters.ts
// Workflow runtime parameters: template resolution (${params.name}) and
// declared-schema validation. The "framework + variable inputs" split.

import type { FlowParameter, JsonValue } from '@itookit/common';
import type { ValidationIssue } from './validation';

/**
 * Deep-resolve `${params.name}` templates inside node config/inputs.
 * A value that is exactly one `${params.name}` keeps the parameter's native
 * type (number/boolean/json); otherwise substrings are replaced as text.
 */
export function resolveFlowParameters(
    value: unknown,
    parameters: Record<string, JsonValue>,
): unknown {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        const whole = /^\$\{params\.([A-Za-z0-9_.-]+)\}$/.exec(trimmed);
        if (whole && whole[1] in parameters) return parameters[whole[1]];
        return value.replace(/\$\{params\.([A-Za-z0-9_.-]+)\}/g, (_match, name: string) =>
            name in parameters ? stringifyParameter(parameters[name]) : `\${params.${name}}`);
    }
    if (Array.isArray(value)) return value.map(item => resolveFlowParameters(item, parameters));
    if (isRecord(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) =>
            [key, resolveFlowParameters(item, parameters)]));
    }
    return value;
}

/** Validate provided values against a workflow's declared parameter schema. */
export function validateFlowParameters(
    schema: FlowParameter[] | undefined,
    values: Record<string, JsonValue> | undefined,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const provided = values ?? {};
    for (const param of schema ?? []) {
        const present = param.name in provided && provided[param.name] !== undefined;
        if (param.required && !present) {
            issues.push({ code: 'missing-parameter', message: `Missing required parameter: ${param.name}` });
            continue;
        }
        if (!present) continue;
        if (!matchesParameterType(param.type, provided[param.name])) {
            issues.push({ code: 'invalid-parameter', message: `Parameter ${param.name} must be ${param.type}` });
        }
    }
    return issues;
}

function matchesParameterType(type: FlowParameter['type'], value: JsonValue): boolean {
    switch (type) {
        case 'string': return typeof value === 'string';
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'boolean': return typeof value === 'boolean';
        case 'json': return true;
    }
}

function stringifyParameter(value: JsonValue): string {
    if (value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
