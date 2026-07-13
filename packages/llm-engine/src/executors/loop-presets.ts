// Loop presets — factory for creating ILoop executors with preset middleware.
//
// Two presets:
//   - 'lite':  [budget, error-recovery]  — replaces UnifiedLoopStrategy
//   - 'full':  [budget, compression, error-recovery, hitl, skills, back-pressure]
//
// The preset only differs in which middleware are assembled.
// The loop body (LoopExecutor) is the same for both.

import type { ILoop, ILoopMiddleware } from '@itookit/common';
import { LoopExecutor } from './loop-executor';
import {
    createBudgetMiddleware,
    createErrorRecoveryMiddleware,
    createCompressionMiddleware,
    createHITLMiddleware,
    createSkillsMiddleware,
    createBackPressureMiddleware,
} from './loop-middleware';

export interface LoopPresetConfig {
    budget?: {
        maxTurns?: number;
        maxInputTokens?: number;
        maxOutputTokens?: number;
    };
    errorRecovery?: {
        maxRetries?: number;
        baseDelayMs?: number;
    };
}

/**
 * Create a LoopExecutor with a preset middleware stack.
 *
 * @param preset  'lite' (budget + error-recovery) or 'full' (all 6 middleware)
 * @param config  Optional budget and error-recovery overrides
 */
export function createLoopExecutor(
    preset: 'lite' | 'full',
    config?: LoopPresetConfig,
): ILoop {
    const middlewares: ILoopMiddleware[] = [];

    // Budget (always included)
    middlewares.push(createBudgetMiddleware({
        maxTurns: config?.budget?.maxTurns ?? 50,
        maxInputTokens: config?.budget?.maxInputTokens,
        maxOutputTokens: config?.budget?.maxOutputTokens,
    }));

    if (preset === 'full') {
        // Full preset: all 6 middleware in order
        middlewares.push(createCompressionMiddleware());
        middlewares.push(createErrorRecoveryMiddleware(config?.errorRecovery));
        middlewares.push(createHITLMiddleware());
        middlewares.push(createSkillsMiddleware());
        middlewares.push(createBackPressureMiddleware());
    } else {
        // Lite preset: just error recovery
        middlewares.push(createErrorRecoveryMiddleware(config?.errorRecovery));
    }

    const mode = preset === 'full' ? 'loop:full' : 'loop';
    return new LoopExecutor(mode, middlewares);
}
