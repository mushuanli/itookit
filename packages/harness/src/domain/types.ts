import type { IModuleFS } from '@itookit/stdio';
import type { InteractionRecord, InteractionRequest, InteractionResponse } from './interaction';

export * from './interaction';

export type SessionId = string;
export type TaskId = string;
export type AttemptId = string;
export type EffectId = string;
export type HandleId = string;
export type ContextCommitId = string;
export type ResourceId = string;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type SessionStatus = 'open' | 'suspended' | 'closing' | 'closed' | 'archived';
export type TaskStatus = 'created' | 'blocked' | 'ready' | 'running' | 'waiting'
    | 'succeeded' | 'failed' | 'cancelled';

export interface ProgramRef { kind: string; version: string; }
export interface StorageBindingRef { kind: string; locator: JsonValue; }
export interface ResolvedStorageBinding { fs: IModuleFS; rootPath: string; }
export interface SessionStorageResolver {
    readonly kind: string;
    resolve(reference: StorageBindingRef): Promise<ResolvedStorageBinding>;
}

export interface SessionRecord {
    id: SessionId;
    status: SessionStatus;
    storage: StorageBindingRef;
    nextEventSeq: number;
    version: number;
    createdAt: number;
    updatedAt: number;
}

export interface SharedStateEntry<T extends JsonValue = JsonValue> {
    key: string;
    value: T;
    version: number;
    updatedAt: number;
    updatedByTaskId?: TaskId;
}

export interface SharedStateWriteOptions {
    expectedVersion?: number | null;
    taskId?: TaskId;
}

export interface SharedStateRevision<T extends JsonValue = JsonValue> {
    key: string;
    version: number;
    value?: T;
    deleted: boolean;
    updatedAt: number;
    updatedByTaskId?: TaskId;
}

export interface CrossSessionMessage<T extends JsonValue = JsonValue> {
    id: string;
    sourceSessionId: SessionId;
    targetSessionId: SessionId;
    topic: string;
    payload: T;
    status: 'pending' | 'delivered';
    createdAt: number;
    deliveredAt?: number;
}

export interface ContextCommit<T extends JsonValue = JsonValue> {
    id: ContextCommitId;
    sessionId: SessionId;
    parentIds: ContextCommitId[];
    delta: T;
    authorTaskId?: TaskId;
    createdAt: number;
}

export interface ContextBranch {
    name: string;
    head?: ContextCommitId;
    version: number;
    updatedAt: number;
}

export interface ContextCommitOptions {
    branch?: string;
    parents?: ContextCommitId[];
    expectedHead?: ContextCommitId | null;
    taskId?: TaskId;
}

export interface RetryPolicy {
    maxAttempts: number;
    backoffMs?: number;
}

export interface TaskDependency {
    task: TaskId;
    condition?: 'succeeded' | 'terminal';
    onFailure?: 'fail' | 'skip' | 'continue';
}

export interface TaskSpec<I = unknown> {
    program: ProgramRef;
    input: I;
    parent?: TaskId;
    spawnKey?: string;
    dependsOn?: TaskDependency[];
    retry?: RetryPolicy;
    priority?: number;
    labels?: Record<string, string>;
    /** Persist the Task without making it schedulable until TaskHandle.start(). */
    deferStart?: boolean;
}

export interface TaskAttempt {
    id: AttemptId;
    workerId: string;
    leaseToken: string;
    leaseEpoch: number;
    leaseUntil: number;
    startedAt: number;
    finishedAt?: number;
    outcome?: 'yielded' | 'lost' | 'failed' | 'completed' | 'cancelled';
}

export interface SerializableError {
    message: string;
    code?: string;
    stack?: string;
}

export interface ExitRecord<O = unknown> {
    taskId: TaskId;
    status: 'succeeded' | 'failed' | 'cancelled';
    output?: O;
    error?: SerializableError;
    completedAt: number;
}

export interface PersistedEffect {
    request: EffectRequest;
    status: 'pending' | 'leased' | 'succeeded' | 'failed' | 'cancelled' | 'indeterminate';
    attemptCount: number;
    attempts: EffectAttempt[];
    currentAttempt?: EffectAttempt;
    result?: unknown;
    error?: SerializableError;
}

export interface EffectAttempt {
    id: string;
    workerId: string;
    leaseToken: string;
    leaseUntil: number;
    startedAt: number;
    finishedAt?: number;
    outcome?: 'completed' | 'failed' | 'lost' | 'cancelled' | 'indeterminate';
}

export interface TaskRecord<S = unknown> {
    id: TaskId;
    sessionId: SessionId;
    parentTaskId?: TaskId;
    rootTaskId: TaskId;
    spawnKey?: string;
    program: ProgramRef;
    status: TaskStatus;
    input: unknown;
    state?: S;
    pendingEvents: TaskInputEvent[];
    unresolvedDeps: number;
    priority: number;
    retry: RetryPolicy;
    attemptCount: number;
    readyAt?: number;
    lastError?: SerializableError;
    currentAttempt?: TaskAttempt;
    effects: Record<string, PersistedEffect>;
    interactions: Record<string, InteractionRecord<JsonValue>>;
    wait?: WaitSpec;
    output?: unknown;
    exit?: ExitRecord;
    labels?: Record<string, string>;
    version: number;
    createdAt: number;
    updatedAt: number;
}

export type TaskSignal = { type: string; payload?: unknown };
export type TaskInputEvent =
    | { type: 'started' }
    | { type: 'effect-completed'; effectId: EffectId; result: unknown }
    | { type: 'effect-failed'; effectId: EffectId; error: SerializableError }
    | { type: 'task-exited'; taskId: TaskId; exit: ExitRecord }
    | { type: 'interaction-resolved'; interactionId: string; value: JsonValue }
    | { type: 'signal'; sequence: number; signal: TaskSignal };

export type WaitAtom =
    | { type: 'signal'; id?: string }
    | { type: 'effect'; id?: string }
    | { type: 'task'; id: TaskId }
    | { type: 'child'; spawnKey: string }
    | { type: 'interaction'; id: string };

export type WaitSpec = WaitAtom
    | { type: 'any'; waits: WaitSpec[] }
    | { type: 'all'; waits: WaitSpec[] }
    | { type: 'quorum'; waits: WaitSpec[]; required: number };

export interface EffectRequest<Req = unknown> {
    id?: EffectId;
    kind: string;
    version: string;
    request: Req;
    idempotencyKey: string;
    timeoutMs?: number;
    retry?: RetryPolicy;
    grants?: Array<{ handleId: HandleId; right: ResourceRight }>;
}

export type KernelAction =
    | { type: 'effect'; effect: EffectRequest }
    | { type: 'spawn'; spawnKey: string; spec: TaskSpec }
    | { type: 'request-interaction'; interaction: InteractionRequest<JsonValue> }
    | { type: 'set-shared'; key: string; value: JsonValue; expectedVersion?: number | null }
    | { type: 'delete-shared'; key: string; expectedVersion?: number | null }
    | { type: 'emit'; eventType: string; payload?: unknown };

export interface Decision<S = unknown, O = unknown> {
    state: S;
    actions?: KernelAction[];
    next: { type: 'continue' }
        | { type: 'wait'; on: WaitSpec }
        | { type: 'complete'; output: O }
        | { type: 'fail'; error: SerializableError; retryable?: boolean };
}

export interface TaskProgramManifest { kind: string; version: string; }
export interface DurableTaskProgram<S = unknown, I = unknown, O = unknown> {
    readonly manifest: TaskProgramManifest;
    init(input: I): Decision<S, O> | Promise<Decision<S, O>>;
    reduce(state: Readonly<S>, event: TaskInputEvent): Decision<S, O> | Promise<Decision<S, O>>;
}

export interface EffectExecutionContext {
    sessionId: SessionId;
    taskId: TaskId;
    effectId: EffectId;
    abortSignal: AbortSignal;
    grants: AuthorizedEffectGrant[];
    sessionState?: EffectSessionState;
    /**
     * Append an incremental event to the session event log during effect
     * execution. Events are immediately visible to TaskHandle.events()
     * consumers (e.g. streaming LLM chunks to the UI).
     */
    emit?: (event: { type: string; payload?: unknown }) => Promise<void>;
}

export interface EffectSessionState {
    get<T extends JsonValue = JsonValue>(key: string): Promise<SharedStateEntry<T> | undefined>;
    set<T extends JsonValue>(
        key: string,
        value: T,
        expectedVersion?: number | null,
    ): Promise<SharedStateEntry<T>>;
}

export interface AuthorizedEffectGrant {
    handleId: HandleId;
    right: ResourceRight;
    resource: ResourceRecord;
}
export interface EffectAdapter<Req = unknown, Res = unknown> {
    readonly kind: string;
    readonly version: string;
    execute(request: Req, context: EffectExecutionContext): Promise<Res>;
    reconcile?(request: Req, context: EffectExecutionContext): Promise<EffectReconcileResult<Res>>;
    cancel?(request: Req, context: EffectExecutionContext): Promise<void>;
}

export type EffectReconcileResult<Res = unknown> =
    | { status: 'completed'; result: Res }
    | { status: 'retry' }
    | { status: 'indeterminate'; error: SerializableError };

export interface EventEnvelope {
    sequence: number;
    sessionId: SessionId;
    taskId?: TaskId;
    type: string;
    payload?: unknown;
    occurredAt: number;
}

export type ResourceRight = 'read' | 'write' | 'execute' | 'grant' | 'admin';
export interface ResourceRecord {
    id: ResourceId;
    sessionId: SessionId;
    kind: string;
    uri: string;
    generation: number;
    parentResourceId?: ResourceId;
    metadata?: JsonValue;
    createdAt: number;
}

export interface ResourceHandle {
    id: HandleId;
    resourceId: string;
    holderTaskId: TaskId;
    rights: ResourceRight[];
    generation: number;
    parentHandleId?: HandleId;
    revokedAt?: number;
}

export interface ResourceSpec {
    kind: string;
    uri: string;
    ownerTaskId: TaskId;
    rights?: ResourceRight[];
    parentResourceId?: ResourceId;
    parentHandleId?: HandleId;
    metadata?: JsonValue;
}

export type TaskResourceSpec = Omit<ResourceSpec, 'ownerTaskId'>;

export interface BudgetAccount {
    resourceId: ResourceId;
    dimension: string;
    hardLimit: number;
    used: number;
    version: number;
    updatedAt: number;
}

export interface ResourceGrant {
    resource: ResourceRecord;
    handle: ResourceHandle;
}

export interface WorkspaceSnapshot {
    id: string;
    sessionId: SessionId;
    resourceId: ResourceId;
    adapter: ProgramRef;
    parentIds: string[];
    payload: JsonValue;
    createdAt: number;
}

export interface WorkspaceDiff {
    id: string;
    sessionId: SessionId;
    resourceId: ResourceId;
    adapter: ProgramRef;
    baseSnapshotId: string;
    targetSnapshotId: string;
    payload: JsonValue;
    createdAt: number;
}

export interface WorkspaceMergeResult {
    snapshot: WorkspaceSnapshot;
    conflicts: JsonValue[];
}

export interface WorkspaceExecutionContext {
    sessionId: SessionId;
    resource: ResourceRecord;
    abortSignal: AbortSignal;
}

export interface WorkspaceAdapter {
    readonly kind: string;
    readonly version: string;
    snapshot(uri: string, context: WorkspaceExecutionContext): Promise<JsonValue>;
    diff(base: JsonValue, target: JsonValue, context: WorkspaceExecutionContext): Promise<JsonValue>;
    merge(
        base: JsonValue,
        left: JsonValue,
        right: JsonValue,
        context: WorkspaceExecutionContext,
    ): Promise<{ payload: JsonValue; conflicts?: JsonValue[] }>;
}

export interface TaskSnapshot { task: TaskRecord; }
export interface RecoveryReport {
    recoveredTasks: number;
    recoveredEffects: number;
    expiredAttempts: number;
    rebuiltIndexes: number;
}

export interface SessionHandle {
    readonly id: SessionId;
    submit<I, O = unknown>(spec: TaskSpec<I>): Promise<TaskHandle<O>>;
    signal(taskId: TaskId, signal: TaskSignal): Promise<void>;
    respond<T extends JsonValue>(taskId: TaskId, response: InteractionResponse<T>): Promise<void>;
    events(options?: { after?: number }): AsyncIterable<EventEnvelope>;
    getShared<T extends JsonValue = JsonValue>(key: string): Promise<SharedStateEntry<T> | undefined>;
    setShared<T extends JsonValue>(key: string, value: T, options?: SharedStateWriteOptions): Promise<SharedStateEntry<T>>;
    deleteShared(key: string, options?: SharedStateWriteOptions): Promise<boolean>;
    listShared(prefix?: string): Promise<SharedStateEntry[]>;
    sharedHistory<T extends JsonValue = JsonValue>(key: string): Promise<SharedStateRevision<T>[]>;
    send<T extends JsonValue>(targetSessionId: SessionId, topic: string, payload: T): Promise<CrossSessionMessage<T>>;
    inbox(options?: { after?: number }): Promise<CrossSessionMessage[]>;
    commitContext<T extends JsonValue>(delta: T, options?: ContextCommitOptions): Promise<ContextCommit<T>>;
    getContextCommit<T extends JsonValue = JsonValue>(id: ContextCommitId): Promise<ContextCommit<T> | undefined>;
    getContextBranch(name?: string): Promise<ContextBranch>;
    contextHistory(head?: ContextCommitId): Promise<ContextCommit[]>;
    createResource(spec: ResourceSpec): Promise<ResourceGrant>;
    grantResource(parentHandleId: HandleId, holderTaskId: TaskId, rights: ResourceRight[]): Promise<ResourceHandle>;
    revokeResource(handleId: HandleId): Promise<number>;
    authorizeResource(handleId: HandleId, right: ResourceRight, holderTaskId?: TaskId): Promise<ResourceRecord>;
    setBudget(handleId: HandleId, dimension: string, hardLimit: number, expectedVersion?: number | null): Promise<BudgetAccount>;
    chargeBudget(handleId: HandleId, dimension: string, amount: number): Promise<BudgetAccount[]>;
    snapshotWorkspace(handleId: HandleId, adapter: ProgramRef): Promise<WorkspaceSnapshot>;
    diffWorkspace(handleId: HandleId, baseSnapshotId: string, targetSnapshotId: string): Promise<WorkspaceDiff>;
    mergeWorkspace(
        handleId: HandleId,
        baseSnapshotId: string,
        leftSnapshotId: string,
        rightSnapshotId: string,
    ): Promise<WorkspaceMergeResult>;
    suspend(): Promise<void>;
    resume(): Promise<void>;
    close(options?: { cancelRunning?: boolean }): Promise<void>;
}

export interface TaskHandle<O = unknown> {
    readonly id: TaskId;
    status(): Promise<TaskSnapshot>;
    wait(options?: { timeoutMs?: number }): Promise<ExitRecord<O>>;
    poll(): Promise<ExitRecord<O> | undefined>;
    signal(signal: TaskSignal): Promise<void>;
    start(): Promise<void>;
    respond<T extends JsonValue>(response: InteractionResponse<T>): Promise<void>;
    createResource(spec: TaskResourceSpec): Promise<ResourceGrant>;
    cancel(reason?: string): Promise<void>;
    events(options?: { after?: number }): AsyncIterable<EventEnvelope>;
    history(options?: { afterVersion?: number }): Promise<TaskRecord[]>;
    attempts(): Promise<TaskAttempt[]>;
}
