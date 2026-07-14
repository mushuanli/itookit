// AgentRuntimeLoopAdapter — wraps IAgentRuntime.run() as an ILoop coroutine.
//
// IAgentRuntime.run() returns a synchronous AgentTaskResult,
// but reconcile() expects an ILoop (AsyncGenerator). This adapter
// bridges the two: it calls runtime.run(), yields stream events,
// and returns a single synthesized Turn.

import type {
    ILoop,
    LoopContext,
    Turn,
    AgentEvent,
    Signal,
    TokenUsage,
    IAgentRuntime,
} from '@itookit/common';

export function createAgentRuntimeLoopAdapter(runtime: IAgentRuntime): ILoop {
    return {
        mode: 'agent-runtime',

        async *run(ctx: LoopContext): AsyncGenerator<AgentEvent, Turn[], Signal | undefined> {
            yield {
                type: 'turn:start',
                turnId: `sess_${ctx.sessionId}`,
                sessionId: ctx.sessionId,
                turn: 1,
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

            const turn: Turn = {
                id: `turn_sess_${ctx.sessionId}`,
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
                type: 'turn:end',
                turnId: turn.id,
                sessionId: ctx.sessionId,
                turn: 1,
            };

            yield { type: 'finished', usage };

            return [turn];
        },

        async *resume(_checkpoint: string): AsyncGenerator<AgentEvent, Turn[], Signal | undefined> {
            yield { type: 'error' as any, error: { message: 'Agent runtime resume not supported' } };
            return [];
        },
    };
}
