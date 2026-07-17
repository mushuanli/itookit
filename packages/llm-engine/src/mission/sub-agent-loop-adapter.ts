// SubAgentLoopAdapter — wraps ISubAgentRouter.delegate() as an ILoop coroutine.
//
// ISubAgentRouter.delegate() returns a synchronous SubAgentResult,
// but reconcile() expects an ILoop (AsyncGenerator). This adapter
// bridges the two: it calls delegate(), yields stream events, and
// returns a single synthesized Round.

import type {
    ILoop,
    LoopContext,
    Round,
    AgentEvent,
    Signal,
    TokenUsage,
    ISubAgentRouter,
    SubAgentTask,
} from '@itookit/common';

export interface SubAgentLoopAdapterOptions {
    router: ISubAgentRouter;
    /** Build a SubAgentTask from the GoalNode's TaskSpec. */
    buildTask: (prompt: string, context?: Record<string, unknown>) => SubAgentTask;
}

export function createSubAgentLoopAdapter(opts: SubAgentLoopAdapterOptions): ILoop {
    return {
        mode: 'sub-agent',

        async *run(ctx: LoopContext): AsyncGenerator<AgentEvent, Round[], Signal | undefined> {
            const task = opts.buildTask(
                // Use the ref as a prompt hint — the actual prompt comes from GoalNode.task.prompt
                ctx.ref,
                {},
            );

            yield {
                type: 'round:start',
                roundId: `sub_${ctx.sessionId}`,
                sessionId: ctx.sessionId,
                round: 1,
            };

            let result;
            try {
                result = await opts.router.delegate(task);
            } catch (err) {
                yield {
                    type: 'error',
                    error: {
                        message: err instanceof Error ? err.message : String(err),
                        stack: err instanceof Error ? err.stack : undefined,
                    },
                };
                return [];
            }

            const usage: TokenUsage = {
                inputTokens: result.tokenUsage?.input ?? 0,
                outputTokens: result.tokenUsage?.output ?? 0,
            };

            const round: Round = {
                id: `round_sub_${ctx.sessionId}`,
                parents: [],
                payload: [
                    { role: 'user', content: task.instruction },
                    { role: 'assistant', content: result.summary },
                ],
                meta: {
                    createdAt: Date.now(),
                    origin: 'loop',
                    usage,
                },
                result: {
                    assistantBlocks: [{ type: 'text', text: result.summary }],
                    toolResults: [],
                    usage,
                },
            };

            yield {
                type: 'round:end',
                roundId: round.id,
                sessionId: ctx.sessionId,
                round: 1,
            };

            yield { type: 'finished', usage };

            return [round];
        },

        async *resume(_checkpoint: string): AsyncGenerator<AgentEvent, Round[], Signal | undefined> {
            yield { type: 'error' as any, error: { message: 'Sub-agent resume not supported' } };
            return [];
        },
    };
}
