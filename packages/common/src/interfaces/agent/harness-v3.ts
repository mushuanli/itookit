/**
 * Harness v3 contracts.
 *
 * These contracts deliberately use TaskRun as the scheduler node.
 * Legacy records are accepted only by the explicit offline migration module;
 * the runtime itself uses TaskRun and TaskGraphRun exclusively.
 */

import type { ChatMessage } from '../llm/message';
import type { ContextSnapshotId, InputBinding } from './context-types';
import type { RoundId } from './loop';

export type Brand<T, N extends string> = T & { readonly __brand: N };
export type GoalIdV3 = Brand<string, 'GoalId'>;
export type GoalId = GoalIdV3;
export type FlowId = Brand<string, 'FlowId'>;
export type FlowNodeIdV3 = Brand<string, 'FlowNodeId'>;
export type FlowRevisionId = Brand<string, 'FlowRevisionId'>;
export type TaskGraphRunId = Brand<string, 'TaskGraphRunId'>;
export type TaskRunId = Brand<string, 'TaskRunId'>;
export type TaskAttemptId = Brand<string, 'TaskAttemptId'>;
export type TaskEdgeId = Brand<string, 'TaskEdgeId'>;
export type ArtifactId = Brand<string, 'ArtifactId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type AgentStateRevisionId = Brand<string, 'AgentStateRevisionId'>;
export type ContextSnapshotIdV3 = Brand<string, 'ContextSnapshotId'>;

export interface SerializedError {
    message: string;
    code?: string;
    stack?: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export interface JsonSchemaRef {
    id: string;
    version?: string;
}

export type BuiltinTaskKind =
    | 'agent'
    | 'route'
    | 'transform'
    | 'reduce'
    | 'human'
    | 'subflow'
    | 'spawn';
export type TaskKind = BuiltinTaskKind | `plugin:${string}`;

export interface TaskHandlerRef {
    kind: TaskKind;
    provider: 'builtin' | string;
    version: string;
    schemaVersion: number;
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

export type JoinPolicy =
    | { kind: 'all-success' }
    | { kind: 'all-done'; allowFailed: boolean }
    | { kind: 'any-success' }
    | { kind: 'quorum'; minimum: number }
    | { kind: 'race'; cancelRemaining: boolean };

export interface RetryPolicy {
    maxAttempts: number;
    backoff?: { kind: 'none' | 'fixed' | 'exponential'; baseMs?: number; maxMs?: number };
    retryOn?: string[];
    requireConfirmationForNonIdempotent?: boolean;
}

export interface ResourcePolicy {
    concurrencyKey?: string;
    sideEffect?: 'none' | 'idempotent' | 'non-idempotent';
    timeoutMs?: number;
    priority?: number;
    estimatedCost?: number;
}

export interface SerializableExpression {
    kind: 'literal' | 'path' | 'not' | 'and' | 'or' | 'eq' | 'neq' | 'in' | 'exists';
    value?: JsonValue;
    path?: string[];
    args?: SerializableExpression[];
}

export interface RouteCondition {
    source: { kind: 'status' } | { kind: 'artifact'; outputName: string };
    expression: SerializableExpression;
}

export interface TaskEdgeDefinition {
    id: TaskEdgeId;
    from: import('./flow').FlowNodeId;
    to: import('./flow').FlowNodeId;
    kind: 'control' | 'data';
    order?: number;
    binding?: {
        outputName: string;
        inputName: string;
        mode: 'artifact' | 'summary' | 'full-rounds';
        required: boolean;
        projector?: ArtifactProjectorRef;
    };
    condition?: RouteCondition;
}

export interface TaskNodeDefinition {
    id: import('./flow').FlowNodeId;
    name: string;
    handler: TaskHandlerRef;
    inputPorts: InputPortSpec[];
    outputPorts: OutputPortSpec[];
    config: JsonValue;
    joinPolicy: JoinPolicy;
    retryPolicy: RetryPolicy;
    resourcePolicy?: ResourcePolicy;
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
    nodes: TaskNodeDefinition[];
    edges: TaskEdgeDefinition[];
    layout: FlowLayout;
    updatedAt: number;
}

export interface FlowRevision {
    id: FlowId;
    revision: number;
    name: string;
    nodes: TaskNodeDefinition[];
    edges: TaskEdgeDefinition[];
    createdAt: number;
    digest: string;
}

export interface AgentTaskConfig {
    agent: { id: AgentId; version: string };
    prompt: string;
    contextPolicy: TaskContextPolicy;
    statePolicy: AgentStatePolicy;
    loopMode: 'chat' | 'loop' | 'harness';
}

export interface ModelPolicy {
    connectionId?: string;
    modelName?: string;
    modelTier?: string;
    temperature?: number;
    thinking?: boolean;
    reasoningEffort?: string;
}

export interface MemoryPolicy {
    namespace: string;
    readScopes: string[];
    writeScopes: string[];
    retrievalLimit?: number;
}

/** Exact v3 definition shape used by TaskRun freezing. */
export interface HarnessAgentDefinition {
    id: AgentId;
    version: string;
    name: string;
    modelPolicy: ModelPolicy;
    systemPrompt: string;
    capabilityPolicy: { toolIds: string[]; mcpProfileIds: string[] };
    memoryPolicy: MemoryPolicy;
    defaultContextPolicy: { tokenBudget?: number; automaticCompression?: boolean };
}

export type AgentDefinitionV3 = HarnessAgentDefinition;

export type AgentStatePolicy =
    | { mode: 'stateless' }
    | { mode: 'read-snapshot'; namespace: string; revision?: number }
    | { mode: 'fork'; namespace: string; fromRevision?: number; targetNamespace: string }
    | { mode: 'compare-and-swap'; namespace: string; expectedRevision?: number }
    | { mode: 'exclusive-update'; namespace: string; concurrencyKey: string };

export interface AgentStateRevision {
    id: AgentStateRevisionId;
    agentId: AgentId;
    namespace: string;
    revision: number;
    parentRevision?: number;
    values: Record<string, JsonValue>;
    memoryRefs: string[];
    createdAt: number;
    createdByTaskRunId?: TaskRunId;
    digest: string;
}

export type StateOperation =
    | { kind: 'set'; path: string[]; value: JsonValue }
    | { kind: 'delete'; path: string[] }
    | { kind: 'merge'; path: string[]; value: Record<string, JsonValue> };

export interface AgentStatePatch {
    agentId: AgentId;
    namespace: string;
    baseRevision: number;
    operations: StateOperation[];
}

export interface MemoryWrite {
    namespace: string;
    key: string;
    content: string;
    metadata?: Record<string, JsonValue>;
}

export interface AgentExecutionRecord {
    definition: { id: AgentId; version: string };
    state?: { namespace: string; revision: number; digest: string };
    contextSnapshotId: ContextSnapshotId;
    finalRoundId?: RoundId;
    exchangeCount: number;
}

export type TaskContextPolicy =
    | { mode: 'isolated' }
    | { mode: 'branch'; branchRef?: string; profileRevision?: number }
    | { mode: 'selected'; baseProfileRevision: number; patch: ContextProfilePatch }
    | { mode: 'continuation'; sourceTaskRunId: TaskRunId };

export interface ContextProfilePatch {
    include?: string[];
    exclude?: string[];
    summaries?: Record<string, string>;
}

export interface ResolvedInputPort {
    port: InputPortSpec;
    artifacts: string[];
    bindings: InputBinding[];
}

export interface V3ContextPlan {
    taskRunId: TaskRunId;
    agent: { id: AgentId; version: string };
    agentState?: { namespace: string; revision: number };
    conversation?: {
        branchRef: string;
        branchHead: RoundId | null;
        profile: { id: string; revision: number };
    };
    resolvedInputs: ResolvedInputPort[];
    pendingUserMessage?: ChatMessage;
    tokenPolicy: { maxTokens?: number; reserve?: number };
}

export interface ContextDecision {
    source: string;
    reason: string;
    priority: number;
    required: boolean;
    tokenCount: number;
}

export interface ContextExplanation {
    included: ContextDecision[];
    excluded: ContextDecision[];
    summarized: ContextDecision[];
    tokenCount: number;
    digest: string;
}

export interface TaskRunSpec {
    id: TaskRunId;
    sourceNodeId?: import('./flow').FlowNodeId;
    handler: TaskHandlerRef;
    inputPorts: InputPortSpec[];
    outputPorts: OutputPortSpec[];
    explicitInputs: InputBinding[];
    config: JsonValue;
    joinPolicy: JoinPolicy;
    retryPolicy: RetryPolicy;
    resourcePolicy?: ResourcePolicy;
}

export type TaskRunStatus =
    | 'pending'
    | 'ready'
    | 'running'
    | 'awaiting_signal'
    | 'retrying'
    | 'succeeded'
    | 'failed'
    | 'interrupted'
    | 'cancelled'
    | 'skipped';

export interface TaskAttempt {
    id: TaskAttemptId;
    number: number;
    status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
    startedAt: number;
    completedAt?: number;
    inputDigest: string;
    error?: SerializedError;
    feedbackArtifactId?: ArtifactId;
}

export interface TaskRun {
    id: TaskRunId;
    graphRunId: TaskGraphRunId;
    spec: TaskRunSpec;
    status: TaskRunStatus;
    attempts: TaskAttempt[];
    inputDigest?: string;
    outputArtifactIds: ArtifactId[];
    parentTaskRunId?: TaskRunId;
    spawnKey?: string;
    spawnDepth: number;
    agent?: AgentExecutionRecord;
    createdAt: number;
    completedAt?: number;
}

export interface TaskGraphRun {
    id: TaskGraphRunId;
    goalId?: GoalIdV3;
    flow: { id: FlowId; revision: number; digest: string };
    status: 'pending' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
    graphVersion: number;
    nodeRuns: Record<import('./flow').FlowNodeId, TaskRunId[]>;
    rootTaskRunIds: TaskRunId[];
    createdAt: number;
    completedAt?: number;
    limits: GraphRunLimits;
    tasks?: Record<TaskRunId, TaskRun>;
    edges?: TaskEdgeDefinition[];
    edgeStates?: Record<TaskEdgeId, TaskEdgeState>;
}

export interface GraphRunLimits {
    maxTasks: number;
    maxSpawnChildrenPerTask: number;
    maxSpawnDepth: number;
    maxConcurrentTasks: number;
    tokenBudget?: number;
    costBudget?: number;
    timeoutMs?: number;
}

export interface TaskEdgeState {
    edgeId: TaskEdgeId;
    graphRunId: TaskGraphRunId;
    state: 'pending' | 'activated' | 'satisfied' | 'skipped' | 'failed';
    decidedByTaskRunId?: TaskRunId;
    artifactIds?: ArtifactId[];
    reason?: string;
    updatedAt: number;
}

export type ArtifactContent = string | JsonValue | Record<string, unknown> | BlobRef;
export interface BlobRef { uri: string; contentHash?: string; size?: number; mimeType?: string }

export interface Artifact {
    id: ArtifactId;
    taskRunId: TaskRunId;
    graphRunId?: TaskGraphRunId;
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

export type TaskEffect =
    | { kind: 'route'; decision: RouteDecision }
    | { kind: 'spawn'; plan: SpawnPlan }
    | { kind: 'agent-state-patch'; patch: AgentStatePatch }
    | { kind: 'memory-write'; write: MemoryWrite }
    | { kind: 'await-human'; request: HumanRequest };

export interface TaskResult {
    artifacts: ArtifactDraft[];
    effects?: TaskEffect[];
    roundDraft?: RoundDraftV3;
    agentExecution?: AgentExecutionRecord;
}

export interface GoalV3 {
    id: GoalIdV3;
    objective: string;
    acceptance?: JsonValue;
    status: 'draft' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    activeGraphRunId?: TaskGraphRunId;
    createdAt: number;
}

export interface RoundDraftV3 {
    id?: RoundId;
    payload: ChatMessage[];
    containerRoundId?: RoundId;
    exposure?: 'public' | 'internal' | 'artifact';
}

export interface RouteTaskConfig {
    mode: 'exclusive' | 'multicast' | 'fallback';
    rules: Array<{ edgeId: TaskEdgeId; condition: RouteCondition; priority: number }>;
    defaultEdgeId?: TaskEdgeId;
}

export interface RouteDecision {
    activatedEdgeIds: TaskEdgeId[];
    skippedEdgeIds: TaskEdgeId[];
    reason?: string;
}

export interface HumanRequest {
    requestId: string;
    prompt: string;
    schema?: JsonSchemaRef;
    expiresAt?: number;
}

export interface MapTaskConfig {
    sourceInput: string;
    itemSchema?: JsonSchemaRef;
    templateNodeId: import('./flow').FlowNodeId;
    itemInputPort: string;
    concurrency?: number;
    continuationNodeId?: import('./flow').FlowNodeId;
}

export interface SpawnPlan {
    spawnKey: string;
    parentTaskRunId: TaskRunId;
    children: SpawnChildSpec[];
    continuation?: SpawnContinuationSpec;
}

export interface SpawnChildSpec {
    key: string;
    handler: TaskHandlerRef;
    config: JsonValue;
    inputs: InputBinding[];
    contextPolicy?: TaskContextPolicy;
    statePolicy?: AgentStatePolicy;
    sourceNodeId?: import('./flow').FlowNodeId;
}

export interface SpawnContinuationSpec {
    key: string;
    handler: TaskHandlerRef;
    config: JsonValue;
    inputs: InputBinding[];
    contextPolicy?: TaskContextPolicy;
    statePolicy?: AgentStatePolicy;
}

export interface ArtifactProjectorRef { id: string; version: string }

export interface PluginManifest {
    id: string;
    version: string;
    schemaVersion: number;
}

export interface HarnessPluginContribution extends PluginManifest {
    taskKinds?: TaskKindContribution[];
    groupStrategies?: AgentGroupStrategyContribution[];
    expressions?: ExpressionContribution[];
    artifactProjectors?: ArtifactProjectorContribution[];
    views?: TaskViewContribution[];
}

/** Serializable task catalogue entry exposed to design-time clients. */
export interface TaskKindDescriptor {
    handler: TaskHandlerRef;
    displayName: string;
    description?: string;
    icon?: string;
    configSchema: JsonValue;
    defaultConfig: JsonValue;
    defaultInputPorts: InputPortSpec[];
    defaultOutputPorts: OutputPortSpec[];
    defaultJoinPolicy: JoinPolicy;
    defaultRetryPolicy: RetryPolicy;
    defaultResourcePolicy?: ResourcePolicy;
}

export interface TaskKindContribution extends TaskKindDescriptor {
    validator?: (config: JsonValue) => string[];
    compiler?: unknown;
    executor?: TaskExecutor;
    migrations?: unknown[];
    editor?: unknown;
}

export interface AgentGroupStrategyContribution { id: string; version: string; schema?: JsonValue }
export interface ExpressionContribution { id: string; version: string; evaluate: (expression: SerializableExpression, value: unknown) => boolean }
export interface ArtifactProjectorContribution { id: string; version: string; project: (artifact: unknown) => JsonValue }
export interface TaskViewContribution { id: string; version: string; schema?: JsonValue }

export type TaskGraphEvent =
    | { type: 'GraphRunCreated'; flow: { id: FlowId; revision: number; digest: string }; limits: GraphRunLimits }
    | { type: 'TaskRunCreated'; task: TaskRunSpec }
    | { type: 'TaskRunReady'; taskRunId: TaskRunId }
    | { type: 'TaskAttemptStarted'; attempt: TaskAttempt }
    | { type: 'TaskAwaitingSignal'; request: HumanRequest }
    | { type: 'ArtifactCommitted'; artifact: { id: ArtifactId; taskRunId: TaskRunId; outputName: string; contentHash: string } }
    | { type: 'TaskAttemptFinished'; outcome: TaskOutcome }
    | { type: 'TaskRunSettled'; status: TaskRunStatus }
    | { type: 'EdgesDecided'; decision: RouteDecision }
    | { type: 'GraphExpanded'; expansion: AppliedExpansion }
    | { type: 'AgentStatePatchCommitted'; revision: { id: AgentStateRevisionId; namespace: string; revision: number; digest: string } }
    | { type: 'GraphRunSettled'; status: TaskGraphRun['status'] };

export interface TaskGraphEventEnvelope<T extends TaskGraphEvent = TaskGraphEvent> {
    sequence: number;
    eventId: string;
    occurredAt: number;
    graphRunId: TaskGraphRunId;
    taskRunId?: TaskRunId;
    attemptId?: TaskAttemptId;
    causationId?: string;
    correlationId?: string;
    event: T;
}

export interface TaskOutcome {
    status: Extract<TaskRunStatus, 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'skipped'>;
    artifacts?: Artifact[];
    error?: SerializedError;
    routeDecision?: RouteDecision;
}

export interface AppliedExpansion {
    spawnKey: string;
    graphRunId: TaskGraphRunId;
    taskRunIds: Record<string, TaskRunId>;
    continuationTaskRunId?: TaskRunId;
    graphVersion: number;
    /** Included in GraphExpanded events so a cold replay can rebuild the projection. */
    tasks?: TaskRun[];
    edges?: TaskEdgeDefinition[];
}

export interface TaskGraphEventStore {
    append<T extends TaskGraphEvent>(event: TaskGraphEventEnvelope<T>, expectedSequence: number): Promise<TaskGraphEventEnvelope<T>>;
    after(graphRunId: TaskGraphRunId, sequence: number): Promise<TaskGraphEventEnvelope[]>;
    latestSequence(graphRunId: TaskGraphRunId): Promise<number>;
    saveSnapshot?<T>(graphRunId: TaskGraphRunId, sequence: number, value: T): Promise<void>;
    loadSnapshot?<T>(graphRunId: TaskGraphRunId): Promise<{ sequence: number; value: T } | null>;
}

export interface TaskGraphRunStore {
    get(graphRunId: TaskGraphRunId): Promise<TaskGraphRun | null>;
    save(run: TaskGraphRun, expectedGraphVersion?: number): Promise<TaskGraphRun>;
    applyExpansion(graphRunId: TaskGraphRunId, expectedGraphVersion: number, plan: SpawnPlan): Promise<AppliedExpansion>;
}

export interface ArtifactStore {
    save(artifact: Artifact): Promise<Artifact>;
    get(id: ArtifactId | string): Promise<Artifact | null>;
}

export interface ContextSnapshotStore {
    save(snapshot: import('./context-types').ContextSnapshot): Promise<import('./context-types').ContextSnapshot>;
    get(id: ContextSnapshotId | string): Promise<import('./context-types').ContextSnapshot | null>;
}

export interface TaskExecutionContext<TConfig = JsonValue> {
    graphRunId: TaskGraphRunId;
    taskRunId: TaskRunId;
    attempt: TaskAttempt;
    config: TConfig;
    inputs: ResolvedInputPort[];
    signal: AbortSignal;
    services: ScopedTaskServices;
    contextSnapshot?: import('./context-types').ContextSnapshot;
    stateRevision?: AgentStateRevision;
}

export interface ScopedTaskServices {
    artifacts: { get(id: ArtifactId): Promise<Artifact | null>; draft(draft: ArtifactDraft): ArtifactDraft };
    clock: { now(): number };
    logger: { debug(message: string, data?: Record<string, JsonValue>): void; info(message: string, data?: Record<string, JsonValue>): void; warn(message: string, data?: Record<string, JsonValue>): void; error(message: string, data?: Record<string, JsonValue>): void };
    signal: AbortSignal;
    agentRuntime?: unknown;
}

export interface TaskExecutor<TConfig = any> {
    readonly handler: TaskHandlerRef;
    execute(context: TaskExecutionContext<TConfig>): Promise<TaskResult>;
}

export function parseId<T extends string>(value: string, label: string): Brand<string, T> {
    if (!value || value.includes('/') || value.includes('\\')) throw new Error(`Invalid ${label}`);
    return value as Brand<string, T>;
}

export const parseTaskRunId = (value: string): TaskRunId => parseId(value, 'TaskRunId');
export const parseTaskGraphRunId = (value: string): TaskGraphRunId => parseId(value, 'TaskGraphRunId');
export const parseTaskEdgeId = (value: string): TaskEdgeId => parseId(value, 'TaskEdgeId');
export const parseArtifactId = (value: string): ArtifactId => parseId(value, 'ArtifactId');
export const parseFlowId = (value: string): FlowId => parseId(value, 'FlowId');
export const parseFlowNodeId = (value: string): FlowNodeIdV3 => parseId(value, 'FlowNodeId');
export const parseFlowRevisionId = (value: string): FlowRevisionId => parseId(value, 'FlowRevisionId');
export const parseAgentId = (value: string): AgentId => parseId(value, 'AgentId');
export const parseAgentStateRevisionId = (value: string): AgentStateRevisionId => parseId(value, 'AgentStateRevisionId');
export const parseContextSnapshotId = (value: string): ContextSnapshotIdV3 => parseId(value, 'ContextSnapshotId');
