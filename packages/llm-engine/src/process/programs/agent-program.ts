import type {
    ProcessContext,
    ProcessEvent,
    ProcessProgram,
    ProcessSignal,
    ProcessTransition,
    TokenUsage,
    ToolCall,
} from '@itookit/common';
import { exchange } from './agent-exchange';
import {
    executeTools,
    humanToolCall,
    rejectedToolMessages,
    toolArguments,
    toolName,
} from './agent-tools';
import type {
    AgentProgramInput,
    AgentProgramOutput,
    AgentProgramState,
} from './agent-types';

const DEFAULT_MAX_EXCHANGES = 50;

export class AgentProgram implements ProcessProgram<
    AgentProgramState,
    AgentProgramInput,
    AgentProgramOutput
> {
    readonly kind = 'llm.agent';

    async initialize(input: AgentProgramInput): Promise<AgentProgramState> {
        validate(input);
        return {
            ...structuredClone(input),
            phase: 'ready',
            exchange: 0,
            usage: {},
            pendingToolCalls: [],
        };
    }

    async *run(
        current: AgentProgramState,
        context: ProcessContext,
        signal?: ProcessSignal,
    ): AsyncGenerator<
        ProcessEvent,
        ProcessTransition<AgentProgramState, AgentProgramOutput>
    > {
        const state = structuredClone(current);
        try {
            const pending = yield* resumePending(state, context, signal);
            if (pending) {
                yield agentEvent(awaitSignal(pending.waitFor));
                return pending;
            }
            while (state.exchange < (state.maxExchanges ?? DEFAULT_MAX_EXCHANGES)) {
                state.exchange++;
                yield agentEvent(roundEvent('round:start', state));
                const result = yield* exchange(state, context);
                state.messages.push(result.message);
                state.usage = addUsage(state.usage, result.usage);
                yield agentEvent(roundEvent('round:end', state));
                if (!result.toolCalls.length) return completed(state, result.message);
                const waiting = waitTransition(state, result.toolCalls, context);
                if (waiting) {
                    yield agentEvent(awaitSignal(waiting.waitFor));
                    return waiting;
                }
                yield* runTools(state, result.toolCalls, context);
            }
            return failed('Agent exchange budget exhausted', 'BUDGET_EXHAUSTED');
        } catch (error) {
            const processError = serializeError(error);
            yield agentEvent({ type: 'error', error: processError });
            return { type: 'failed', error: processError };
        }
    }
}

async function* resumePending(
    state: AgentProgramState,
    context: ProcessContext,
    signal?: ProcessSignal,
): AsyncGenerator<
    ProcessEvent,
    Extract<ProcessTransition<AgentProgramState, AgentProgramOutput>, { type: 'waiting' }> | undefined
> {
    if (state.phase !== 'waiting') {
        if (signal?.type === 'inject') state.messages.push({ role: 'user', content: signal.text });
        return;
    }
    const calls = state.pendingToolCalls;
    const human = humanToolCall(calls);
    const requestId = human?.id ?? calls[0]?.id;
    if (signal?.type === 'inject') {
        yield applyInjection(state, calls, signal.text, requestId);
        return;
    }
    if (!requestId || !matchesRequest(signal, requestId)) {
        return waitTransition(state, calls, context);
    }
    if (human && signal?.type === 'respond') {
        state.messages.push(...humanResponse(calls, human.id, signal.response));
    } else if (approved(signal, requestId)) {
        yield* runTools(state, calls, context);
    } else {
        state.messages.push(...rejectedToolMessages(calls, 'Tool execution was not authorized'));
    }
    finishWaiting(state);
    yield agentEvent({ type: 'signal_resolved', requestId: calls[0]?.id ?? 'signal' });
}

function applyInjection(
    state: AgentProgramState,
    calls: ToolCall[],
    text: string,
    requestId?: string,
): ProcessEvent {
    state.messages.push(...rejectedToolMessages(calls, 'Cancelled by user adjustment'));
    state.messages.push({ role: 'user', content: text });
    finishWaiting(state);
    return agentEvent({ type: 'signal_resolved', requestId: requestId ?? 'signal' });
}

function finishWaiting(state: AgentProgramState): void {
    state.phase = 'ready';
    state.pendingToolCalls = [];
}

async function* runTools(
    state: AgentProgramState,
    calls: ToolCall[],
    context: ProcessContext,
): AsyncGenerator<ProcessEvent> {
    const result = await executeTools(calls, context, state.workingDirectory);
    for (const event of result.events) yield event;
    state.messages.push(...result.messages);
}

function waitTransition(
    state: AgentProgramState,
    calls: ToolCall[],
    context: ProcessContext,
): Extract<ProcessTransition<AgentProgramState, AgentProgramOutput>, { type: 'waiting' }> | undefined {
    const human = humanToolCall(calls);
    const external = state.approval === 'all'
        || (
            state.approval === 'external'
            && calls.some(call =>
                context.resources.tools.getToolMeta(toolName(call))?.sideEffect === 'external'
            )
        );
    if (!human && !external) return undefined;
    state.phase = 'waiting';
    state.pendingToolCalls = calls;
    const args = human ? toolArguments(human) : {};
    return {
        type: 'waiting',
        state,
        waitFor: {
            type: 'human-signal',
            requestId: human?.id ?? calls[0].id,
            prompt: String(args.question ?? 'Authorize tool execution?'),
            schema: human ? { options: args.options } : { type: 'boolean' },
            conversational: Boolean(human),
        },
    };
}

function completed(
    state: AgentProgramState,
    message: import('@itookit/common').ChatMessage,
): ProcessTransition<AgentProgramState, AgentProgramOutput> {
    return {
        type: 'completed',
        output: { message, usage: state.usage, exchanges: state.exchange },
    };
}

function humanResponse(calls: ToolCall[], id: string, response: unknown) {
    return calls.map(call => ({
        role: 'tool' as const,
        tool_call_id: call.id,
        content: call.id === id ? String(response ?? '') : 'Skipped while waiting for human input',
    }));
}

function approved(signal: ProcessSignal | undefined, requestId: string): boolean {
    if (!matchesRequest(signal, requestId)) return false;
    return signal.type === 'authorize'
        ? signal.approved
        : signal.type === 'respond' && signal.response === true;
}

function matchesRequest(
    signal: ProcessSignal | undefined,
    requestId: string,
): signal is Extract<ProcessSignal, { type: 'respond' | 'authorize' }> {
    return (signal?.type === 'respond' || signal?.type === 'authorize')
        && signal.requestId === requestId;
}

function awaitSignal(
    waitFor: import('@itookit/common').WaitCondition,
) {
    if (waitFor.type !== 'human-signal') {
        throw new Error(`Unsupported agent wait condition: ${waitFor.type}`);
    }
    return {
        type: 'await_signal' as const,
        request: {
            requestId: waitFor.requestId,
            reason: waitFor.conversational ? 'request_input' : 'hitl_confirm',
            message: waitFor.prompt,
        },
    };
}

function roundEvent(
    type: 'round:start' | 'round:end',
    state: AgentProgramState,
) {
    return {
        type,
        roundId: `${state.roundId}:${state.exchange}`,
        sessionId: state.sessionId,
        round: state.exchange,
    };
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
    return {
        prompt_tokens: number(left.prompt_tokens) + number(right.prompt_tokens),
        completion_tokens: number(left.completion_tokens) + number(right.completion_tokens),
        total_tokens: number(left.total_tokens) + number(right.total_tokens),
    };
}

function number(value: unknown): number {
    return typeof value === 'number' ? value : 0;
}

function failed(message: string, code: string) {
    return { type: 'failed' as const, error: { message, code } };
}

function agentEvent(event: import('@itookit/common').AgentEvent): ProcessEvent {
    return { type: 'agent-event', event };
}

function validate(input: AgentProgramInput): void {
    if (!input.sessionId || !input.roundId || !input.connectionId) {
        throw new Error('AgentProgram requires sessionId, roundId and connectionId');
    }
    if (!input.messages.length) throw new Error('AgentProgram requires messages');
}

function serializeError(error: unknown) {
    if (error instanceof Error) {
        return { message: error.message, code: error.name, stack: error.stack };
    }
    return { message: String(error) };
}
