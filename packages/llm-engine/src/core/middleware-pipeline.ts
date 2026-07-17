// Middleware pipeline — composes ILoopMiddleware into a round-level wrapper.
//
// Middleware execution order (LIFO, like a stack):
//   beforeRound:  [mw1, mw2, mw3] → mw1 → mw2 → mw3 → round execution
//   onToolCalls: [mw1, mw2, mw3] → mw1 → mw2 → mw3 (first non-void wins)
//   afterRound:   round execution → mw3 → mw2 → mw1
//   onError:     first non-undefined result wins (mw1, then mw2, ...)

import type {
    ILoopMiddleware,
    RoundContext,
    RoundResult,
    ControlDirective,
    RecoveryAction,
    PlannedTool,
} from '@itookit/common';

export interface MiddlewarePipeline {
    applyBeforeRound(ctx: RoundContext): Promise<ControlDirective | void>;
    applyOnToolCalls(ctx: RoundContext, toolCalls: PlannedTool[]): Promise<ControlDirective | void>;
    applyAfterRound(ctx: RoundContext, result: RoundResult): Promise<ControlDirective | void>;
    applyOnError(ctx: RoundContext, error: Error): Promise<RecoveryAction | void>;
}

export function composeMiddleware(middlewares: ILoopMiddleware[]): MiddlewarePipeline {
    // Sort by name for deterministic ordering (implementations can use numeric prefixes)
    const sorted = [...middlewares].sort((a, b) => a.name.localeCompare(b.name));

    return {
        async applyBeforeRound(ctx: RoundContext): Promise<ControlDirective | void> {
            for (const mw of sorted) {
                if (mw.beforeRound) {
                    const directive = await mw.beforeRound(ctx);
                    if (directive) return directive;
                }
            }
        },

        async applyOnToolCalls(ctx: RoundContext, toolCalls: PlannedTool[]): Promise<ControlDirective | void> {
            for (const mw of sorted) {
                if (mw.onToolCalls) {
                    const directive = await mw.onToolCalls(ctx, toolCalls);
                    if (directive) return directive;
                }
            }
        },

        async applyAfterRound(ctx: RoundContext, result: RoundResult): Promise<ControlDirective | void> {
            // Reverse order for afterRound (stack unwinding)
            for (let i = sorted.length - 1; i >= 0; i--) {
                const mw = sorted[i];
                if (mw.afterRound) {
                    const directive = await mw.afterRound(ctx, result);
                    if (directive) return directive;
                }
            }
        },

        async applyOnError(ctx: RoundContext, error: Error): Promise<RecoveryAction | void> {
            for (const mw of sorted) {
                if (mw.onError) {
                    const action = await mw.onError(ctx, error);
                    if (action) return action;
                }
            }
        },
    };
}
