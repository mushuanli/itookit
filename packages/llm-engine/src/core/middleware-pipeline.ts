// Middleware pipeline — composes ILoopMiddleware into a turn-level wrapper.
//
// Middleware execution order (LIFO, like a stack):
//   beforeTurn:  [mw1, mw2, mw3] → mw1 → mw2 → mw3 → turn execution
//   onToolCalls: [mw1, mw2, mw3] → mw1 → mw2 → mw3 (first non-void wins)
//   afterTurn:   turn execution → mw3 → mw2 → mw1
//   onError:     first non-undefined result wins (mw1, then mw2, ...)

import type {
    ILoopMiddleware,
    TurnContext,
    TurnResult,
    ControlDirective,
    RecoveryAction,
    PlannedTool,
} from '@itookit/common';

export interface MiddlewarePipeline {
    applyBeforeTurn(ctx: TurnContext): Promise<ControlDirective | void>;
    applyOnToolCalls(ctx: TurnContext, toolCalls: PlannedTool[]): Promise<ControlDirective | void>;
    applyAfterTurn(ctx: TurnContext, result: TurnResult): Promise<ControlDirective | void>;
    applyOnError(ctx: TurnContext, error: Error): Promise<RecoveryAction | void>;
}

export function composeMiddleware(middlewares: ILoopMiddleware[]): MiddlewarePipeline {
    // Sort by name for deterministic ordering (implementations can use numeric prefixes)
    const sorted = [...middlewares].sort((a, b) => a.name.localeCompare(b.name));

    return {
        async applyBeforeTurn(ctx: TurnContext): Promise<ControlDirective | void> {
            for (const mw of sorted) {
                if (mw.beforeTurn) {
                    const directive = await mw.beforeTurn(ctx);
                    if (directive) return directive;
                }
            }
        },

        async applyOnToolCalls(ctx: TurnContext, toolCalls: PlannedTool[]): Promise<ControlDirective | void> {
            for (const mw of sorted) {
                if (mw.onToolCalls) {
                    const directive = await mw.onToolCalls(ctx, toolCalls);
                    if (directive) return directive;
                }
            }
        },

        async applyAfterTurn(ctx: TurnContext, result: TurnResult): Promise<ControlDirective | void> {
            // Reverse order for afterTurn (stack unwinding)
            for (let i = sorted.length - 1; i >= 0; i--) {
                const mw = sorted[i];
                if (mw.afterTurn) {
                    const directive = await mw.afterTurn(ctx, result);
                    if (directive) return directive;
                }
            }
        },

        async applyOnError(ctx: TurnContext, error: Error): Promise<RecoveryAction | void> {
            for (const mw of sorted) {
                if (mw.onError) {
                    const action = await mw.onError(ctx, error);
                    if (action) return action;
                }
            }
        },
    };
}
