import type { AgentEvent } from './agent-event';
import type { ChatMessage } from '../llm/message';
import type { ChatCompletionParams, ChatCompletionChunk, TokenUsage } from '../llm/completion';
import type { ConnectionMeta, LLMProvider } from '../llm/connection';
import type { IToolService } from '../tools/tool-service';

export type ProcessId = string;
export type RunId = string;
export type SessionId = string;

export interface CapabilitySet {
    readonly ids: readonly string[];
}

export interface BudgetView {
    readonly limits: Readonly<Record<string, number>>;
    readonly usage: Readonly<Record<string, number>>;
}

export interface LLMPort {
    chatStream(connectionId: string, request: ChatCompletionParams): AsyncIterable<ChatCompletionChunk>;
    getConnection(connectionId: string): Promise<ConnectionMeta | undefined>;
    getDefaultConnection(): Promise<ConnectionMeta | null>;
    getProvider(providerId: string): Promise<LLMProvider | undefined>;
    estimateTokens(connectionId: string, text: string): number;
}

export type ToolPort = Pick<
    IToolService,
    'listTools' | 'getToolMeta' | 'getToolDefinitions' | 'invoke' | 'invokeBatch'
>;

export interface VfsPort {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    listFiles(path?: string): Promise<string[]>;
}

export interface ProcessResourcePorts {
    llm: LLMPort;
    tools: ToolPort;
    vfs: VfsPort;
}

export type ProcessSignal =
    | { type: 'respond'; requestId: string; response: unknown }
    | { type: 'authorize'; requestId: string; approved: boolean }
    | { type: 'inject'; text: string }
    | { type: 'cancel'; reason?: string };

export type WaitCondition =
    | {
        type: 'human-signal';
        requestId: string;
        prompt: string;
        schema?: unknown;
        conversational?: boolean;
    }
    | { type: 'resource'; resourceId: string }
    | { type: 'child-process'; processId: ProcessId }
    | { type: 'external'; key: string };

export interface ProcessError {
    message: string;
    code?: string;
    stack?: string;
    retryable?: boolean;
}

export type ProcessEvent =
    | { type: 'agent-event'; event: AgentEvent }
    | { type: 'usage'; usage: TokenUsage }
    | { type: 'diagnostic'; name: string; data?: Record<string, unknown> };

export type ProcessTransition<State, Output> =
    | { type: 'waiting'; state: State; waitFor: WaitCondition }
    | {
        type: 'yielded';
        state: State;
        reason: 'quota' | 'fairness' | 'child-process';
    }
    | { type: 'completed'; output: Output }
    | { type: 'failed'; error: ProcessError };

export interface ProcessContext {
    processId: ProcessId;
    runId: RunId;
    resources: ProcessResourcePorts;
    capabilities: CapabilitySet;
    budget: BudgetView;
    abortSignal: AbortSignal;
}

export interface ProcessProgram<State = unknown, Input = unknown, Output = unknown> {
    readonly kind: string;
    initialize(input: Input): Promise<State>;
    run(
        state: State,
        context: ProcessContext,
        signal?: ProcessSignal,
    ): AsyncGenerator<ProcessEvent, ProcessTransition<State, Output>>;
}

export type ProcessStatus =
    | 'created'
    | 'ready'
    | 'running'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface ProcessCheckpoint<State = unknown> {
    processId: ProcessId;
    runId: RunId;
    programKind: string;
    state: State;
    waitFor?: WaitCondition;
    sequence: number;
    createdAt: number;
}

export interface ProcessRecord<State = unknown, Output = unknown> {
    id: ProcessId;
    runId: RunId;
    programKind: string;
    status: ProcessStatus;
    state: State;
    output?: Output;
    error?: ProcessError;
    priority: number;
    ownerRoundId?: string;
    parentProcessId?: ProcessId;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
}

export type ArtifactMap = Record<string, unknown>;

export type ExecutionRunKind =
    | 'direct'
    | 'dag'
    | 'agent'
    | 'tool'
    | 'human'
    | 'subflow'
    | (string & {});

export type ExecutionRunStatus =
    | 'created'
    | 'ready'
    | 'running'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface ExecutionRun {
    id: RunId;
    ownerRoundId?: string;
    parentRunId?: RunId;
    rootRunId: RunId;
    kind: ExecutionRunKind;
    status: ExecutionRunStatus;
    input: ArtifactMap;
    output?: ArtifactMap;
    processIds: ProcessId[];
    checkpoint?: ProcessCheckpoint;
    createdAt: number;
    completedAt?: number;
}

export interface ExecutionRef {
    runId: RunId;
    role: 'primary' | 'background';
}

export interface ConversationRound {
    id: string;
    sessionId: SessionId;
    historyParentIds: string[];
    input: ChatMessage[];
    output: ChatMessage[];
    executions: ExecutionRef[];
    status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
    createdAt: number;
    completedAt?: number;
}

export interface DirectRunSpec {
    programKind: string;
    input: unknown;
    processId?: ProcessId;
    priority?: number;
    capabilities?: string[];
    budget?: Record<string, number>;
}

export interface RunRequest<Spec = unknown> {
    scheduler: string;
    spec: Spec;
    ownerRoundId?: string;
    parentRunId?: RunId;
    metadata?: Record<string, unknown>;
}

export type RunEvent =
    | { type: 'run:created'; run: ExecutionRun }
    | { type: 'run:status'; status: ExecutionRunStatus }
    | { type: 'process:created'; process: ProcessRecord }
    | { type: 'process:status'; status: ProcessStatus }
    | { type: 'process:event'; event: ProcessEvent }
    | { type: 'process:checkpoint'; checkpoint: ProcessCheckpoint }
    | { type: 'run:completed'; output: ArtifactMap }
    | { type: 'run:failed'; error: ProcessError };

export interface RunEventEnvelope {
    sequence: number;
    occurredAt: number;
    runId: RunId;
    processId?: ProcessId;
    event: RunEvent;
}

export interface RunSnapshot {
    run: ExecutionRun;
    processes: ProcessRecord[];
}

export interface RunHandle {
    readonly runId: RunId;
    events(fromSequence?: number): AsyncIterable<RunEventEnvelope>;
    signal(signal: ProcessSignal): Promise<void>;
    cancel(): Promise<void>;
    snapshot(): Promise<RunSnapshot>;
}

export interface HarnessControlPlane {
    submit(request: RunRequest): Promise<RunHandle>;
    attach(runId: RunId): Promise<RunHandle>;
}

export interface ProcessHost extends HarnessControlPlane {
    registerProgram(program: ProcessProgram): void;
    hasProgram(kind: string): boolean;
}

export interface ResourceCapacity {
    available: number;
    total: number;
}

export interface SchedulingPolicy {
    select(
        ready: readonly ProcessRecord[],
        capacity: ResourceCapacity,
    ): readonly ProcessId[];
}

export interface SchedulerRun {
    readonly runId: RunId;
    readonly processIds: readonly ProcessId[];
    onProcessChanged(
        process: ProcessRecord,
        context: SchedulerContext,
    ): Promise<SchedulerTransition>;
    snapshot(): SchedulerSnapshot;
}

export interface SchedulerContext {
    runId: RunId;
    request: RunRequest;
    submitProcess(spec: DirectRunSpec): Promise<ProcessId>;
    getProcess(processId: ProcessId): ProcessRecord | undefined;
}

export interface SchedulerSnapshot {
    kind: string;
    runId: RunId;
    state: unknown;
}

export type SchedulerTransition =
    | { type: 'status'; status: 'ready' | 'running' | 'waiting' }
    | { type: 'completed'; output: ArtifactMap }
    | { type: 'failed'; error: ProcessError }
    | { type: 'cancelled' };

export interface SchedulerModule<Spec = unknown> {
    readonly kind: string;
    start(spec: Spec, context: SchedulerContext): Promise<SchedulerRun>;
    restore(snapshot: SchedulerSnapshot, context: SchedulerContext): Promise<SchedulerRun>;
}

export interface ProcessCheckpointStore {
    save(checkpoint: ProcessCheckpoint): Promise<void>;
    get(processId: ProcessId): Promise<ProcessCheckpoint | null>;
    delete(processId: ProcessId): Promise<void>;
}

export interface RunEventStore {
    append(event: Omit<RunEventEnvelope, 'sequence'>): Promise<RunEventEnvelope>;
    after(runId: RunId, sequence: number): Promise<RunEventEnvelope[]>;
    subscribe(runId: RunId, listener: (event: RunEventEnvelope) => void): () => void;
}
