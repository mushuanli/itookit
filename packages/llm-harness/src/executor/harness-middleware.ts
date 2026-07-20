// Harness ILoopMiddleware — thin wrappers around llm-harness service classes.
//
// These 6 middleware factories adapt the existing harness classes
// (BudgetController, ContextManager, ErrorRecoveryService, BackPressureValidator,
//  HITLQueue, skill auto-loading) to the ILoopMiddleware interface.
//
// Design: each factory closes over shared mutable state and harness service
// references. The loop body and middleware share state via these closures.

import type {
    ILoopMiddleware,
    ExchangeContext,
    RoundResult,
    ControlDirective,
    RecoveryAction,
    AgentEvent,
    PlannedTool,
} from '@itookit/common';
import type {
    AgentUsageSnapshot,
    AgentBudgetLimits,
    AgentLoopConfig,
    ModelTier,
} from '@itookit/common';
import { BudgetExhaustedError, getNextLowerTier } from '@itookit/common';
import type { BudgetController } from './budget-controller';
import type { ContextManager } from './context-manager';
import type { BackPressureValidator } from './back-pressure';

// ─── Shared state (closed over by middleware + loop body) ────────────

export interface HarnessBudgetState {
    snapshot: AgentUsageSnapshot;
    controller: BudgetController;
}

export interface HarnessTierState {
    effectiveModelId: string | undefined;
    currentTier: ModelTier;
    tierModelIds: Partial<Record<ModelTier, string>>;
    /** When true, skip auto-downgrade (model pinned explicitly). */
    modelPinned: boolean;
}

export interface HarnessSessionState {
    /** Working directory for back-pressure shell commands. */
    cwd: string;
    /** First-round flag for plan confirm + skill auto-load. */
    isFirstRound: boolean;
    /** Pending injections flushed at round start. */
    pendingInjections: string[];
}

/**
 * Event emitter bridge — middleware push events into this queue,
 * the AsyncGenerator loop body drains and yields them.
 */
export type HarnessEventEmitter = (event: AgentEvent) => void;

// ─── 01-budget ──────────────────────────────────────────────────────

export function createHarnessBudgetMiddleware(
    state: HarnessBudgetState,
    tier: HarnessTierState,
    _limits: AgentBudgetLimits,
    emit: HarnessEventEmitter,
): ILoopMiddleware {
    return {
        name: '01-budget',

        async beforeExchange(_ctx: ExchangeContext): Promise<ControlDirective | void> {
            try {
                state.controller.checkOrThrow(state.snapshot);
            } catch (err) {
                if (err instanceof BudgetExhaustedError) {
                    emit({
                        type: 'error',
                        error: {
                            message: `Budget exhausted: ${err.resource}`,
                            code: 'BUDGET_EXHAUSTED',
                        },
                    });
                    return {
                        action: 'abort',
                        reason: `Budget exhausted: ${err.resource} (${err.used}/${err.limit})`,
                    };
                }
                throw err;
            }

            // Warn + auto-downgrade model tier when approaching limits
            const approaching = state.controller.getApproachingLimits(state.snapshot);
            for (const resource of approaching) {
                const usedRatio = state.controller.getUsedRatios(state.snapshot)[resource] ?? 0;

                // Auto-downgrade model tier (skip if model is pinned)
                if (!tier.modelPinned) {
                    const suggestedTier = getNextLowerTier(tier.currentTier, tier.tierModelIds);
                    if (suggestedTier && tier.tierModelIds[suggestedTier]) {
                        tier.effectiveModelId = tier.tierModelIds[suggestedTier];
                        tier.currentTier = suggestedTier;
                    }
                }

                emit({
                    type: 'error', // budget warning via error event for visibility
                    error: {
                        message: `Budget approaching limit: ${resource} at ${Math.round(usedRatio * 100)}%`,
                        code: 'BUDGET_WARNING',
                    },
                });
            }
        },

        async onError(_ctx: ExchangeContext, error: Error): Promise<RecoveryAction> {
            if (error instanceof BudgetExhaustedError) {
                return { action: 'fail' };
            }
            // Not a budget error — let other middleware handle it
            return undefined as unknown as RecoveryAction;
        },
    };
}

// ─── 02-error-recovery ──────────────────────────────────────────────

interface ErrorRecoveryState {
    rateLimitRetries: number;
    contextRetries: number;
    currentConnectionId: string;
    fallbackConnectionId: string | undefined;
    fallbackActive: boolean;
}

export function createHarnessErrorRecoveryMiddleware(
    state: ErrorRecoveryState,
    config: AgentLoopConfig,
    onCompressionNeeded: () => Promise<void>,
    emit: HarnessEventEmitter,
): ILoopMiddleware {
    const maxRetries = config.maxApiRetries;

    return {
        name: '02-error-recovery',

        async onError(_ctx: ExchangeContext, error: Error): Promise<RecoveryAction> {
            const msg = error.message ?? '';
            const statusCode = (error as unknown as Record<string, unknown>)['statusCode'] as number | undefined
                ?? (error as unknown as Record<string, unknown>)['status'] as number | undefined;

            // Rate limit (429)
            if (statusCode === 429 || msg.includes('429') || msg.includes('rate')) {
                state.rateLimitRetries++;
                if (state.rateLimitRetries > maxRetries) return { action: 'fail' };
                const delayMs = config.baseRetryDelayMs * Math.pow(2, state.rateLimitRetries - 1);
                emit({
                    type: 'error',
                    error: { message: `Rate limited, retrying in ${delayMs}ms (attempt ${state.rateLimitRetries})`, code: 'RATE_LIMIT' },
                });
                return { action: 'retry', delayMs };
            }

            // Context too large (413)
            if (statusCode === 413 || msg.includes('413') || msg.includes('context')) {
                state.contextRetries++;
                if (state.contextRetries > maxRetries) return { action: 'fail' };
                await onCompressionNeeded();
                return { action: 'compress' };
            }

            // Service overload (529) — try fallback
            if (statusCode === 529 || msg.includes('529') || msg.includes('overload')) {
                if (!state.fallbackActive && state.fallbackConnectionId) {
                    const prev = state.currentConnectionId;
                    state.currentConnectionId = state.fallbackConnectionId;
                    state.fallbackActive = true;
                    emit({
                        type: 'error',
                        error: { message: `Falling back from ${prev} to ${state.fallbackConnectionId}`, code: 'SERVICE_OVERLOAD' },
                    });
                    return { action: 'fallback', connectionId: state.fallbackConnectionId };
                }
                return { action: 'fail' };
            }

            // Unknown error — fail
            return { action: 'fail' };
        },
    };
}

// ─── 03-hitl ─────────────────────────────────────────────────────────

export function createHarnessHITLMiddleware(
    session: HarnessSessionState,
    enablePlanConfirm: boolean,
): ILoopMiddleware {
    return {
        name: '03-hitl',

        async beforeExchange(_ctx: ExchangeContext): Promise<ControlDirective | void> {
            // Flush pending user injections before the LLM call.
            if (session.pendingInjections.length > 0) {
                const injections = session.pendingInjections.splice(0);
                if (injections.length === 1) {
                    return { action: 'inject', text: injections[0] };
                }
                if (injections.length > 1) {
                    return { action: 'inject', text: injections.join('\n\n') };
                }
            }
        },

        async onToolCalls(ctx: ExchangeContext, toolCalls: PlannedTool[]): Promise<ControlDirective | void> {
            // Plan confirmation on first round with tool calls.
            if (!enablePlanConfirm || ctx.roundNumber !== 1 || toolCalls.length === 0) return;

            return {
                action: 'pause',
                request: {
                    requestId: `plan_${ctx.sessionId}_${ctx.roundNumber}`,
                    reason: 'plan_confirm',
                    message: `The agent plans to execute ${toolCalls.length} tool(s):\n${toolCalls.map(tc => `- ${tc.name}`).join('\n')}`,
                    options: [
                        { label: 'Approve', value: true },
                        { label: 'Reject', value: false },
                    ],
                },
            };
        },
    };
}

// ─── 04-back-pressure ────────────────────────────────────────────────

export function createHarnessBackPressureMiddleware(
    validator: BackPressureValidator,
    sessionCwd: string,
    emit: HarnessEventEmitter,
): ILoopMiddleware {
    return {
        name: '04-back-pressure',

        async afterExchange(_ctx: ExchangeContext, result: RoundResult): Promise<ControlDirective | void> {
            const toolNames = extractToolNames(result);

            if (toolNames.length > 0) {
                // After-tool back-pressure: check each executed tool
                for (const toolName of toolNames) {
                    const bpResult = await validator.checkAfterTool(toolName, sessionCwd);
                    if (bpResult && !bpResult.passed) {
                        emit({
                            type: 'error',
                            error: {
                                message: `Back-pressure: ${bpResult.ruleName} failed after ${toolName}`,
                                code: 'BACK_PRESSURE',
                            },
                        });
                        return {
                            action: 'inject',
                            text: `Validation check "${bpResult.ruleName}" failed after ${toolName}:\n${bpResult.errorMessage}\n\nPlease fix the issues.`,
                        };
                    }
                }
            } else {
                // Before-final back-pressure: check final response
                const bpResult = await validator.checkBeforeFinal(sessionCwd);
                if (bpResult && !bpResult.passed) {
                    emit({
                        type: 'error',
                        error: {
                            message: `Back-pressure: ${bpResult.ruleName} failed`,
                            code: 'BACK_PRESSURE',
                        },
                    });
                    return {
                        action: 'inject',
                        text: `Validation check "${bpResult.ruleName}" failed:\n${bpResult.errorMessage}\n\nPlease fix the issues and try again.`,
                    };
                }
            }
        },
    };
}

// ─── 05-compression ──────────────────────────────────────────────────

export function createHarnessCompressionMiddleware(
    contextManager: ContextManager,
    sessionId: string,
    compressionThreshold: number,
    emit: HarnessEventEmitter,
): ILoopMiddleware {
    return {
        name: '05-compression',

        async beforeExchange(_ctx: ExchangeContext): Promise<ControlDirective | void> {
            const usageRatio = contextManager.getContextUsageRatio(sessionId);
            if (usageRatio >= compressionThreshold) {
                const info = await contextManager.maybeCompress(sessionId, usageRatio);
                if (info) {
                    emit({
                        type: 'error',
                        error: {
                            message: `Context compressed: ${info.layerName} (${info.beforeTokens} → ${info.afterTokens} tokens)`,
                            code: 'CONTEXT_COMPRESSED',
                        },
                    });
                }
            }
        },
    };
}

// ─── 06-skills ────────────────────────────────────────────────────────

export function createHarnessSkillsMiddleware(
    contextManager: ContextManager,
    sessionId: string,
    taskPrompt: string,
    _emit: HarnessEventEmitter,
): ILoopMiddleware {
    let skillsLoaded = false;

    return {
        name: '06-skills',

        async beforeExchange(_ctx: ExchangeContext): Promise<ControlDirective | void> {
            if (!skillsLoaded) {
                skillsLoaded = true;
                // Auto-detect and pre-load skills matching the task prompt
                contextManager.autoDetectAndLoadSkills(sessionId, taskPrompt);
            }
        },

        async afterExchange(_ctx: ExchangeContext, _result: RoundResult): Promise<ControlDirective | void> {
            // Skill post-processing (markSkillLoaded) is handled by the loop body
            // after tool execution, since middleware doesn't have IToolService access.
        },
    };
}

// ─── helpers ─────────────────────────────────────────────────────────

function extractToolNames(result: RoundResult): string[] {
    const names: string[] = [];
    for (const block of result.assistantBlocks) {
        if (block.type === 'tool_use' && block.toolName) {
            names.push(block.toolName as string);
        }
    }
    return [...new Set(names)];
}
