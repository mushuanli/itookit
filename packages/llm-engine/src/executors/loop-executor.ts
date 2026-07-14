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

    constructor(
        mode: string,
        middlewares: ILoopMiddleware[],
    ) {
        this.mode = mode;
        this.pipeline = composeMiddleware(middlewares);
    }

    async *run(ctx: LoopContext): AsyncGenerator<AgentEvent, Turn[], Signal | undefined> {
        const maxTurns = 50;
        let turnNumber = 0;
        const turns: Turn[] = [];
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

                // ── 1b. Before-turn middleware ──
                const turnCtx: TurnContext = {
                    turnId: `turn_${turnNumber}`,
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
                    const stream = ctx.llm.chatStream('default', {
                        messages,
                        tools: undefined, // tools injected via LoopContext.tools if needed
                        signal: ctx.signal,
                    });

                    for await (const chunk of stream) {
                        if (ctx.signal.aborted) break;

                        const choice = chunk.choices?.[0];
                        const delta = choice?.delta;
                        if (!delta) continue;

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
                if (afterDirective?.action === 'inject') {
                    // Back-pressure injected a correction — feed back to LLM
                    messages.push({ role: 'user', content: afterDirective.text });
                    continue;
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

    async *resume(_checkpoint: string): AsyncGenerator<AgentEvent, Turn[], Signal | undefined> {
        // Resume is not supported for loop executor in initial S3.
        // Full resume support requires checkpoint serialization (S4).
        const { notSupported } = await import('../core/loop-driver');
        notSupported(this.mode);
        // unreachable — satisfy AsyncGenerator return type
        yield { type: 'error' as any, error: { message: 'unreachable' } };
        return [];
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
