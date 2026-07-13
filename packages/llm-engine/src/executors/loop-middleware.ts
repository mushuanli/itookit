// Loop middleware — built-in ILoopMiddleware implementations.
//
// These are the 6 canonical middleware from the llm-2 design.
// For S3, they are self-contained implementations that mirror
// the corresponding llm-harness classes.
//
// In S6, these will be replaced by thin wrappers around the
// harness classes (BudgetController, ContextManager, etc.).

import type {
    ILoopMiddleware,
    TurnContext,
    TurnResult,
    ControlDirective,
    RecoveryAction,
} from '@itookit/common';

// ─── Budget Middleware ────────────────────────────────────────────────

interface BudgetConfig {
    maxTurns?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxCostUsd?: number;
    maxDurationMs?: number;
}

export function createBudgetMiddleware(limits: BudgetConfig): ILoopMiddleware {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turnCount = 0;
    const startTime = Date.now();

    return {
        name: '01-budget',

        async beforeTurn(_ctx: TurnContext): Promise<ControlDirective | void> {
            turnCount++;

            if (limits.maxTurns && turnCount > limits.maxTurns) {
                return { action: 'abort', reason: `Turn limit exceeded (${limits.maxTurns})` };
            }

            if (limits.maxInputTokens && totalInputTokens > limits.maxInputTokens) {
                return { action: 'abort', reason: `Input token limit exceeded` };
            }

            if (limits.maxOutputTokens && totalOutputTokens > limits.maxOutputTokens) {
                return { action: 'abort', reason: `Output token limit exceeded` };
            }

            if (limits.maxDurationMs) {
                const elapsed = Date.now() - startTime;
                if (elapsed > limits.maxDurationMs) {
                    return { action: 'abort', reason: `Duration limit exceeded` };
                }
            }
        },

        async afterTurn(_ctx: TurnContext, result: TurnResult): Promise<ControlDirective | void> {
            if (result.usage) {
                totalInputTokens += (result.usage as any).inputTokens ?? 0;
                totalOutputTokens += (result.usage as any).outputTokens ?? 0;
            }
        },

        async onError(_ctx: TurnContext, _error: Error): Promise<RecoveryAction> {
            return { action: 'fail' };
        },
    };
}

// ─── Error Recovery Middleware ────────────────────────────────────────

interface ErrorRecoveryConfig {
    maxRetries?: number;
    baseDelayMs?: number;
}

export function createErrorRecoveryMiddleware(config: ErrorRecoveryConfig = {}): ILoopMiddleware {
    const maxRetries = config.maxRetries ?? 3;
    const baseDelayMs = config.baseDelayMs ?? 1000;
    const retryCounts = new Map<string, number>();

    return {
        name: '02-error-recovery',

        async onError(ctx: TurnContext, error: Error): Promise<RecoveryAction> {
            const key = ctx.sessionId;
            const count = (retryCounts.get(key) ?? 0) + 1;
            retryCounts.set(key, count);

            if (count > maxRetries) {
                retryCounts.delete(key);
                return { action: 'fail' };
            }

            const msg = error.message ?? '';

            // Rate limit (429)
            if (msg.includes('429') || msg.includes('rate') || msg.includes('Rate')) {
                return { action: 'retry', delayMs: baseDelayMs * Math.pow(2, count - 1) };
            }

            // Context too large (413) — compress and retry
            if (msg.includes('413') || msg.includes('context') || msg.includes('token')) {
                return { action: 'compress' };
            }

            // Service overload (529) — fail (no fallback in lite mode)
            if (msg.includes('529') || msg.includes('overload')) {
                return { action: 'fail' };
            }

            // Default: one retry then fail
            return count <= 1 ? { action: 'retry', delayMs: baseDelayMs } : { action: 'fail' };
        },
    };
}

// ─── HITL Middleware ──────────────────────────────────────────────────

export function createHITLMiddleware(): ILoopMiddleware {
    return {
        name: '03-hitl',

        // HITL is handled inline in the loop body via yield await_signal.
        // The middleware just passes through.
        // Full implementation in S4 will intercept tool calls and
        // yield await_signal for permission checks.
    };
}

// ─── Back-Pressure Middleware ─────────────────────────────────────────

export function createBackPressureMiddleware(): ILoopMiddleware {
    return {
        name: '04-back-pressure',

        async afterTurn(_ctx: TurnContext, result: TurnResult): Promise<ControlDirective | void> {
            // Check for tool errors that indicate back-pressure failure
            const errors = result.toolResults.filter(r => r.isError);
            if (errors.length > 0) {
                // Allow LLM to self-correct; don't inject
                return;
            }
        },
    };
}

// ─── Compression Middleware (stub) ────────────────────────────────────

export function createCompressionMiddleware(): ILoopMiddleware {
    return {
        name: '05-compression',
        // Full implementation requires ContextManager from llm-harness.
        // Stub for now — will be wired in S6 when executor-loop package
        // can depend on llm-harness.
    };
}

// ─── Skills Middleware (stub) ─────────────────────────────────────────

export function createSkillsMiddleware(): ILoopMiddleware {
    return {
        name: '06-skills',
        // Full implementation requires ContextManager + ISkillService
        // from llm-harness. Stub for now.
    };
}
