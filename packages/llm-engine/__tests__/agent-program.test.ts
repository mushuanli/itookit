import { describe, expect, it } from 'vitest';
import type {
    ChatCompletionChunk,
    ProcessContext,
    ProcessEvent,
    ProcessTransition,
    ToolCall,
    ToolMeta,
} from '@itookit/common';
import {
    AgentProgram,
    type AgentProgramOutput,
    type AgentProgramState,
} from '../src/process';

describe('AgentProgram', () => {
    it('keeps an external tool checkpoint waiting until the matching authorization', async () => {
        const runtime = fixture(externalToolCall(), externalToolMeta());
        const program = new AgentProgram();
        const state = await program.initialize(input());
        const first = await drain(program.run(state, runtime.context));

        expect(first.transition.type).toBe('waiting');
        if (first.transition.type !== 'waiting') return;
        expect(runtime.invocations).toBe(0);
        expect(JSON.parse(JSON.stringify(first.transition.state))).toEqual(first.transition.state);

        const restored = await drain(program.run(first.transition.state, runtime.context));
        expect(restored.transition.type).toBe('waiting');
        expect(runtime.invocations).toBe(0);

        const completed = await drain(program.run(first.transition.state, runtime.context, {
            type: 'authorize',
            requestId: 'call-1',
            approved: true,
        }));
        expect(completed.transition.type).toBe('completed');
        expect(runtime.invocations).toBe(1);
    });

    it('resumes human input as a tool result without invoking the tool port', async () => {
        const runtime = fixture(humanToolCall());
        const program = new AgentProgram();
        const first = await drain(program.run(await program.initialize(input()), runtime.context));
        if (first.transition.type !== 'waiting') throw new Error('Expected waiting');

        const completed = await drain(program.run(first.transition.state, runtime.context, {
            type: 'respond',
            requestId: 'human-1',
            response: 'performance',
        }));
        expect(completed.transition.type).toBe('completed');
        expect(runtime.invocations).toBe(0);
        expect(runtime.requests[1].messages).toContainEqual({
            role: 'tool',
            tool_call_id: 'human-1',
            content: 'performance',
        });
    });
});

function input() {
    return {
        sessionId: 'session',
        roundId: 'round',
        messages: [{ role: 'user' as const, content: 'start' }],
        connectionId: 'connection',
        approval: 'external' as const,
    };
}

function fixture(call: ToolCall, meta?: ToolMeta) {
    let exchange = 0;
    let invocations = 0;
    const requests: Array<{ messages: unknown[] }> = [];
    const context = processContext(
        request => {
            requests.push(request as { messages: unknown[] });
            return ++exchange === 1 ? toolChunks(call) : finalChunks();
        },
        () => { invocations++; },
        meta,
    );
    return {
        context,
        requests,
        get invocations() { return invocations; },
    };
}

function processContext(
    stream: (request: unknown) => AsyncIterable<ChatCompletionChunk>,
    invoked: () => void,
    meta?: ToolMeta,
): ProcessContext {
    return {
        processId: 'process',
        runId: 'run',
        capabilities: { ids: ['deploy', 'human_input'] },
        budget: { limits: {}, usage: {} },
        abortSignal: new AbortController().signal,
        resources: {
            llm: llmPort(stream),
            tools: toolPort(invoked, meta),
            vfs: {} as import('@itookit/common').VfsPort,
        },
    };
}

function llmPort(stream: (request: unknown) => AsyncIterable<ChatCompletionChunk>) {
    return {
        chatStream: (_connectionId: string, request: unknown) => stream(request),
        getConnection: async () => undefined,
        getDefaultConnection: async () => null,
        getProvider: async () => undefined,
        estimateTokens: () => 0,
    };
}

function toolPort(invoked: () => void, meta?: ToolMeta) {
    return {
        listTools: () => meta ? [meta] : [],
        getToolMeta: (id: string) => id === meta?.id ? meta : undefined,
        getToolDefinitions: () => [],
        invoke: async () => ({ success: true, output: 'ok', durationMs: 1 }),
        invokeBatch: async (requests: unknown[]) => {
            invoked();
            return {
                results: requests.map(() => ({ success: true, output: 'ok', durationMs: 1 })),
                totalDurationMs: 1,
            };
        },
    };
}

async function drain(
    generator: AsyncGenerator<
        ProcessEvent,
        ProcessTransition<AgentProgramState, AgentProgramOutput>
    >,
) {
    const events: ProcessEvent[] = [];
    let next = await generator.next();
    while (!next.done) {
        events.push(next.value);
        next = await generator.next();
    }
    return { events, transition: next.value };
}

async function* toolChunks(call: ToolCall): AsyncGenerator<ChatCompletionChunk> {
    yield chunk({ tool_calls: [call] });
}

async function* finalChunks(): AsyncGenerator<ChatCompletionChunk> {
    yield chunk({ content: 'done' }, 'stop');
}

function chunk(
    delta: ChatCompletionChunk['choices'][number]['delta'],
    finishReason: string | null = null,
): ChatCompletionChunk {
    return { choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

function externalToolCall(): ToolCall {
    return {
        id: 'call-1',
        type: 'function',
        function: { name: 'deploy', arguments: '{"target":"prod"}' },
    };
}

function humanToolCall(): ToolCall {
    return {
        id: 'human-1',
        type: 'function',
        function: {
            name: 'human_input',
            arguments: '{"question":"Performance or maintainability?"}',
        },
    };
}

function externalToolMeta(): ToolMeta {
    return {
        id: 'deploy',
        name: 'Deploy',
        description: 'Deploy a release',
        sideEffect: 'external',
        timeoutMs: 1_000,
        type: 'builtin',
        enabled: true,
    };
}
