// Loop presets — factory for creating ILoop executors with preset middleware.
//
// Two presets:
//   - 'lite':  [budget, error-recovery, truncation]  — lightweight
//   - 'full':  [budget, compression, error-recovery, hitl, skills, back-pressure, truncation]
//
// When `harnessMiddleware` is provided, the corresponding stubs delegate to the
// harness implementations (e.g. from llm-harness). Otherwise, built-in lightweight
// implementations are used.

import type { ILoop, ILoopMiddleware } from '@itookit/common';
import { LoopExecutor } from './loop-executor';
import {
    createBudgetMiddleware,
    createErrorRecoveryMiddleware,
    createCompressionMiddleware,
    createHITLMiddleware,
    createSkillsMiddleware,
    createBackPressureMiddleware,
    createTruncationDetectionMiddleware,
} from './loop-middleware';

export interface LoopPresetConfig {
    budget?: {
        maxRounds?: number;
        maxInputTokens?: number;
        maxOutputTokens?: number;
    };
    errorRecovery?: {
        maxRetries?: number;
        baseDelayMs?: number;
    };
}

/**
 * Harness middleware overrides — pass ILoopMiddleware implementations from
 * llm-harness to replace the built-in stubs.
 */
export interface HarnessMiddlewareSet {
    budget?: ILoopMiddleware;
    errorRecovery?: ILoopMiddleware;
    hitl?: ILoopMiddleware;
    backPressure?: ILoopMiddleware;
    compression?: ILoopMiddleware;
    skills?: ILoopMiddleware;
}

/**
 * Create a LoopExecutor with a preset middleware stack.
 *
 * @param preset  'lite' (budget + error-recovery + truncation) or 'full' (all 7 middleware)
 * @param config  Optional budget and error-recovery overrides
 * @param harness Optional harness middleware implementations (replaces built-in stubs)
 */
export function createLoopExecutor(
    preset: 'lite' | 'full',
    config?: LoopPresetConfig,
    harness?: HarnessMiddlewareSet,
): ILoop {
    const middlewares: ILoopMiddleware[] = [];

    // Budget (always included)
    middlewares.push(createBudgetMiddleware({
        maxRounds: config?.budget?.maxRounds ?? 50,
        maxInputTokens: config?.budget?.maxInputTokens,
        maxOutputTokens: config?.budget?.maxOutputTokens,
    }, harness?.budget));

    if (preset === 'full') {
        middlewares.push(createCompressionMiddleware(harness?.compression));
        middlewares.push(createErrorRecoveryMiddleware(config?.errorRecovery, harness?.errorRecovery));
        middlewares.push(createHITLMiddleware(harness?.hitl));
        middlewares.push(createSkillsMiddleware(harness?.skills));
        middlewares.push(createBackPressureMiddleware(harness?.backPressure));
        middlewares.push(createTruncationDetectionMiddleware());
    } else {
        middlewares.push(createErrorRecoveryMiddleware(config?.errorRecovery, harness?.errorRecovery));
        middlewares.push(createTruncationDetectionMiddleware());
    }

    const mode = preset === 'full' ? 'loop:full' : 'loop';
    return new LoopExecutor(mode, middlewares);
}
