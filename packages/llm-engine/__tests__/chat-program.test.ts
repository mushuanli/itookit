import type { describe, expect, it } from '@itookit/common';
import { ChatProgram } from '../src/process';

describe('ChatProgram', () => {
    it('uses only injected resource ports and returns a serializable output', async () => {
        const program = new ChatProgram();
        const state = await program.initialize({
            sessionId: 'session',
            roundId: 'round',
            messages: [{ role: 'user', content: 'hello' }],
            connectionId: 'connection',
        });
        const generator = program.run(state, processContext());
        const events: ProcessEvent[] = [];
        let result = await generator.next();
        while (!result.done) {
            events.push(result.value);
            result = await generator.next();
        }

        expect(result.value.type).toBe('completed');
        if (result.value.type !== 'completed') return;
        expect(result.value.output.message.content).toBe('hello world');
        expect(events.filter(event => event.type === 'agent-event')).toHaveLength(5);
        expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    });
});

function processContext(): ProcessContext {
    return {
        processId: 'process',
        runId: 'run',
        capabilities: { ids: [] },
        budget: { limits: {}, usage: {} },
        abortSignal: new AbortController().signal,
        resources: {
            llm: {
                chatStream: () => chunks(),
                getConnection: async () => undefined,
                getDefaultConnection: async () => null,
                getProvider: async () => undefined,
                estimateTokens: () => 0,
            },
            tools: {} as import('@itookit/common').ToolPort,
            vfs: {} as import('@itookit/common').VfsPort,
        },
    };
}

async function* chunks(): AsyncGenerator<ChatCompletionChunk> {
    yield {
        choices: [{
            index: 0,
            delta: { content: 'hello ' },
            finish_reason: null,
        }],
    };
    yield {
        choices: [{
            index: 0,
            delta: { content: 'world' },
            finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    };
}
