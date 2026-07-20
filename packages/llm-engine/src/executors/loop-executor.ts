// executor-loop — Agent Loop ILoop implementation (AsyncGenerator).
//
// Adapted from llm-harness AgentLoopExecutor. The core loop mirrors
// the original while(true) body but communicates via yield/Signal
// instead of emit/interceptors.
//
// Loop invariant (each iteration):
//   1. Budget Check (via budget middleware)
//   2. Context Compress (via compression middleware)
//   3. Build messages from log.fold()
//   4. LLM Call with error recovery (via error-recovery middleware)
//   5. Parse Response → handle tool_calls or finalize
//   6. After-round hooks (back-pressure via middleware)
//   7. Checkpoint → yield round:end → continue or return

import type {
    ILoop,
    LoopContext,
    Round,
    ExchangeContext,
    RoundResult,
    AgentEvent,
    Signal,
    ILoopMiddleware,
    RecoveryAction,
    TokenUsage,
    ToolCall,
    PlannedTool,
} from '@itookit/common';
import { composeMiddleware, type MiddlewarePipeline } from '../core/middleware-pipeline';
import { ProviderMessageAdapter } from '../core/provider-message-adapter';

// ─── Types ───────────────────────────────────────────────────────────

interface AssistantBlock {
    type: 'thinking' | 'text' | 'tool_use';
    text?: string;
    toolUseId?: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
}

interface ToolExecResult {
    toolUseId: string;
    content: string;
    isError: boolean;
}

// ─── LoopExecutor ────────────────────────────────────────────────────

export class LoopExecutor implements ILoop {
    readonly mode: string;

    private readonly pipeline: MiddlewarePipeline;
    private lastCtx: LoopContext | null = null;

    constructor(
        mode: string,
        middlewares: ILoopMiddleware[],
    ) {
        this.mode = mode;
        this.pipeline = composeMiddleware(middlewares);
    }

    async *run(ctx: LoopContext): AsyncGenerator<AgentEvent, Round[], Signal | undefined> {
        this.lastCtx = ctx;
        return yield* this.executeLoop(ctx, 0, []);
    }

    async *resume(_checkpoint: string): AsyncGenerator<AgentEvent, Round[], Signal | undefined> {
        const ctx = this.lastCtx;
        if (!ctx) {
            yield {
                type: 'error',
                error: { message: 'Cannot resume: no prior context. Call run() first.', code: 'NO_CONTEXT' },
            };
            return [];
        }

        // Reconstruct state from the Log.
        // Since round boundaries are persisted, we count completed rounds
        // and re-enter the loop at the next round.
        const messages = await ctx.log.fold(ctx.ref);
        const completedRounds = messages.filter(m => m.role === 'assistant').length;

        return yield* this.executeLoop(ctx, completedRounds, []);
    }

    /**
     * Internal loop execution — shared by run() and resume().
     *
     * One call = one Round (a single user-initiated interaction).
     * The while-loop handles tool calls and auto-continue within that Round.
     * Each LLM exchange appends its delta messages to `currentPayload`.
     * On completion, all exchanges are packed into a single Round.payload
     * so fold() reconstructs a correct multi-exchange history.
     *
     * @param ctx          Loop context
     * @param startRound    Starting round number (0 fresh, N for resume)
     * @param initialRounds Previously completed rounds (empty for fresh)
     */
    private async *executeLoop(
        ctx: LoopContext,
        startRound: number,
        initialRounds: Round[],
    ): AsyncGenerator<AgentEvent, Round[], Signal | undefined> {
        const maxRounds = 50;
        let exchangeNumber = startRound;
        const completedRounds: Round[] = [...initialRounds];
        let signal: Signal | undefined;

        // Messages from history (fold once, extend in-memory for subsequent exchanges)
        let baseMessages = await ctx.log.fold(ctx.ref);

        // Apply historyLength limit (system messages are never counted/truncated)
        if (ctx.historyLength !== undefined && ctx.historyLength !== -1 && ctx.historyLength >= 0) {
            const sys = baseMessages.filter(m => m.role === 'system');
            const rest = baseMessages.filter(m => m.role !== 'system');
            baseMessages = [...sys, ...rest.slice(-ctx.historyLength)];
        }

        // Prepend systemPrompt, deduplicating any system message already in fold result
        if (ctx.systemPrompt) {
            baseMessages = [{ role: 'system' as const, content: ctx.systemPrompt }, ...baseMessages.filter(m => m.role !== 'system')];
        }

        // Delta payload for this Round — accumulates across exchanges (tool calls, auto-continue).
        // task-runner prepends the user message on persist, so we start empty here.
        const currentPayload: import('@itookit/common').ChatMessage[] = [];
        let totalUsage: TokenUsage = {};

        try {
            while (exchangeNumber < maxRounds) {
                if (ctx.signal.aborted) break;

                exchangeNumber++;

                // ── Build message list for this exchange ──
                // base history + everything accumulated so far in this Round
                let messages: import('@itookit/common').ChatMessage[] = [...baseMessages, ...currentPayload];

                // ── Provider validation (Phase 2: moved from RoundLog.fold) ──
                const adapter = new ProviderMessageAdapter();
                try {
                    messages = adapter.validate(messages, { provider: 'anthropic' });
                } catch (err) {
                    yield {
                        type: 'error',
                        error: {
                            message: `Provider validation failed: ${err instanceof Error ? err.message : String(err)}`,
                            code: 'PROVIDER_VALIDATION',
                        },
                    };
                    break;
                }

                // ── Before-exchange middleware ──
                const roundCtx: ExchangeContext = {
                    roundId: `round_${ctx.sessionId}_${exchangeNumber}`,
                    sessionId: ctx.sessionId,
                    roundNumber: exchangeNumber,
                };

                const beforeDirective = await this.pipeline.applyBeforeExchange(roundCtx);
                if (beforeDirective) {
                    if (beforeDirective.action === 'abort') {
                        yield {
                            type: 'error',
                            error: { message: beforeDirective.reason, code: 'BUDGET_EXHAUSTED' },
                        };
                        break;
                    }
                    if (beforeDirective.action === 'skip_round') continue;
                    if (beforeDirective.action === 'inject') {
                        const injectMsg = { role: 'user' as const, content: beforeDirective.text };
                        messages = [...messages, injectMsg];
                        currentPayload.push(injectMsg);
                    }
                }

                if (messages.length === 0) break;

                // ── LLM Call ──
                yield {
                    type: 'round:start',
                    roundId: roundCtx.roundId,
                    sessionId: ctx.sessionId,
                    round: exchangeNumber,
                };

                let responseText = '';
                let thinkingText = '';
                let toolCalls: ToolCall[] = [];
                let usage: TokenUsage = {};
                let finishReason: string | undefined;
                const assistantBlocks: AssistantBlock[] = [];

                try {
                    const stream = ctx.llm.chatStream(ctx.connectionId ?? 'default', {
                        messages,
                        model: ctx.model,
                        temperature: ctx.temperature,
                        maxTokens: ctx.maxTokens,
                        thinking: ctx.thinking,
                        reasoningEffort: ctx.reasoningEffort as any,
                        signal: ctx.signal,
                    });

                    for await (const chunk of stream) {
                        if (ctx.signal.aborted) break;

                        const choice = chunk.choices?.[0];
                        const delta = choice?.delta;
                        if (!delta) continue;

                        if (delta.thinking) {
                            thinkingText += delta.thinking;
                            yield { type: 'stream:thinking', delta: delta.thinking };
                        }

                        if (delta.content) {
                            responseText += delta.content;
                            assistantBlocks.push({ type: 'text', text: delta.content });
                            yield { type: 'stream:content', delta: delta.content };
                        }

                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const existing = toolCalls.find(c => c.id === tc.id);
                                if (existing) {
                                    if (tc.function?.arguments) {
                                        existing.function!.arguments += tc.function.arguments;
                                    }
                                } else if (tc.id) {
                                    toolCalls.push({
                                        id: tc.id,
                                        type: 'function',
                                        function: {
                                            name: tc.function?.name ?? '',
                                            arguments: tc.function?.arguments ?? '',
                                        },
                                    });
                                }
                            }
                        }

                        if (choice?.finish_reason) finishReason = choice.finish_reason;

                        if (chunk.usage) {
                            usage = {
                                inputTokens: chunk.usage.prompt_tokens ?? 0,
                                outputTokens: chunk.usage.completion_tokens ?? 0,
                            };
                        }
                    }
                } catch (err) {
                    const recoveryAction: RecoveryAction | void = await this.pipeline.applyOnError(
                        roundCtx,
                        err instanceof Error ? err : new Error(String(err)),
                    );

                    if (!recoveryAction || recoveryAction.action === 'fail') {
                        yield {
                            type: 'error',
                            error: {
                                message: err instanceof Error ? err.message : String(err),
                                stack: err instanceof Error ? err.stack : undefined,
                            },
                        };
                        break;
                    }

                    if (recoveryAction.action === 'retry') {
                        if (recoveryAction.delayMs) {
                            await new Promise(r => setTimeout(r, recoveryAction.delayMs));
                        }
                        continue;
                    }

                    yield {
                        type: 'error',
                        error: { message: `Recovery action "${recoveryAction.action}" not fully implemented` },
                    };
                    break;
                }

                // Accumulate usage across exchanges
                totalUsage = {
                    inputTokens: ((totalUsage.inputTokens as number | undefined) ?? 0) + ((usage.inputTokens as number | undefined) ?? 0),
                    outputTokens: ((totalUsage.outputTokens as number | undefined) ?? 0) + ((usage.outputTokens as number | undefined) ?? 0),
                };

                // ── Build assistant message delta for this exchange ──
                for (const tc of toolCalls) {
                    assistantBlocks.push({
                        type: 'tool_use',
                        toolUseId: tc.id,
                        toolName: tc.function?.name ?? '',
                        toolInput: safeParseJson(tc.function?.arguments ?? '{}'),
                    });
                }

                // Persist this exchange's assistant message into the Round payload.
                // thinking is stored as a custom field so roundToProjection can recover it on reload.
                currentPayload.push({
                    role: 'assistant',
                    content: responseText,
                    ...(thinkingText ? { thinking: thinkingText } : {}),
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                } as import('@itookit/common').ChatMessage);

                // ── onToolCalls middleware ──
                if (toolCalls.length > 0) {
                    const plannedTools: PlannedTool[] = toolCalls.map(tc => ({
                        id: tc.id,
                        name: tc.function?.name ?? '',
                        arguments: safeParseJson(tc.function?.arguments ?? '{}'),
                    }));

                    const toolCallsDirective = await this.pipeline.applyOnToolCalls(roundCtx, plannedTools);
                    if (toolCallsDirective) {
                        if (toolCallsDirective.action === 'abort') {
                            yield { type: 'error', error: { message: toolCallsDirective.reason, code: 'PLAN_REJECTED' } };
                            break;
                        }
                        if (toolCallsDirective.action === 'pause') {
                            signal = yield {
                                type: 'await_signal',
                                request: toolCallsDirective.request,
                            } as AgentEvent;
                            if (signal?.type === 'abort') break;
                            if (signal?.type === 'respond') {
                                const resp = signal.response;
                                if (resp === false) {
                                    yield { type: 'error', error: { message: 'Plan rejected by user', code: 'PLAN_REJECTED' } };
                                    break;
                                }
                                if (typeof resp === 'string') {
                                    const adjustMsg = { role: 'user' as const, content: `[Plan adjustment] ${resp}` };
                                    currentPayload.push(adjustMsg);
                                    continue;
                                }
                            }
                        }
                        if (toolCallsDirective.action === 'inject') {
                            const injectMsg = { role: 'user' as const, content: toolCallsDirective.text };
                            currentPayload.push(injectMsg);
                            continue;
                        }
                    }
                }

                // ── Execute tools ──
                const toolResults: ToolExecResult[] = [];

                if (toolCalls.length > 0) {
                    const reads: ToolCall[] = [];
                    const writes: ToolCall[] = [];

                    for (const tc of toolCalls) {
                        const name = tc.function?.name ?? '';
                        const meta = ctx.tools.getToolMeta(name);
                        if (meta?.sideEffect === 'none') reads.push(tc);
                        else writes.push(tc);
                    }

                    for (const tc of reads) {
                        const name = tc.function?.name ?? '';
                        yield { type: 'tool:queued', call: { toolId: tc.id, name } };
                        yield { type: 'tool:running', call: { toolId: tc.id, name } };
                    }

                    const readResults = await Promise.all(reads.map(async (tc) => {
                        const name = tc.function?.name ?? '';
                        try {
                            const result = await ctx.tools.invoke({ toolId: name, args: safeParseJson(tc.function?.arguments ?? '{}') });
                            return { toolUseId: tc.id, name, content: result.output, isError: !result.success };
                        } catch (err) {
                            return { toolUseId: tc.id, name, content: err instanceof Error ? err.message : String(err), isError: true };
                        }
                    }));

                    for (const r of readResults) {
                        if (r.isError) {
                            yield { type: 'tool:error', call: { toolId: r.toolUseId, name: r.name, error: r.content } };
                        } else {
                            yield { type: 'tool:success', call: { toolId: r.toolUseId, name: r.name, result: r.content } };
                        }
                        toolResults.push(r);
                    }

                    for (const tc of writes) {
                        const name = tc.function?.name ?? '';
                        yield { type: 'tool:queued', call: { toolId: tc.id, name } };
                        yield { type: 'tool:running', call: { toolId: tc.id, name } };
                        try {
                            const result = await ctx.tools.invoke({ toolId: name, args: safeParseJson(tc.function?.arguments ?? '{}') });
                            yield { type: 'tool:success', call: { toolId: tc.id, name, result: result.output } };
                            toolResults.push({ toolUseId: tc.id, content: result.output, isError: !result.success });
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            yield { type: 'tool:error', call: { toolId: tc.id, name, error: msg } };
                            toolResults.push({ toolUseId: tc.id, content: msg, isError: true });
                        }
                    }

                    // Append tool results to payload so next exchange sees them
                    for (const r of toolResults) {
                        currentPayload.push({
                            role: 'tool' as const,
                            content: r.content,
                            tool_call_id: r.toolUseId,
                        } as import('@itookit/common').ChatMessage);
                    }
                }

                // ── After-exchange middleware ──
                const roundResult: RoundResult = {
                    assistantBlocks: assistantBlocks.map(b => ({
                        type: b.type,
                        ...(b.text ? { text: b.text } : {}),
                        ...(b.toolUseId ? { toolUseId: b.toolUseId, toolName: b.toolName, toolInput: b.toolInput } : {}),
                    })),
                    toolResults,
                    usage,
                    finishReason,
                };

                const afterDirective = await this.pipeline.applyAfterExchange(roundCtx, roundResult);
                if (afterDirective) {
                    if (afterDirective.action === 'abort') {
                        yield { type: 'error', error: { message: afterDirective.reason, code: 'AFTER_EXCHANGE_ABORT' } };
                        break;
                    }
                    if (afterDirective.action === 'inject') {
                        // Auto-continue: inject prompt is persisted in payload so fold() and resume see it
                        const injectMsg = { role: 'user' as const, content: afterDirective.text };
                        currentPayload.push(injectMsg);
                        yield {
                            type: 'round:end',
                            roundId: roundCtx.roundId,
                            sessionId: ctx.sessionId,
                            round: exchangeNumber,
                        };
                        continue;
                    }
                    if (afterDirective.action === 'pause') {
                        signal = yield {
                            type: 'await_signal',
                            request: afterDirective.request,
                        } as AgentEvent;
                        if (signal?.type === 'abort') break;
                        if (signal?.type === 'respond') {
                            const resp = signal.response;
                            if (typeof resp === 'string') {
                                const respondMsg = { role: 'user' as const, content: resp };
                                currentPayload.push(respondMsg);
                            }
                            continue;
                        }
                    }
                }

                yield {
                    type: 'round:end',
                    roundId: roundCtx.roundId,
                    sessionId: ctx.sessionId,
                    round: exchangeNumber,
                };

                // No tool calls and no continue directive — this Round is complete
                if (toolCalls.length === 0) break;
            }
        } finally {
            let inTokens = 0;
            let outTokens = 0;
            // completedRounds is empty for a single-round run; totalUsage covers this run
            inTokens += (totalUsage.inputTokens as number | undefined) ?? 0;
            outTokens += (totalUsage.outputTokens as number | undefined) ?? 0;
            yield { type: 'finished', usage: { inputTokens: inTokens, outputTokens: outTokens } };
        }

        // Pack all exchanges into a single Round.
        // task-runner will prepend the user message on persist.
        // payload structure: [assistant, tool_results?, user(inject)?, assistant, ...]
        // fold() traverses the parents chain and concatenates payloads,
        // so the LLM sees: [history..., user, assistant, tool, assistant, ...]
        const singleRound: Round = {
            id: ctx.preallocatedRoundId ?? `round_${ctx.sessionId}_${exchangeNumber}`,
            parents: [],
            payload: currentPayload,
            meta: {
                createdAt: Date.now(),
                origin: 'loop',
                usage: totalUsage,
                historyPolicy: 'include',
            },
            result: {
                assistantBlocks: [],
                toolResults: [],
                usage: totalUsage,
                finishReason: undefined,
            },
        };

        completedRounds.push(singleRound);
        return completedRounds;
    }
}

// ─── helpers ─────────────────────────────────────────────────────────

function safeParseJson(raw: string): Record<string, unknown> {
    try {
        return JSON.parse(raw);
    } catch {
        return { _raw: raw };
    }
}
