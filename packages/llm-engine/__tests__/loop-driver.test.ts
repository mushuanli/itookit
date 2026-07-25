import { describe, expect, it } from 'vitest';
import type { AgentEvent, LoopContext, Signal } from '@itookit/common';
import { drive } from '../src/core/loop-driver';

describe('loop-driver HITL ordering', () => {
    it('emits await_signal before checkpointing and waiting', async () => {
        const order: string[] = [];
        async function* loop(): AsyncGenerator<AgentEvent, [], Signal | undefined> {
            const signal = yield {
                type: 'await_signal',
                request: { requestId: 'request', reason: 'request_input', message: 'Continue?' },
            };
            order.push(`received:${signal?.type}`);
            return [];
        }
        const context = {
            signal: new AbortController().signal,
            log: {
                draft: () => ({
                    checkpoint: async () => { order.push('checkpoint'); },
                    flush: async () => {}, current: () => null, restore: async () => null, setCurrent: () => {},
                }),
            },
        } as unknown as LoopContext;
        await drive(loop(), {
            emit: event => order.push(`emit:${event.type}`),
            waitSignal: async () => { order.push('wait'); return { type: 'respond', requestId: 'request', response: true }; },
        }, context);
        expect(order).toEqual(['emit:await_signal', 'checkpoint', 'wait', 'received:respond']);
    });
});
