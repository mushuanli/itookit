import { describe, expect, it, vi } from 'vitest';
import type { ILLMService } from '@itookit/common';
import type { EffectExecutionContext } from '@itookit/durable-kernel';
import { LlmChatEffectAdapter } from './llm-chat-effect';

describe('LlmChatEffectAdapter streaming', () => {
    it('aggregates streamed chunks into a full response and emits deltas', async () => {
        const emit = vi.fn(async () => undefined);
        const service = streamService(async function* () {
            yield { id: 'm1', model: 'gpt-x', choices: [{ index: 0, delta: { thinking: 'Hmm ' }, finish_reason: null }] };
            yield { choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] };
            yield { choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }] };
            yield { id: 'm1', choices: [{ index: 0, delta: {}, finish_reason: null }], usage: { total_tokens: 7 } };
        });
        const adapter = new LlmChatEffectAdapter(service);

        const response = await adapter.execute({
            resourceHandleId: 'llm-handle', connectionId: 'conn', request: { messages: [] },
        }, context(emit));

        expect(response.choices[0].message.content).toBe('Hello world');
        expect(response.choices[0].message.thinking).toBe('Hmm ');
        expect(response.choices[0].finish_reason).toBe('stop');
        expect(response.usage).toEqual({ total_tokens: 7 });
        expect(response.model).toBe('gpt-x');

        const emitted = emit.mock.calls.map(([event]) => (event as { payload: unknown }).payload);
        expect(emitted).toContainEqual({ type: 'stream:thinking', delta: 'Hmm ' });
        expect(emitted).toContainEqual({ type: 'stream:content', delta: 'Hello' });
        expect(emitted).toContainEqual({ type: 'stream:content', delta: ' world' });
    });

    it('merges tool_calls by index and keeps the real tool_use finish reason', async () => {
        const emit = vi.fn(async () => undefined);
        const service = streamService(async function* () {
            yield { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'echo', arguments: '' } }] }, finish_reason: null }] };
            yield { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] }, finish_reason: null }] };
            yield { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, finish_reason: null }] };
            yield { choices: [{ index: 0, delta: {}, finish_reason: 'tool_use' }], usage: { total_tokens: 3 } };
            yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
        });
        const adapter = new LlmChatEffectAdapter(service);

        const response = await adapter.execute({
            resourceHandleId: 'llm-handle', connectionId: 'conn', request: { messages: [] },
        }, context(emit));

        const calls = response.choices[0].message.tool_calls!;
        expect(calls).toHaveLength(1);
        expect(calls[0].id).toBe('call-1');
        expect(calls[0].function?.name).toBe('echo');
        expect(calls[0].function?.arguments).toBe('{"a":1}');
        expect(response.choices[0].finish_reason).toBe('tool_use');
    });

    it('emits final content once for non-streaming requests', async () => {
        const emit = vi.fn(async () => undefined);
        const service = {
            chat: async () => ({
                choices: [{ index: 0, message: { role: 'assistant' as const, content: 'full', thinking: 't' }, finish_reason: 'stop' }],
            }),
            chatStream: async () => { throw new Error('should not stream'); },
        } as ILLMService;
        const adapter = new LlmChatEffectAdapter(service);

        const response = await adapter.execute({
            resourceHandleId: 'llm-handle', connectionId: 'conn', request: { messages: [], stream: false },
        }, context(emit));

        expect(response.choices[0].message.content).toBe('full');
        const emitted = emit.mock.calls.map(([event]) => (event as { payload: unknown }).payload);
        expect(emitted).toContainEqual({ type: 'stream:thinking', delta: 't' });
        expect(emitted).toContainEqual({ type: 'stream:content', delta: 'full' });
    });
});

function streamService(chatStream: ILLMService['chatStream']): ILLMService {
    return {
        chat: async () => { throw new Error('should not call chat'); },
        chatStream,
        abort: () => undefined,
        getConnection: async () => undefined,
        getDefaultConnection: async () => null,
        listConnections: async () => [],
        getProvider: async () => undefined,
        estimateTokens: () => 0,
    } as ILLMService;
}

function context(emit: EffectExecutionContext['emit']): EffectExecutionContext {
    return {
        sessionId: 'session-a', taskId: 'task-a', effectId: 'effect-a',
        abortSignal: new AbortController().signal,
        grants: [{
            handleId: 'llm-handle', right: 'execute',
            resource: {
                id: 'llm-resource', sessionId: 'session-a', kind: 'llm', uri: 'llm://pending',
                generation: 1, createdAt: Date.now(),
            },
        }],
        emit,
    };
}
