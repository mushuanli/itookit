// AgentRuntimeLoopAdapter — wraps IAgentRuntime.run() as an ILoop coroutine.
//
// IAgentRuntime.run() returns a synchronous AgentTaskResult,
// but reconcile() expects an ILoop (AsyncGenerator). This adapter
// bridges the two: it calls runtime.run(), yields stream events,
// and returns a single synthesized Round.

import type {
    ILoop,
    LoopContext,
    Round,
    AgentEvent,
    Signal,
    TokenUsage,
    IAgentRuntime,
} from '@itookit/common';

export function createAgentRuntimeLoopAdapter(runtime: IAgentRuntime): ILoop {
    return {
        mode: 'agent-runtime',

        async *run(ctx: LoopContext): AsyncGenerator<AgentEvent, Round[], Signal | undefined> {
            yield {
                type: 'round:start',
                roundId: `sess_${ctx.sessionId}`,
                sessionId: ctx.sessionId,
                round: 1,
            };

            let responseText = '';
            try {
                const result = await runtime.run({
                    prompt: ctx.ref,
                });
                responseText = result.response;
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

            const usage: TokenUsage = {};

            const round: Round = {
                id: `round_sess_${ctx.sessionId}`,
                parents: [],
                payload: [
                    { role: 'user', content: ctx.ref },
                    { role: 'assistant', content: responseText },
                ],
                meta: {
                    createdAt: Date.now(),
                    origin: 'loop',
                },
                result: {
                    assistantBlocks: [{ type: 'text', text: responseText }],
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
            yield { type: 'error' as any, error: { message: 'Agent runtime resume not supported' } };
            return [];
        },
    };
}
