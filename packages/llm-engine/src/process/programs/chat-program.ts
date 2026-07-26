import type {
    AgentEvent,
    ChatMessage,
    ProcessContext,
    ProcessEvent,
    ProcessProgram,
    ProcessSignal,
    ProcessTransition,
    TokenUsage,
} from '@itookit/common';

export interface ChatProgramInput {
    sessionId: string;
    roundId: string;
    messages: ChatMessage[];
    connectionId: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    thinking?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'xhigh';
}

export interface ChatProgramState extends ChatProgramInput {
    phase: 'ready';
}

export interface ChatProgramOutput {
    message: ChatMessage;
    usage: TokenUsage;
    finishReason?: string;
}

interface StreamResult {
    content: string;
    thinking: string;
    usage: TokenUsage;
    finishReason?: string;
}

export class ChatProgram implements ProcessProgram<
    ChatProgramState,
    ChatProgramInput,
    ChatProgramOutput
> {
    readonly kind = 'llm.chat';

    async initialize(input: ChatProgramInput): Promise<ChatProgramState> {
        validateInput(input);
        return { ...structuredClone(input), phase: 'ready' };
    }

    async *run(
        state: ChatProgramState,
        context: ProcessContext,
        _signal?: ProcessSignal,
    ): AsyncGenerator<
        ProcessEvent,
        ProcessTransition<ChatProgramState, ChatProgramOutput>
    > {
        yield agentEvent(roundEvent('round:start', state));
        try {
            const result = yield* streamResponse(state, context);
            yield agentEvent(roundEvent('round:end', state));
            yield agentEvent({ type: 'finished', usage: result.usage });
            return completed(result);
        } catch (error) {
            const processError = serializeError(error);
            yield agentEvent({ type: 'error', error: processError });
            return { type: 'failed', error: processError };
        }
    }
}

async function* streamResponse(
    state: ChatProgramState,
    context: ProcessContext,
): AsyncGenerator<ProcessEvent, StreamResult> {
    const content: string[] = [];
    const thinking: string[] = [];
    let usage: TokenUsage = {};
    let finishReason: string | undefined;
    const stream = context.resources.llm.chatStream(state.connectionId, request(state, context));
    for await (const chunk of stream) {
        if (context.abortSignal.aborted) throw abortError();
        const delta = chunk.choices[0]?.delta;
        if (delta?.thinking) {
            thinking.push(delta.thinking);
            yield agentEvent({ type: 'stream:thinking', delta: delta.thinking });
        }
        if (delta?.content) {
            content.push(delta.content);
            yield agentEvent({ type: 'stream:content', delta: delta.content });
        }
        usage = chunk.usage ?? usage;
        finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
    }
    return { content: content.join(''), thinking: thinking.join(''), usage, finishReason };
}

function request(state: ChatProgramState, context: ProcessContext) {
    return {
        messages: state.messages,
        model: state.model,
        temperature: state.temperature,
        maxTokens: state.maxTokens,
        thinking: state.thinking,
        reasoningEffort: state.reasoningEffort,
        signal: context.abortSignal,
    };
}

function completed(
    result: StreamResult,
): ProcessTransition<ChatProgramState, ChatProgramOutput> {
    const message: ChatMessage = {
        role: 'assistant',
        content: result.content,
        ...(result.thinking ? { thinking: result.thinking } : {}),
    };
    return {
        type: 'completed',
        output: { message, usage: result.usage, finishReason: result.finishReason },
    };
}

function roundEvent(
    type: 'round:start' | 'round:end',
    state: ChatProgramState,
): AgentEvent {
    return { type, roundId: state.roundId, sessionId: state.sessionId, round: 1 };
}

function agentEvent(event: AgentEvent): ProcessEvent {
    return { type: 'agent-event', event };
}

function validateInput(input: ChatProgramInput): void {
    if (!input.sessionId) throw new Error('ChatProgram requires sessionId');
    if (!input.roundId) throw new Error('ChatProgram requires roundId');
    if (!input.connectionId) throw new Error('ChatProgram requires connectionId');
    if (!input.messages.length) throw new Error('ChatProgram requires at least one message');
}

function serializeError(error: unknown) {
    if (error instanceof Error) {
        return { message: error.message, stack: error.stack, code: error.name };
    }
    return { message: String(error) };
}

function abortError(): Error {
    const error = new Error('Process cancelled');
    error.name = 'AbortError';
    return error;
}
