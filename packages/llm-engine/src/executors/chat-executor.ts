// executor-chat — minimal ILoop implementation for single-turn chat.
//
// This is the simplest ILoop: no tools, no middleware, single turn.
// It serves as both a reference implementation and the test baseline
// for the ILoop contract.

import type { ILoop, LoopContext, Turn, AgentEvent, Signal } from '@itookit/common';
import { notSupported } from '../core/loop-driver';
import { ulid } from '../persistence/ulid';

export const chatExecutor: ILoop = {
    mode: 'chat',

    async *run(ctx: LoopContext): AsyncGenerator<AgentEvent, Turn[], Signal | undefined> {
        const turnId = ulid();
        const messages = await ctx.log.fold(ctx.ref);

        yield {
            type: 'turn:start',
            turnId,
            sessionId: ctx.sessionId,
            turn: 1,
        };

        const assistantContent: string[] = [];

        try {
            const stream = ctx.llm.chatStream('default', {
                messages,
                signal: ctx.signal,
            });

            for await (const chunk of stream) {
                if (ctx.signal.aborted) break;

                const delta = chunk.choices?.[0]?.delta;
                if (!delta) continue;

                if (delta.content) {
                    assistantContent.push(delta.content);
                    yield { type: 'stream:content', delta: delta.content };
                }
            }
        } catch (err) {
            yield {
                type: 'error',
                error: {
                    message: err instanceof Error ? err.message : String(err),
                    code: (err as any)?.code,
                },
            };
        }

        const finalContent = assistantContent.join('');
        const turn: Turn = {
            id: turnId,
            parents: [],
            payload: [
                ...messages,
                { role: 'assistant', content: finalContent },
            ],
            meta: {
                createdAt: Date.now(),
                origin: 'loop',
            },
        };

        yield { type: 'turn:end', turnId, sessionId: ctx.sessionId, turn: 1 };

        return [turn];
    },

    resume(_checkpoint: string): AsyncGenerator<AgentEvent, Turn[], Signal | undefined> {
        notSupported('chat');
    },
};
