// ILoop — the single execution primitive for the LLM subsystem.
//
// An ILoop implementation is a pausable coroutine (AsyncGenerator):
//   - Yields AgentEvent out → consumed by UI projection
//   - Receives Signal at yield points → user interaction / control
//   - Round boundary = checkpoint = the only legal pause point
//
// All existing execution paths (chat / Agent Loop / Mission / Graph)
// are ILoop implementations registered via ExecutorRegistry.

import type { ChatMessage, Attachment } from '../llm/message';
import type { AgentEvent, PauseRequest } from './agent-event';
import type { TokenUsage } from '../llm/completion';
import type { ILLMService } from '../llm/llm-service';
import type { IToolService } from '../tools/tool-service';

// ─── Round (moved from Log for co-location with ILoop) ───────────────

/** ULID-based round ID. */
export type RoundId = string;

export interface Round {
    id: RoundId;
    /** 1 parent = linear; 2+ parents = merge point; [] = root. */
    parents: RoundId[];
    /** One user/assistant message group. */
    payload: ChatMessage[];
    meta: RoundMeta;
    /** Runtime execution result — populated by LoopExecutor for Goal predicate consumption. */
    result?: RoundResult;
}

export interface RoundMeta {
    createdAt: number;
    origin: 'loop' | 'merge' | 'rebase' | 'edit' | 'user';
    usage?: TokenUsage;
    stale?: boolean;
    rebasedFrom?: RoundId;
    assembly?: AssemblyStrategy;
    /**
     * Controls whether fold() includes this round in LLM history.
     * - 'include' (default): always include
     * - 'exclude': skip entirely (e.g. system-only, soft-hidden rounds)
     * - 'summary': include a collapsed summary instead of full payload
     */
    historyPolicy?: 'include' | 'exclude' | 'summary';
}

// ─── Log (minimal interface — full spec in llm-2/01-log.md) ──────────

export interface ILog {
    append(ref: Ref, round: Round): Promise<RoundId>;
    fold(ref: Ref, strategy?: AssemblyStrategy): Promise<ChatMessage[]>;
    refs(): RefStore;
    draft(): DraftArea;
    merge(refs: Ref[], strategy: AssemblyStrategy): Promise<Ref>;
    rebase(ref: Ref, insertAfter: RoundId, rounds: Round[], opts?: { regenerate?: boolean }): Promise<Ref>;
}

export interface RefStore {
    create(name: string, at: RoundId): Ref | Promise<Ref>;
    move(ref: Ref, to: RoundId): void | Promise<void>;
    tag(name: string, at: RoundId): void | Promise<void>;
    delete(ref: Ref): void | Promise<void>;
    list(): Ref[] | Promise<Ref[]>;
}

export interface DraftArea {
    checkpoint(pause: PauseRequest): Promise<void>;
    /** Flush (clear) the current draft. The round parameter is optional — implementations may ignore it. */
    flush(round?: Round | null): Promise<void>;
    current(): Round | null;
    restore(): Promise<Round | null>;
    /** Set the in-flight round so crash-resume knows the current round boundary. */
    setCurrent(round: Round): void;
}

export type Ref = string;
export type RefName = string;

export type AssemblyStrategy =
    | { type: 'concat'; order: 'topo' | 'timestamp' }
    | { type: 'summarize-branches'; mainline: Ref }
    | { type: 'pick'; rounds: RoundId[] };

// ─── Signal — user interaction reduced to signals ────────────────────

export type Signal =
    | { type: 'send'; text: string; attachments?: Attachment[]; mode?: string }
    | { type: 'abort' }
    | { type: 'inject'; text: string }
    | { type: 'respond'; requestId: string; response: unknown }
    | { type: 'navigate'; ref: RefName };

// ─── ILoop — the core execution contract ─────────────────────────────

export interface ILoop {
    readonly mode: string;
    /** Yields events out; receives signals at yield points. */
    run(ctx: LoopContext): AsyncGenerator<AgentEvent, Round[], Signal | undefined>;
    /** HITL-resume and crash-resume share this single path. */
    resume(checkpoint: RoundId): AsyncGenerator<AgentEvent, Round[], Signal | undefined>;
}

export interface LoopContext {
    sessionId: string;
    ref: Ref;
    log: ILog;
    llm: ILLMService;
    tools: IToolService;
    middlewares: ILoopMiddleware[];
    signal: AbortSignal;
    // ── LLM config (flattened from executorConfig, eliminates executeTask fallback) ──
    /** LLM connection ID passed to chatStream. Defaults to 'default' if absent. */
    connectionId?: string;
    /** Model override passed to chatStream. */
    model?: string;
    /** System prompt prepended before fold() messages (deduplicates any system in fold result). */
    systemPrompt?: string;
    /** Temperature override. */
    temperature?: number;
    /** Max output tokens. */
    maxTokens?: number;
    /** Enable extended thinking. */
    thinking?: boolean;
    /** Reasoning effort for o-series models. */
    reasoningEffort?: string;
    /** History length limit (undefined/-1 = no limit, 0 = empty). Only non-system messages are counted. */
    historyLength?: number;
    /** Task creation timestamp (ms) for durationMs calculation. */
    startedAt?: number;
    /**
     * Pre-allocated round ID for the first round.
     * When set, the executor uses this ID instead of generating a new one.
     * Required for RoundLog sessions so that the streaming rootNode.id matches
     * the persisted round.id (preventing duplicate UI messages).
     */
    preallocatedRoundId?: string;
}

// ─── ILoopMiddleware — round-level hooks ─────────────────────────────

/** Lightweight tool call info passed to onToolCalls hook. */
export interface PlannedTool {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ILoopMiddleware {
    readonly name: string;
    beforeRound?(ctx: RoundContext): Promise<void | ControlDirective>;
    /** Called after LLM response parsing, before tool execution.
     *  Use for plan-confirm: return `{ action: 'pause' }` to await user approval. */
    onToolCalls?(ctx: RoundContext, toolCalls: PlannedTool[]): Promise<void | ControlDirective>;
    afterRound?(ctx: RoundContext, result: RoundResult): Promise<void | ControlDirective>;
    onError?(ctx: RoundContext, error: Error): Promise<RecoveryAction>;
}

export interface RoundContext {
    roundId: RoundId;
    sessionId: string;
    roundNumber: number;
}

export interface RoundResult {
    assistantBlocks: Array<{
        type: 'thinking' | 'text' | 'tool_use';
        [key: string]: unknown;
    }>;
    toolResults: Array<{
        toolUseId: string;
        content: string;
        isError: boolean;
    }>;
    usage?: TokenUsage;
    /** API-level finish reason from the final chunk (e.g. 'stop', 'length'). */
    finishReason?: string;
}

export type ControlDirective =
    | { action: 'abort'; reason: string }
    | { action: 'skip_round' }
    | { action: 'inject'; text: string }
    /** Pause the loop and wait for user signal (plan confirm, permission, HITL).
     *  The loop body yields `await_signal` and resumes when drive() passes the Signal. */
    | { action: 'pause'; request: PauseRequest };

export type RecoveryAction =
    | { action: 'retry'; delayMs?: number }
    | { action: 'fallback'; connectionId: string }
    | { action: 'compress' }
    | { action: 'fail' };
