import { simpleHash } from '@itookit/common';
import type { JsonValue } from '@itookit/common';

/** JSON canonicalization used by flow, input, artifact and state digests. */
export function canonicalJson(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function digest(value: unknown): string {
    return simpleHash(canonicalJson(value));
}

export function cloneJson<T extends JsonValue>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function stableArtifactSort(ids: string[], edgeOrder: number, edgeId: string): string[] {
    return [...ids].sort((a, b) => a.localeCompare(b) || edgeOrder - edgeOrder || edgeId.localeCompare(edgeId));
}

export function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

