// Loop middleware — built-in ILoopMiddleware implementations.
//
// These are the 7 canonical middleware from the llm-2 design.
// Each factory accepts an optional `harnessImpl` parameter — when provided,
// the harness implementation is returned instead of the built-in stub.
// This allows llm-harness middleware to be injected without cross-package deps.

import type {
    ILoopMiddleware,
    RoundContext,
    RoundResult,
    ControlDirective,
    RecoveryAction,
} from '@itookit/common';
import { TruncationDetector } from '../session/truncation-detector';

// ─── Truncation Detection Config ────────────────────────────────────

interface TruncationDetectionConfig {
    enabled: boolean;
    maxContinuations: number;
    continuePrompt: string;
    highConfidenceOnly: boolean;
    continuationTimeout: number;
    maxAccumulatedChars: number;
}

const TRUNCATION_DETECTION_DEFAULTS: TruncationDetectionConfig = {
    enabled: true,
    maxContinuations: 5,
    continuePrompt: [
        'Continue from the exact point where the text was cut off.',
        'Do not repeat any content. Do not add opening code fences, markdown headers,',
        'or any structural markers that already exist in the prior output.',
        'If the cutoff was mid-word or mid-sentence, resume from that exact character.',
    ].join(' '),
    highConfidenceOnly: true,
    continuationTimeout: 30_000,
    maxAccumulatedChars: 120_000,
};

// ─── Budget Middleware ────────────────────────────────────────────────

interface BudgetConfig {
    maxRounds?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxCostUsd?: number;
    maxDurationMs?: number;
}

export function createBudgetMiddleware(limits: BudgetConfig, harnessImpl?: ILoopMiddleware): ILoopMiddleware {
    if (harnessImpl) return harnessImpl;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let roundCount = 0;
    const startTime = Date.now();

    return {
        name: '01-budget',

        async beforeRound(_ctx: RoundContext): Promise<ControlDirective | void> {
            roundCount++;

            if (limits.maxRounds && roundCount > limits.maxRounds) {
                return { action: 'abort', reason: `Round limit exceeded (${limits.maxRounds})` };
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

        async afterRound(_ctx: RoundContext, result: RoundResult): Promise<ControlDirective | void> {
            if (result.usage) {
                totalInputTokens += (result.usage as any).inputTokens ?? 0;
                totalOutputTokens += (result.usage as any).outputTokens ?? 0;
            }
        },

        async onError(_ctx: RoundContext, _error: Error): Promise<RecoveryAction> {
            return { action: 'fail' };
        },
    };
}

// ─── Error Recovery Middleware ────────────────────────────────────────

interface ErrorRecoveryConfig {
    maxRetries?: number;
    baseDelayMs?: number;
}

export function createErrorRecoveryMiddleware(config: ErrorRecoveryConfig = {}, harnessImpl?: ILoopMiddleware): ILoopMiddleware {
    if (harnessImpl) return harnessImpl;

    const maxRetries = config.maxRetries ?? 3;
    const baseDelayMs = config.baseDelayMs ?? 1000;
    const retryCounts = new Map<string, number>();

    return {
        name: '02-error-recovery',

        async onError(ctx: RoundContext, error: Error): Promise<RecoveryAction> {
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

export function createHITLMiddleware(harnessImpl?: ILoopMiddleware): ILoopMiddleware {
    if (harnessImpl) return harnessImpl;

    return {
        name: '03-hitl',

        // HITL is handled inline in the loop body via yield await_signal.
        // The middleware just passes through.
        // Full implementation in S4 will intercept tool calls and
        // yield await_signal for permission checks.
    };
}

// ─── Back-Pressure Middleware ─────────────────────────────────────────

export function createBackPressureMiddleware(harnessImpl?: ILoopMiddleware): ILoopMiddleware {
    if (harnessImpl) return harnessImpl;

    return {
        name: '04-back-pressure',

        async afterRound(_ctx: RoundContext, result: RoundResult): Promise<ControlDirective | void> {
            // Check for tool errors that indicate back-pressure failure
            const errors = result.toolResults.filter(r => r.isError);
            if (errors.length > 0) {
                // Pass tool errors back as injection for LLM self-correction
                const errorSummary = errors
                    .map(e => `Tool ${e.toolUseId}: ${e.content}`)
                    .join('\n');
                return {
                    action: 'inject',
                    text: `The following tool calls failed:\n${errorSummary}\n\nPlease fix the errors and retry.`,
                };
            }
        },
    };
}

// ─── Compression Middleware (stub) ────────────────────────────────────

export function createCompressionMiddleware(harnessImpl?: ILoopMiddleware): ILoopMiddleware {
    if (harnessImpl) return harnessImpl;

    return {
        name: '05-compression',
        // Full implementation requires ContextManager from llm-harness.
        // Stub for now — will be wired in S6 when executor-loop package
        // can depend on llm-harness.
    };
}

// ─── Skills Middleware (stub) ─────────────────────────────────────────

export function createSkillsMiddleware(harnessImpl?: ILoopMiddleware): ILoopMiddleware {
    if (harnessImpl) return harnessImpl;

    return {
        name: '06-skills',
        // Full implementation requires ContextManager + ISkillService
        // from llm-harness. Stub for now.
    };
}

// ─── Truncation Detection Middleware ──────────────────────────────────

/**
 * Truncation detection middleware — replaces the AutoContinue while(true)
 * loop in TaskRunner.executeTask().
 *
 * On each afterRound, checks if the assistant output was truncated (via
 * finish_reason='length' or unclosed Markdown structures). If truncated,
 * injects a continue prompt so the LoopExecutor automatically continues.
 *
 * State (continuation count, accumulated output) is tracked per-middleware
 * instance. Create a fresh instance per LoopExecutor.
 */
export function createTruncationDetectionMiddleware(
    config?: Partial<TruncationDetectionConfig>,
): ILoopMiddleware {
    const cfg = { ...TRUNCATION_DETECTION_DEFAULTS, ...config };
    const detector = new TruncationDetector();
    let continuationCount = 0;
    let accumulatedChars = 0;

    return {
        name: '07-truncation-detection',

        async afterRound(_ctx: RoundContext, result: RoundResult): Promise<ControlDirective | void> {
            if (!cfg.enabled) return;
            if (continuationCount >= cfg.maxContinuations) return;

            // Extract the full text from assistant blocks
            const textBlocks = result.assistantBlocks
                .filter(b => b.type === 'text' || b.type === 'thinking')
                .map(b => (b.text as string) ?? '');
            const outputText = textBlocks.join('');

            accumulatedChars += outputText.length;

            // Accumulated output length protection
            if (cfg.maxAccumulatedChars > 0 && accumulatedChars >= cfg.maxAccumulatedChars) {
                return;
            }

            const detection = detector.detect(outputText, result.finishReason);

            if (!detection.truncated) return;

            if (cfg.highConfidenceOnly && detection.confidence !== 'high') {
                return;
            }

            continuationCount++;
            return { action: 'inject', text: cfg.continuePrompt };
        },
    };
}
