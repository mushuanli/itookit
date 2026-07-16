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
//   6. After-turn hooks (back-pressure via middleware)
//   7. Checkpoint → yield turn:end → continue or return

import type {
    ILoop,
    LoopContext,
    Turn,
    TurnContext,
    TurnResult,
    AgentEvent,
    Signal,
    ILoopMiddleware,
    RecoveryAction,
    TokenUsage,
    ToolCall,
    PlannedTool,
} from '@itookit/common';
import { composeMiddleware, type MiddlewarePipeline } from '../core/middleware-pipeline';

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

    async *run(ctx: LoopContext): AsyncGenerator<AgentEvent, Turn[], Signal | undefined> {
        this.lastCtx = ctx;
        return yield* this.executeLoop(ctx, 0, []);
    }

    async *resume(_checkpoint: string): AsyncGenerator<AgentEvent, Turn[], Signal | undefined> {
        const ctx = this.lastCtx;
        if (!ctx) {
            yield {
                type: 'error',
                error: { message: 'Cannot resume: no prior context. Call run() first.', code: 'NO_CONTEXT' },
            };
            return [];
        }

        // Reconstruct state from the Log.
        // Since turn boundaries are persisted, we count completed turns
        // and re-enter the loop at the next turn.
        const messages = await ctx.log.fold(ctx.ref);
        const completedTurns = messages.filter(m => m.role === 'assistant').length;

        return yield* this.executeLoop(ctx, completedTurns, []);
    }

    /**
     * Internal loop execution — shared by run() and resume().
     *
     * @param ctx          Loop context (stored during run())
     * @param startTurn    Starting turn number (0 for fresh, N for resume)
     * @param initialTurns Previously completed turns (empty for fresh)
     */
    private async *executeLoop(
        ctx: LoopContext,
        startTurn: number,
        initialTurns: Turn[],
    ): AsyncGenerator<AgentEvent, Turn[], Signal | undefined> {
        const maxTurns = 50;
        let turnNumber = startTurn;
        const turns: Turn[] = [...initialTurns];
        let signal: Signal | undefined;

        try {
            while (turnNumber < maxTurns) {
                // Check hard abort
                if (ctx.signal.aborted) break;

                turnNumber++;

                // ── Process pending injection signal ──
                if (signal?.type === 'inject') {
                    // Injection is handled by the caller via log.append
                    // before re-entering the loop; the signal carries the text
                    signal = undefined;
                }

                // ── 1. Build messages from log ──
                let messages = await ctx.log.fold(ctx.ref);

                // Apply historyLength limit (system messages are never counted/truncated)
                if (ctx.historyLength !== undefined && ctx.historyLength !== -1 && ctx.historyLength >= 0) {
                    const sys = messages.filter(m => m.role === 'system');
                    const rest = messages.filter(m => m.role !== 'system');
                    messages = [...sys, ...rest.slice(-ctx.historyLength)];
                }

                // Prepend systemPrompt, deduplicating any system message already in fold result
                if (ctx.systemPrompt) {
                    messages = [{ role: 'system' as const, content: ctx.systemPrompt }, ...messages.filter(m => m.role !== 'system')];
                }

                // ── 1b. Before-turn middleware ──
                const turnCtx: TurnContext = {
                    turnId: `turn_${ctx.sessionId}_${turnNumber}`,
                    sessionId: ctx.sessionId,
                    turnNumber,
                };

                const beforeDirective = await this.pipeline.applyBeforeTurn(turnCtx);
                if (beforeDirective) {
                    if (beforeDirective.action === 'abort') {
                        yield {
                            type: 'error',
                            error: { message: beforeDirective.reason, code: 'BUDGET_EXHAUSTED' },
                        };
                        break;
                    }
                    if (beforeDirective.action === 'skip_turn') continue;
                    if (beforeDirective.action === 'inject') {
                        // Inject feedback text as a user message
                        messages = [...messages, { role: 'user' as const, content: beforeDirective.text }];
                    }
                }

                if (messages.length === 0) {
                    // Nothing to respond to — wait for user input
                    break;
                }

                // ── 2. LLM Call ──
                yield {
                    type: 'turn:start',
                    turnId: turnCtx.turnId,
                    sessionId: ctx.sessionId,
                    turn: turnNumber,
                };

                let responseText = '';
                let toolCalls: ToolCall[] = [];
                let usage: TokenUsage = {};
                let finishReason: string | undefined;
                const assistantBlocks: AssistantBlock[] = [];

                try {
                    // Use streaming for content; collect tool_calls from final chunk
                    const stream = ctx.llm.chatStream(ctx.connectionId ?? 'default', {
                        messages,
                        tools: undefined, // tools injected via LoopContext.tools if needed
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

                        // Capture finish_reason from the final chunk
                        if (choice?.finish_reason) {
                            finishReason = choice.finish_reason;
                        }

                        // Collect usage from final chunks
                        if (chunk.usage) {
                            usage = {
                                inputTokens: chunk.usage.prompt_tokens ?? 0,
                                outputTokens: chunk.usage.completion_tokens ?? 0,
                            };
                        }
                    }
                } catch (err) {
                    // ── Error recovery via middleware ──
                    const recoveryAction: RecoveryAction | void = await this.pipeline.applyOnError(
                        turnCtx,
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
                        continue; // retry the turn
                    }

                    // compress / fallback: break out (simplified)
                    yield {
                        type: 'error',
                        error: { message: `Recovery action "${recoveryAction.action}" not fully implemented` },
                    };
                    break;
                }

                // ── 4. Build assistant blocks from tool calls ──
                for (const tc of toolCalls) {
                    assistantBlocks.push({
                        type: 'tool_use',
                        toolUseId: tc.id,
                        toolName: tc.function?.name ?? '',
                        toolInput: safeParseJson(tc.function?.arguments ?? '{}'),
                    });
                }

                // ── 4b. onToolCalls middleware (plan confirm before execution) ──
                if (toolCalls.length > 0) {
                    const plannedTools: PlannedTool[] = toolCalls.map(tc => ({
                        id: tc.id,
                        name: tc.function?.name ?? '',
                        arguments: safeParseJson(tc.function?.arguments ?? '{}'),
                    }));

                    const toolCallsDirective = await this.pipeline.applyOnToolCalls(turnCtx, plannedTools);
                    if (toolCallsDirective) {
                        if (toolCallsDirective.action === 'abort') {
                            yield { type: 'error', error: { message: toolCallsDirective.reason, code: 'PLAN_REJECTED' } };
                            break;
                        }
                        if (toolCallsDirective.action === 'pause') {
                            // Pause for user confirmation — drive() checkpoints, waits for Signal,
                            // then resumes the generator with gen.next(signal).
                            signal = yield {
                                type: 'await_signal',
                                request: toolCallsDirective.request,
                            } as AgentEvent;
                            // signal is the Signal passed by drive() via gen.next(signal)
                            if (signal?.type === 'abort') break;
                            if (signal?.type === 'respond') {
                                const resp = signal.response;
                                if (resp === false) {
                                    yield { type: 'error', error: { message: 'Plan rejected by user', code: 'PLAN_REJECTED' } };
                                    break;
                                }
                                if (typeof resp === 'string') {
                                    // User modified the plan — inject as correction, skip tools this turn
                                    messages.push({ role: 'user', content: `[Plan adjustment] ${resp}` });
                                    continue;
                                }
                            }
                            // true, undefined, or unrecognized → approved, proceed to tool execution
                        }
                        if (toolCallsDirective.action === 'inject') {
                            messages.push({ role: 'user', content: toolCallsDirective.text });
                            continue;
                        }
                    }
                }

                // ── 5. Execute tools ──
                const toolResults: ToolExecResult[] = [];

                if (toolCalls.length > 0) {
                    // Separate reads (parallel) from writes (serial)
                    const reads: ToolCall[] = [];
                    const writes: ToolCall[] = [];

                    for (const tc of toolCalls) {
                        const name = tc.function?.name ?? '';
                        const meta = ctx.tools.getToolMeta(name);
                        if (meta?.sideEffect === 'none') {
                            reads.push(tc);
                        } else {
                            writes.push(tc);
                        }
                    }

                    // Queue all reads
                    for (const tc of reads) {
                        const name = tc.function?.name ?? '';
                        yield { type: 'tool:queued', call: { toolId: tc.id, name } };
                        yield { type: 'tool:running', call: { toolId: tc.id, name } };
                    }

                    // Execute reads in parallel (no yield inside Promise.all)
                    const readPromises = reads.map(async (tc) => {
                        const name = tc.function?.name ?? '';
                        try {
                            const result = await ctx.tools.invoke({
                                toolId: name,
                                args: safeParseJson(tc.function?.arguments ?? '{}'),
                            });
                            return { toolUseId: tc.id, name, content: result.output, isError: !result.success };
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            return { toolUseId: tc.id, name, content: msg, isError: true };
                        }
                    });
                    const readResults = await Promise.all(readPromises);

                    // Emit success/error events for reads
                    for (const r of readResults) {
                        if (r.isError) {
                            yield { type: 'tool:error', call: { toolId: r.toolUseId, name: r.name, error: r.content } };
                        } else {
                            yield { type: 'tool:success', call: { toolId: r.toolUseId, name: r.name, result: r.content } };
                        }
                        toolResults.push(r);
                    }

                    // Execute writes serially
                    for (const tc of writes) {
                        const name = tc.function?.name ?? '';
                        yield { type: 'tool:queued', call: { toolId: tc.id, name } };
                        yield { type: 'tool:running', call: { toolId: tc.id, name } };

                        try {
                            const result = await ctx.tools.invoke({
                                toolId: name,
                                args: safeParseJson(tc.function?.arguments ?? '{}'),
                            });
                            yield { type: 'tool:success', call: { toolId: tc.id, name, result: result.output } };
                            toolResults.push({ toolUseId: tc.id, content: result.output, isError: !result.success });
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            yield { type: 'tool:error', call: { toolId: tc.id, name, error: msg } };
                            toolResults.push({ toolUseId: tc.id, content: msg, isError: true });
                        }
                    }
                }

                // ── 6. After-turn middleware (back-pressure) ──
                const turnResult: TurnResult = {
                    assistantBlocks: assistantBlocks.map(b => ({
                        type: b.type,
                        ...(b.text ? { text: b.text } : {}),
                        ...(b.toolUseId ? { toolUseId: b.toolUseId, toolName: b.toolName, toolInput: b.toolInput } : {}),
                    })),
                    toolResults,
                    usage,
                    finishReason,
                };

                const afterDirective = await this.pipeline.applyAfterTurn(turnCtx, turnResult);
                if (afterDirective) {
                    if (afterDirective.action === 'abort') {
                        yield { type: 'error', error: { message: afterDirective.reason, code: 'AFTERTURN_ABORT' } };
                        break;
                    }
                    if (afterDirective.action === 'inject') {
                        messages.push({ role: 'user', content: afterDirective.text });
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
                                messages.push({ role: 'user', content: resp });
                            }
                            continue;
                        }
                    }
                }

                // ── 7. Build the turn and checkpoint ──
                const turnId = `turn_${ctx.sessionId}_${turnNumber}`;
                const turn: Turn = {
                    id: turnId,
                    parents: turns.length > 0 ? [turns[turns.length - 1].id] : [],
                    payload: [
                        ...messages,
                        {
                            role: 'assistant',
                            content: responseText,
                            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                        },
                    ],
                    meta: {
                        createdAt: Date.now(),
                        origin: 'loop',
                        usage,
                    },
                    result: turnResult,
                };

                turns.push(turn);

                // Append to log
                await ctx.log.append(ctx.ref, turn);

                yield {
                    type: 'turn:end',
                    turnId,
                    sessionId: ctx.sessionId,
                    turn: turnNumber,
                };

                // If no tool calls, we're done
                if (toolCalls.length === 0) {
                    break;
                }

                // Otherwise continue the loop with tool results fed back
                // The next fold() will include the tool results via log
            }
        } finally {
            // Always emit finished
            let inTokens = 0;
            let outTokens = 0;
            for (const t of turns) {
                inTokens += (t.meta.usage as any)?.inputTokens ?? 0;
                outTokens += (t.meta.usage as any)?.outputTokens ?? 0;
            }
            yield { type: 'finished', usage: { inputTokens: inTokens, outputTokens: outTokens } };
        }

        return turns;
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
