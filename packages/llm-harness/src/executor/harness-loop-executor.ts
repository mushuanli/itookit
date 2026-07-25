// HarnessLoopExecutor — full-featured ILoop implementation backed by llm-harness services.
//
// Mirrors AgentLoopExecutor's while(true) loop but uses AsyncGenerator (yield AgentEvent)
// and composes middleware for cross-cutting concerns.
//
// Loop invariant (each round):
//   1. Flush injections (HITL middleware beforeExchange)
//   2. Budget check + auto-downgrade (budget middleware beforeExchange)
//   3. Context compress (compression middleware beforeExchange)
//   4. Build system prompt + messages from ContextManager
//   5. LLM call (streaming via ILLMService.chatStream)
//   6. Error recovery (error-recovery middleware onError → retry/compress/fallback)
//   7. Parse tool calls (structured + XML fallback)
//   8. onToolCalls middleware (plan confirm → pause)
//   9. Execute tools (reads parallel, writes serial)
//  10. afterExchange middleware (back-pressure → inject)
//  11. Build round → log.append() → yield round:end
//  12. No tool calls → break; otherwise continue

import type {
    ILoop,
    LoopContext,
    Round,
    ExchangeContext,
    RoundResult,
    AgentEvent,
    Signal,
    ControlDirective,
    RecoveryAction,
    TokenUsage,
    ToolCall,
    PlannedTool,
} from '@itookit/common';
import type {
    ILLMService,
    IToolService,
    ISkillService,
    ISubAgentRouter,
    AgentModelRoles,
    AgentLoopConfig,
    AgentBudgetLimits,
    ModelTier,
} from '@itookit/common';
import { BudgetExhaustedError, resolveModelForTier } from '@itookit/common';
import { BudgetController } from './budget-controller';
import { ContextManager } from './context-manager';
import { BackPressureValidator } from './back-pressure';
import { getToolName, getToolArgs, extractXmlToolCalls } from '../utils/tool-call';
import {
    createHarnessBudgetMiddleware,
    createHarnessErrorRecoveryMiddleware,
    createHarnessHITLMiddleware,
    createHarnessBackPressureMiddleware,
    createHarnessCompressionMiddleware,
    createHarnessSkillsMiddleware,
    type HarnessBudgetState,
    type HarnessTierState,
    type HarnessSessionState,
    type HarnessEventEmitter,
} from './harness-middleware';
import type { ILoopMiddleware } from '@itookit/common';

// ─── Types ───────────────────────────────────────────────────────────

const MAX_ROUNDS = 100;

// ─── Inline middleware runner (avoids cross-package dependency) ──────

function runBeforeExchange(mws: ILoopMiddleware[], ctx: ExchangeContext): Promise<ControlDirective | void> {
    return runForward(mws, 'beforeExchange', (mw) => mw.beforeExchange?.(ctx));
}

function runOnToolCalls(mws: ILoopMiddleware[], ctx: ExchangeContext, tools: PlannedTool[]): Promise<ControlDirective | void> {
    return runForward(mws, 'onToolCalls', (mw) => mw.onToolCalls?.(ctx, tools));
}

function runAfterExchange(mws: ILoopMiddleware[], ctx: ExchangeContext, result: RoundResult): Promise<ControlDirective | void> {
    // Reverse order for afterExchange (stack unwinding)
    const reversed = [...mws].reverse();
    return runForward(reversed, 'afterExchange', (mw) => mw.afterExchange?.(ctx, result));
}

function runOnError(mws: ILoopMiddleware[], ctx: ExchangeContext, error: Error): Promise<RecoveryAction | void> {
    return runForward(mws, 'onError', (mw) => mw.onError?.(ctx, error));
}

async function runForward<T>(
    mws: ILoopMiddleware[],
    _hook: string,
    fn: (mw: ILoopMiddleware) => Promise<T | void> | undefined,
): Promise<T | void> {
    for (const mw of mws) {
        const result = await fn(mw);
        if (result !== undefined) return result;
    }
}

// ─── HarnessLoopExecutor ─────────────────────────────────────────────

export class HarnessLoopExecutor implements ILoop {
    readonly mode = 'harness';

    private lastCtx: LoopContext | null = null;

    constructor(
        private readonly llm: ILLMService,
        private readonly toolService: IToolService,
        private readonly skillService: ISkillService,
        private readonly modelRoles: AgentModelRoles,
        private readonly loopConfig: AgentLoopConfig,
        private readonly budgetLimits: AgentBudgetLimits,
        _subAgentRouter: ISubAgentRouter,
        private readonly maxContextTokens = 200_000,
        private readonly costModel?: { perInputToken: number; perOutputToken: number },
    ) {}

    async *run(ctx: LoopContext): AsyncGenerator<AgentEvent, Round[], Signal | undefined> {
        this.lastCtx = ctx;
        const sessionId = ctx.sessionId;
        const cwd = typeof process !== 'undefined' ? process.cwd() : '/';

        // ── Per-session service setup ──
        const budgetController = new BudgetController(this.budgetLimits, this.costModel);
        const usage = budgetController.createSnapshot();

        const contextManager = new ContextManager(
            this.llm, this.skillService,
            this.maxContextTokens, this.loopConfig.systemPromptBudgetTokens,
            this.modelRoles.summarizer,
        );
        contextManager.initSession(sessionId, cwd, '');

        const initialMessages = ctx.contextSnapshot
            ? [...ctx.contextSnapshot.canonicalMessages]
            : await ctx.log.fold(ctx.ref);
        const taskPrompt = initialMessages.find(m => m.role === 'user')?.content as string ?? '';
        contextManager.addMessage(sessionId, { role: 'user', content: taskPrompt });
        contextManager.autoDetectAndLoadSkills(sessionId, taskPrompt);

        // Resolve model tiers
        let effectiveModelId: string | undefined;
        let currentTier: ModelTier = 'optimal';
        const tierModelIds: Partial<Record<ModelTier, string>> = {};
        const primaryConn = this.modelRoles.primary;
        try {
            const connMeta = await this.llm.getConnection(primaryConn);
            if (connMeta?.tiers) {
                Object.assign(tierModelIds, connMeta.tiers);
                effectiveModelId = resolveModelForTier(connMeta, currentTier);
            }
        } catch { /* use primaryConn as-is */ }

        const backPressure = new BackPressureValidator(this.loopConfig.backPressureRules);

        // ── Shared state for middleware ──
        const budgetState: HarnessBudgetState = { snapshot: usage, controller: budgetController };
        const tierState: HarnessTierState = { effectiveModelId, currentTier, tierModelIds, modelPinned: false };
        const sessionState: HarnessSessionState = { cwd, isFirstRound: true, pendingInjections: [] };

        const recoveryState = {
            rateLimitRetries: 0, contextRetries: 0,
            currentConnectionId: primaryConn,
            fallbackConnectionId: this.modelRoles.fallback,
            fallbackActive: false,
        };

        // Event emitter bridge (middleware → yield)
        const eventQueue: AgentEvent[] = [];
        const emit: HarnessEventEmitter = (event) => { eventQueue.push(event); };

        // ── Build middleware array (sorted by name for determinism) ──
        const middlewares: ILoopMiddleware[] = [
            createHarnessBudgetMiddleware(budgetState, tierState, this.budgetLimits, emit),
            createHarnessErrorRecoveryMiddleware(recoveryState, this.loopConfig,
                async () => { await contextManager.forceCompress(sessionId); }, emit),
            createHarnessHITLMiddleware(sessionState, this.loopConfig.enablePlanConfirm),
            createHarnessBackPressureMiddleware(backPressure, cwd, emit),
            createHarnessCompressionMiddleware(contextManager, sessionId,
                this.loopConfig.compressionThreshold, emit),
            createHarnessSkillsMiddleware(contextManager, sessionId, taskPrompt, emit),
            ...ctx.middlewares,
        ].sort((a, b) => a.name.localeCompare(b.name));

        // ── Main loop ──
        let roundNumber = 0;
        const rounds: Round[] = [];
        let signal: Signal | undefined;

        try {
            while (roundNumber < MAX_ROUNDS) {
                if (ctx.signal.aborted) break;
                roundNumber++;

                // Drain event queue
                while (eventQueue.length > 0) yield eventQueue.shift()!;

                // ── 1-4. beforeExchange middleware ──
                const roundId = `round_${sessionId}_${roundNumber}`;
                const roundCtx: ExchangeContext = { roundId, sessionId, roundNumber };

                const beforeDirective = await runBeforeExchange(middlewares, roundCtx);
                if (beforeDirective) {
                    if (beforeDirective.action === 'abort') {
                        yield { type: 'error', error: { message: beforeDirective.reason, code: 'BUDGET_EXHAUSTED' } };
                        break;
                    }
                    if (beforeDirective.action === 'inject') {
                        contextManager.addMessage(sessionId, { role: 'user', content: beforeDirective.text });
                    }
                    if (beforeDirective.action === 'skip_round') continue;
                }

                // ── 5. Build messages ──
                const messages = [
                    { role: 'system' as const, content: contextManager.buildSystemPrompt(sessionId) },
                    ...contextManager.buildMessages(sessionId),
                ];

                yield { type: 'round:start', roundId, sessionId, round: roundNumber };
                while (eventQueue.length > 0) yield eventQueue.shift()!;

                // ── 6. LLM call (streaming) ──
                let responseText = '';
                let toolCalls: ToolCall[] = [];
                let usage_: TokenUsage = {};
                let finishReason: string | undefined;
                const connId = recoveryState.currentConnectionId;
                const toolDefs = this.toolService.getToolDefinitions();
                const effectiveTools = toolDefs.length > 0 ? toolDefs : undefined;

                try {
                    const stream = this.llm.chatStream(connId, {
                        messages, tools: effectiveTools, signal: ctx.signal,
                        model: tierState.effectiveModelId, _label: sessionId,
                    });

                    for await (const chunk of stream) {
                        if (ctx.signal.aborted) break;
                        const choice = chunk.choices?.[0];
                        const delta = choice?.delta;
                        if (!delta) continue;

                        if (delta.content) {
                            responseText += delta.content;
                            yield { type: 'stream:content', delta: delta.content };
                        }
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const existing = toolCalls.find(c => c.id === tc.id);
                                if (existing) {
                                    if (tc.function?.arguments) existing.function!.arguments += tc.function.arguments;
                                } else if (tc.id) {
                                    toolCalls.push({ id: tc.id, type: 'function', function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' } });
                                }
                            }
                        }
                        if (choice?.finish_reason) finishReason = choice.finish_reason;
                        if (chunk.usage) {
                            usage_ = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
                        }
                    }
                } catch (err) {
                    // ── 7. Error recovery ──
                    const recoveryAction = await runOnError(middlewares, roundCtx,
                        err instanceof Error ? err : new Error(String(err)));

                    if (!recoveryAction || recoveryAction.action === 'fail') {
                        yield { type: 'error', error: { message: err instanceof Error ? err.message : String(err) } };
                        break;
                    }
                    if (recoveryAction.action === 'retry') {
                        if (recoveryAction.delayMs) await new Promise(r => setTimeout(r, recoveryAction.delayMs));
                        recoveryState.rateLimitRetries = 0;
                        continue;
                    }
                    if (recoveryAction.action === 'compress') {
                        await contextManager.forceCompress(sessionId);
                        continue;
                    }
                    if (recoveryAction.action === 'fallback') {
                        recoveryState.currentConnectionId = recoveryAction.connectionId;
                        continue;
                    }
                    // Exhaustive — all RecoveryAction variants handled above
                    yield { type: 'error', error: { message: `Unhandled recovery` } };
                    break;
                }

                // ── 8. Parse tool calls ──
                if (toolCalls.length === 0 && effectiveTools !== undefined && responseText.includes('<tool_call>')) {
                    const extracted = extractXmlToolCalls(responseText);
                    if (extracted.calls.length > 0) {
                        toolCalls = extracted.calls;
                        responseText = extracted.cleanText;
                    }
                }

                contextManager.addMessage(sessionId, {
                    role: 'assistant', content: responseText,
                    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                });
                budgetController.updateUsage(usage, usage_, toolCalls.length);

                while (eventQueue.length > 0) yield eventQueue.shift()!;

                // ── 9. onToolCalls middleware ──
                if (toolCalls.length > 0) {
                    const plannedTools: PlannedTool[] = toolCalls.map(tc => ({
                        id: tc.id, name: tc.function?.name ?? '',
                        arguments: safeParseJson(tc.function?.arguments ?? '{}'),
                    }));

                    const directive = await runOnToolCalls(middlewares, roundCtx, plannedTools);
                    if (directive) {
                        if (directive.action === 'abort') {
                            yield { type: 'error', error: { message: directive.reason, code: 'PLAN_REJECTED' } };
                            break;
                        }
                        if (directive.action === 'pause') {
                            signal = yield { type: 'await_signal', request: directive.request } as AgentEvent;
                            if (signal?.type === 'abort') break;
                            if (signal?.type === 'respond') {
                                const resp = signal.response;
                                if (resp === false) {
                                    yield { type: 'error', error: { message: 'Plan rejected by user', code: 'PLAN_REJECTED' } };
                                    break;
                                }
                                if (typeof resp === 'string') {
                                    contextManager.addMessage(sessionId, { role: 'user', content: `[Plan adjustment] ${resp}` });
                                    continue;
                                }
                            }
                        }
                        if (directive.action === 'inject') {
                            contextManager.addMessage(sessionId, { role: 'user', content: directive.text });
                            continue;
                        }
                    }
                }

                // ── 10. Execute tools ──
                const toolResults: RoundResult['toolResults'] = [];
                const assistantBlocks: RoundResult['assistantBlocks'] = [];

                if (responseText) {
                    assistantBlocks.push({ type: 'text', text: responseText });
                }
                for (const tc of toolCalls) {
                    assistantBlocks.push({
                        type: 'tool_use', toolUseId: tc.id,
                        toolName: tc.function?.name ?? '',
                        toolInput: safeParseJson(tc.function?.arguments ?? '{}'),
                    });
                }

                if (toolCalls.length > 0) {
                    const reads = toolCalls.filter(
                        c => this.toolService.getToolMeta(getToolName(c))?.sideEffect === 'none',
                    );
                    const writes = toolCalls.filter(
                        c => this.toolService.getToolMeta(getToolName(c))?.sideEffect !== 'none',
                    );

                    // Reads in parallel
                    if (reads.length > 0) {
                        for (const tc of reads) {
                            yield { type: 'tool:queued', call: { toolId: tc.id, name: getToolName(tc) } };
                        }
                        const readResults = await Promise.all(reads.map(async (tc) => {
                            const name = getToolName(tc);
                            const args = getToolArgs(tc);
                            try {
                                const result = await this.toolService.invoke({ toolId: name, args, cwd });
                                // Post-process skill-loader tools
                                const meta = this.toolService.getToolMeta(name);
                                if (result.success && meta?.skillLoaderArgKey) {
                                    const skillId = args[meta.skillLoaderArgKey] as string | undefined;
                                    if (skillId) contextManager.markSkillLoaded(sessionId, skillId);
                                }
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
                    }

                    // Writes serially
                    for (const tc of writes) {
                        const name = getToolName(tc);
                        yield { type: 'tool:queued', call: { toolId: tc.id, name } };
                        yield { type: 'tool:running', call: { toolId: tc.id, name } };
                        try {
                            const result = await this.toolService.invoke({ toolId: name, args: getToolArgs(tc), cwd });
                            yield { type: 'tool:success', call: { toolId: tc.id, name, result: result.output } };
                            toolResults.push({ toolUseId: tc.id, content: result.output, isError: !result.success });
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            yield { type: 'tool:error', call: { toolId: tc.id, name, error: msg } };
                            toolResults.push({ toolUseId: tc.id, content: msg, isError: true });
                        }
                    }
                }

                // ── 11. afterExchange middleware ──
                const roundResult: RoundResult = { assistantBlocks, toolResults, usage: usage_, finishReason };
                const afterDirective = await runAfterExchange(middlewares, roundCtx, roundResult);
                if (afterDirective) {
                    if (afterDirective.action === 'abort') {
                        yield { type: 'error', error: { message: afterDirective.reason, code: 'AFTERROUND_ABORT' } };
                        break;
                    }
                    if (afterDirective.action === 'inject') {
                        contextManager.addMessage(sessionId, { role: 'user', content: afterDirective.text });
                        continue;
                    }
                    if (afterDirective.action === 'pause') {
                        signal = yield { type: 'await_signal', request: afterDirective.request } as AgentEvent;
                        if (signal?.type === 'abort') break;
                        if (signal?.type === 'respond' && typeof signal.response === 'string') {
                            contextManager.addMessage(sessionId, { role: 'user', content: signal.response });
                        }
                        continue;
                    }
                }

                // ── 12. Build round & checkpoint ──
                const round: Round = {
                    id: roundId,
                    parents: rounds.length > 0 ? [rounds[rounds.length - 1].id] : [],
                    payload: [
                        ...messages,
                        { role: 'assistant' as const, content: responseText, tool_calls: toolCalls.length > 0 ? toolCalls : undefined },
                    ],
                    meta: { createdAt: Date.now(), origin: 'loop', usage: usage_ },
                    result: roundResult,
                };
                rounds.push(round);
                await ctx.log.append(ctx.ref, round);
                yield { type: 'round:end', roundId, sessionId, round: roundNumber };

                // ── 13. Continue or break ──
                if (toolCalls.length === 0) break;

                // Feed tool results back for next round
                for (const tr of toolResults) {
                    contextManager.addMessage(sessionId, { role: 'tool', content: tr.content, tool_call_id: tr.toolUseId });
                }
                sessionState.isFirstRound = false;
            }
        } catch (err) {
            if (err instanceof BudgetExhaustedError) {
                yield { type: 'error', error: { message: `Budget exhausted: ${err.resource}`, code: 'BUDGET_EXHAUSTED' } };
            } else if (!ctx.signal.aborted) {
                yield { type: 'error', error: { message: err instanceof Error ? err.message : String(err) } };
            }
        } finally {
            while (eventQueue.length > 0) yield eventQueue.shift()!;

            let inTokens = 0, outTokens = 0;
            for (const t of rounds) {
                const u = t.meta.usage as Record<string, unknown> | undefined;
                inTokens += (u?.inputTokens as number) ?? 0;
                outTokens += (u?.outputTokens as number) ?? 0;
            }
            yield { type: 'finished', usage: { inputTokens: inTokens, outputTokens: outTokens } };
        }

        return rounds;
    }

    async *resume(_checkpoint: string): AsyncGenerator<AgentEvent, Round[], Signal | undefined> {
        const ctx = this.lastCtx;
        if (!ctx) {
            yield {
                type: 'error',
                error: { message: 'HarnessLoopExecutor.resume(): no prior context. Call run() first.', code: 'NO_CONTEXT' },
            };
            return [];
        }

        // Reconstruct state from the Log. Since round boundaries are persisted,
        // we count completed rounds and re-enter the loop with full history.
        const allMessages = ctx.contextSnapshot
            ? [...ctx.contextSnapshot.canonicalMessages]
            : await ctx.log.fold(ctx.ref);
        const completedRounds = allMessages.filter(m => m.role === 'assistant').length;

        if (completedRounds === 0) {
            return yield* this.run(ctx);
        }

        // Re-run with full log state. The LLM sees the complete conversation
        // history from log.fold() and continues naturally.
        // Full harness state reconstruction (BudgetController usage, tier state,
        // ContextManager seeding with all messages, round count tracking) is
        // deferred to a follow-up.
        return yield* this.run(ctx);
    }
}

// ─── helpers ─────────────────────────────────────────────────────────

function safeParseJson(raw: string): Record<string, unknown> {
    try { return JSON.parse(raw); } catch { return { _raw: raw }; }
}
