import type { FlowNodeId } from './flow';
import type { LlmNodeConfig } from '../llm/node-config';

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
    kind: 'literal' | 'path' | 'param' | 'not' | 'and' | 'or' | 'eq' | 'neq' | 'in' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';
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
    /** Declared runtime parameters (editable in the designer, frozen into revisions). */
    parameters?: FlowParameter[];
    /** Named connection slots; nodes reference a slot by name (default = defaultConnection). */
    connections?: FlowConnection[];
    /** Connection slot name used when a node does not specify one. */
    defaultConnection?: string;
    /** Flow-level system prompt segments (default base for nodes without agentId). */
    systemPrompt?: string[];
    /** Flow-level tool ids (union with node toolIds). */
    toolIds?: string[];
    updatedAt: number;
}

/**
 * A runtime parameter a workflow declares in its "signature". Node config/inputs
 * reference it via the `${params.<name>}` template; each run supplies a value.
 */
export interface FlowParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'json';
    required?: boolean;
    default?: JsonValue;
    description?: string;
}

/**
 * A named connection slot a workflow defines (e.g. `default`, `economy`,
 * `premium`). Each slot binds a global LLMConnection.id; nodes reference the
 * slot by `name` in their `config.connectionId`. The workflow-level
 * `defaultConnection` is used when a node does not name one.
 */
export interface FlowConnection {
    name: string;
    connectionId: string;
    description?: string;
}

/** Sub-task fan-out declaration: the agent calls `tool` and each returned payload instantiates `template`. */
export interface SubtaskDecl {
    tool: string;
    template: FlowNodeDefinition;
    max?: number;
}

/**
 * Config of a `builtin.agent` node: a unified LlmNodeConfig (references to
 * system prompt / tools / skills / connection + inline additions) plus a
 * `agentId` shortcut that inherits one Agent's whole reference set at once.
 */
export interface FlowAgentNodeConfig extends Partial<LlmNodeConfig> {
    agentId?: string;
    subtasks?: SubtaskDecl;
}

export interface FlowRevision {
    id: FlowId;
    revision: number;
    name: string;
    nodes: FlowNodeDefinition[];
    edges: FlowEdgeDefinition[];
    /** Declared runtime parameters (the workflow's variable inputs). */
    parameters?: FlowParameter[];
    /** Named connection slots (frozen into the revision). */
    connections?: FlowConnection[];
    /** Connection slot name used when a node does not specify one. */
    defaultConnection?: string;
    /** Flow-level system prompt segments (frozen into the revision). */
    systemPrompt?: string[];
    /** Flow-level tool ids (frozen into the revision). */
    toolIds?: string[];
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
