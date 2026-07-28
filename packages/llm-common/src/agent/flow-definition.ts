import type { FlowNodeId } from './flow';

export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type FlowId = Brand<string, 'FlowId'>;
export type FlowEdgeId = Brand<string, 'FlowEdgeId'>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
    | JsonPrimitive
    | JsonValue[]
    | { [key: string]: JsonValue };

export interface JsonSchemaRef {
    id: string;
    version?: string;
}

export interface InputPortSpec {
    name: string;
    schema?: JsonSchemaRef;
    cardinality: 'one' | 'many';
    required: boolean;
    order: number;
}

export interface OutputPortSpec {
    name: string;
    schema?: JsonSchemaRef;
    required: boolean;
    order: number;
}

export interface SerializableExpression {
    kind: 'literal' | 'path' | 'not' | 'and' | 'or' | 'eq' | 'neq' | 'in' | 'exists';
    value?: JsonValue;
    path?: string[];
    args?: SerializableExpression[];
}

export interface FlowEdgeDefinition {
    id: FlowEdgeId;
    from: FlowNodeId;
    to: FlowNodeId;
    kind: 'control' | 'data';
    order?: number;
    output?: string;
    input?: string;
}

export interface FlowNodeDefinition {
    id: FlowNodeId;
    name: string;
    plugin: string;
    pluginVersion: string;
    config: JsonValue;
    inputs: Record<string, JsonValue>;
    priority?: number;
    capabilities?: string[];
    budget?: Record<string, number>;
}

export interface FlowLayout {
    nodes?: Record<string, { x: number; y: number }>;
    viewport?: { x: number; y: number; zoom: number };
}

export interface FlowDraft {
    id: FlowId;
    draftVersion: number;
    baseRevision?: number;
    name: string;
    nodes: FlowNodeDefinition[];
    edges: FlowEdgeDefinition[];
    layout: FlowLayout;
    updatedAt: number;
}

export interface FlowRevision {
    id: FlowId;
    revision: number;
    name: string;
    nodes: FlowNodeDefinition[];
    edges: FlowEdgeDefinition[];
    createdAt: number;
    digest: string;
}

export interface BlobRef {
    uri: string;
    contentHash?: string;
    size?: number;
    mimeType?: string;
}

export type ArtifactContent =
    | string
    | JsonValue
    | Record<string, unknown>
    | BlobRef;

export interface Artifact {
    id: string;
    runId?: string;
    nodeRunId?: string;
    outputName: string;
    type: 'final-answer' | 'summary' | 'file' | 'json' | 'text' | 'control';
    content: ArtifactContent;
    contentHash: string;
    createdAt: number;
    metadata?: Record<string, JsonValue>;
}

export interface ArtifactDraft {
    outputName: string;
    type: 'text' | 'json' | 'file' | 'summary' | 'final-answer' | 'control';
    schema?: JsonSchemaRef;
    content: ArtifactContent;
    metadata?: Record<string, JsonValue>;
}

export function parseFlowId(value: string): FlowId {
    if (!value || value.includes('/') || value.includes('\\')) {
        throw new Error('Invalid FlowId');
    }
    return value as FlowId;
}
