// ILoop — the single execution primitive for the LLM subsystem.
//
// An ILoop implementation is a pausable coroutine (AsyncGenerator):
//   - Yields AgentEvent out → consumed by UI projection
//   - Receives Signal at yield points → user interaction / control
//   - Turn boundary = checkpoint = the only legal pause point
//
// All existing execution paths (chat / Agent Loop / Mission / Graph)
// are ILoop implementations registered via ExecutorRegistry.

import type { ChatMessage, Attachment } from '../llm/message';
import type { AgentEvent, PauseRequest } from './agent-event';
import type { TokenUsage } from '../llm/completion';
import type { ILLMService } from '../llm/llm-service';
import type { IToolService } from '../tools/tool-service';

// ─── Turn (moved from Log for co-location with ILoop) ────────────────

/** ULID-based turn ID. */
export type TurnId = string;

export interface Turn {
    id: TurnId;
    /** 1 parent = linear; 2+ parents = merge point; [] = root. */
    parents: TurnId[];
    /** One user/assistant message group. */
    payload: ChatMessage[];
    meta: TurnMeta;
    /** Runtime execution result — populated by LoopExecutor for Goal predicate consumption. */
    result?: TurnResult;
}

export interface TurnMeta {
    createdAt: number;
    origin: 'loop' | 'merge' | 'rebase' | 'edit';
    usage?: TokenUsage;
    stale?: boolean;
    rebasedFrom?: TurnId;
    assembly?: AssemblyStrategy;
}

// ─── Log (minimal interface — full spec in llm-2/01-log.md) ──────────

export interface ILog {
    append(ref: Ref, turn: Turn): Promise<TurnId>;
    fold(ref: Ref, strategy?: AssemblyStrategy): Promise<ChatMessage[]>;
    refs(): RefStore;
    draft(): DraftArea;
    merge(refs: Ref[], strategy: AssemblyStrategy): Promise<Ref>;
    rebase(ref: Ref, insertAfter: TurnId, turns: Turn[], opts?: { regenerate?: boolean }): Promise<Ref>;
}

export interface RefStore {
    create(name: string, at: TurnId): Ref | Promise<Ref>;
    move(ref: Ref, to: TurnId): void | Promise<void>;
    tag(name: string, at: TurnId): void | Promise<void>;
    delete(ref: Ref): void | Promise<void>;
    list(): Ref[] | Promise<Ref[]>;
}

export interface DraftArea {
    checkpoint(pause: PauseRequest): Promise<void>;
    flush(turn: Turn): Promise<void>;
    current(): Turn | null;
    restore(): Promise<Turn | null>;
    /** Set the in-flight turn so crash-resume knows the current turn boundary. */
    setCurrent(turn: Turn): void;
}

export type Ref = string;
export type RefName = string;

export type AssemblyStrategy =
    | { type: 'concat'; order: 'topo' | 'timestamp' }
    | { type: 'summarize-branches'; mainline: Ref }
    | { type: 'pick'; turns: TurnId[] };

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
    run(ctx: LoopContext): AsyncGenerator<AgentEvent, Turn[], Signal | undefined>;
    /** HITL-resume and crash-resume share this single path. */
    resume(checkpoint: TurnId): AsyncGenerator<AgentEvent, Turn[], Signal | undefined>;
}

export interface LoopContext {
    sessionId: string;
    ref: Ref;
    log: ILog;
    llm: ILLMService;
    tools: IToolService;
    middlewares: ILoopMiddleware[];
    signal: AbortSignal;
}

// ─── ILoopMiddleware — turn-level hooks ──────────────────────────────

/** Lightweight tool call info passed to onToolCalls hook. */
export interface PlannedTool {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ILoopMiddleware {
    readonly name: string;
    beforeTurn?(ctx: TurnContext): Promise<void | ControlDirective>;
    /** Called after LLM response parsing, before tool execution.
     *  Use for plan-confirm: return `{ action: 'pause' }` to await user approval. */
    onToolCalls?(ctx: TurnContext, toolCalls: PlannedTool[]): Promise<void | ControlDirective>;
    afterTurn?(ctx: TurnContext, result: TurnResult): Promise<void | ControlDirective>;
    onError?(ctx: TurnContext, error: Error): Promise<RecoveryAction>;
}

export interface TurnContext {
    turnId: TurnId;
    sessionId: string;
    turnNumber: number;
}

export interface TurnResult {
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
    | { action: 'skip_turn' }
    | { action: 'inject'; text: string }
    /** Pause the loop and wait for user signal (plan confirm, permission, HITL).
     *  The loop body yields `await_signal` and resumes when drive() passes the Signal. */
    | { action: 'pause'; request: PauseRequest };

export type RecoveryAction =
    | { action: 'retry'; delayMs?: number }
    | { action: 'fallback'; connectionId: string }
    | { action: 'compress' }
    | { action: 'fail' };
