import { DEFAULT_AGENT_MAX_EXCHANGES, type ChatMessage, type ToolCall, type ToolInvokeResult } from '@itookit/common';
import {
    interactionApproved,
    type Decision,
    type DurableTaskProgram,
    type JsonValue,
    type KernelAction,
    type TaskInputEvent,
} from '@itookit/durable-kernel';
import {
    CAPABILITY_SIGNAL,
    addUsage,
    applyDependencyMessages,
    assistantMessage,
    capabilitySignal,
    emit,
    llmEffect,
    response,
    responseEvents,
    roundEvent,
    toolArguments,
    toolCalls,
    toolEffect,
    toolName,
} from './program-helpers';
import { collectDependency, dependenciesReady, dependencyWait } from './dependency-collector';
import type {
    DurableAgentInput,
    DurableAgentOutput,
    DurableAgentState,
} from './types';

export class DurableAgentProgram implements DurableTaskProgram<DurableAgentState, DurableAgentInput, DurableAgentOutput> {
    readonly manifest = { kind: 'llm.agent', version: '1' };

    init(input: DurableAgentInput): Decision<DurableAgentState, DurableAgentOutput> {
        validate(input);
        return {
            state: initialState(input),
            next: { type: 'wait', on: { type: 'signal', id: CAPABILITY_SIGNAL } },
        };
    }

    reduce(
        current: Readonly<DurableAgentState>,
        event: TaskInputEvent,
    ): Decision<DurableAgentState, DurableAgentOutput> {
        const state = clone(current) as DurableAgentState;
        if (state.phase === 'collecting') return collect(state, event);
        if (state.phase === 'llm') return handleLlm(state, event);
        if (state.phase === 'tool') return handleTool(state, event);
        if (state.phase === 'approval' || state.phase === 'human') return handleInteraction(state, event);
        return fail(state, `Unsupported Agent phase: ${state.phase}`);
    }
}

function collect(state: DurableAgentState, event: TaskInputEvent): Decision<DurableAgentState, DurableAgentOutput> {
    collectDependency(state.input.dependencyBindings ?? [], state.dependencyOutputs, state.resolvedDependencyIds, event);
    const capabilities = capabilitySignal(event);
    if (capabilities) state.capabilities = capabilities;
    if (!state.capabilities || !dependenciesReady(state.input.dependencyBindings ?? [], state.resolvedDependencyIds)) {
        return { state, next: waitForInput(state) };
    }
    state.messages = applyDependencyMessages(state.input, state.dependencyOutputs);
    return requestLlm(state);
}

function requestLlm(state: DurableAgentState): Decision<DurableAgentState, DurableAgentOutput> {
    if (state.exchanges >= (state.input.maxExchanges ?? DEFAULT_AGENT_MAX_EXCHANGES)) {
        return fail(state, 'Agent exchange budget exhausted', 'BUDGET_EXHAUSTED');
    }
    state.exchanges++;
    state.phase = 'llm';
    return {
        state,
        actions: [
            emit(roundEvent('round:start', state.input, state.exchanges)),
            llmEffect(state.input, state.messages, state.capabilities!.llmHandleId, state.input.tools),
        ],
        next: { type: 'wait', on: { type: 'effect', id: `llm-${state.messages.length}` } },
    };
}

function handleLlm(state: DurableAgentState, event: TaskInputEvent): Decision<DurableAgentState, DurableAgentOutput> {
    if (event.type === 'effect-failed') return { state, next: { type: 'fail', error: event.error } };
    const value = response(event);
    const message = assistantMessage(value);
    state.messages.push(message);
    state.usage = addUsage(state.usage, value.usage);
    const calls = toolCalls(value);
    const actions = responseEvents(state.input, state.exchanges);
    if (!calls.length) return complete(state, message, value.choices[0].finish_reason, actions);
    // Subtask delegation: a subtask tool call declares sub-task payloads and
    // completes the node without executing the tool (fan-out happens upstream).
    const subtaskCall = state.input.subtaskTool
        ? calls.find(call => toolName(call) === state.input.subtaskTool)
        : undefined;
    if (subtaskCall) {
        const args = toolArguments(subtaskCall);
        const payload = Array.isArray(args.items) ? args.items : [];
        return complete(state, { ...message, content: JSON.stringify(payload) }, 'stop', actions);
    }
    state.pendingCalls = calls;
    state.callIndex = 0;
    return prepareCalls(state, actions);
}

function prepareCalls(
    state: DurableAgentState,
    actions: KernelAction[],
): Decision<DurableAgentState, DurableAgentOutput> {
    const human = state.pendingCalls.find(call => isHumanTool(toolName(call)));
    if (human) return requestInteraction(state, human, true, actions);
    if (requiresApproval(state)) return requestInteraction(state, state.pendingCalls[0], false, actions);
    return requestTool(state, actions);
}

function requestInteraction(
    state: DurableAgentState,
    call: ToolCall,
    human: boolean,
    actions: KernelAction[],
): Decision<DurableAgentState, DurableAgentOutput> {
    state.phase = human ? 'human' : 'approval';
    const args = toolArguments(call);
    actions.push({
        type: 'request-interaction',
        interaction: {
            id: call.id,
            kind: human ? 'input' : 'approval',
            prompt: interactionPrompt(args, human),
            payload: jsonValue(human
                ? { questions: args.questions ?? null, options: args.options ?? null }
                : { calls: state.pendingCalls.map(item => ({ tool: toolName(item), args: toolArguments(item) })) }),
        },
    });
    return { state, actions, next: { type: 'wait', on: { type: 'interaction', id: call.id } } };
}

function interactionPrompt(args: Record<string, unknown>, human: boolean): string {
    if (typeof args.question === 'string') return args.question;
    const questions = Array.isArray(args.questions) ? args.questions : [];
    const first = questions[0];
    if (first && typeof first === 'object' && typeof (first as { question?: unknown }).question === 'string') {
        return (first as { question: string }).question;
    }
    return human ? 'Please provide input.' : 'Authorize tool execution?';
}

function handleInteraction(
    state: DurableAgentState,
    event: TaskInputEvent,
): Decision<DurableAgentState, DurableAgentOutput> {
    if (event.type !== 'interaction-resolved') return fail(state, `Expected interaction, received ${event.type}`);
    if (state.phase === 'approval' && !interactionApproved(event.value)) {
        appendRejected(state, 'Tool execution was not authorized');
        state.phase = 'collecting';
        return requestLlm(state);
    }
    if (state.phase === 'human') {
        appendHumanResponse(state, event.value);
        state.phase = 'collecting';
        return requestLlm(state);
    }
    return requestTool(state, []);
}

function requestTool(
    state: DurableAgentState,
    actions: KernelAction[],
): Decision<DurableAgentState, DurableAgentOutput> {
    const call = state.pendingCalls[state.callIndex];
    const handle = state.capabilities?.toolHandleId;
    if (!call || !handle) return fail(state, 'Tool resource handle is required');
    state.phase = 'tool';
    actions.push(emit({ type: 'tool:running', call: callInfo(call) }));
    actions.push(toolEffect(state.input.roundId, call, handle, state.input.workingDirectory));
    return { state, actions, next: { type: 'wait', on: { type: 'effect', id: `tool-${call.id}` } } };
}

function handleTool(state: DurableAgentState, event: TaskInputEvent): Decision<DurableAgentState, DurableAgentOutput> {
    const call = state.pendingCalls[state.callIndex];
    if (!call) return fail(state, 'Pending tool call is missing');
    if (event.type === 'effect-failed') return { state, next: { type: 'fail', error: event.error } };
    if (event.type !== 'effect-completed') return fail(state, `Expected Tool Effect, received ${event.type}`);
    const result = event.result as ToolInvokeResult;
    state.messages.push({ role: 'tool', tool_call_id: call.id, content: result.output });
    const actions = [emit({ type: 'tool:success', call: { ...callInfo(call), result: result.output } })];
    state.callIndex++;
    if (state.callIndex < state.pendingCalls.length) return requestTool(state, actions);
    state.pendingCalls = [];
    state.phase = 'collecting';
    return withActions(requestLlm(state), actions);
}

function complete(
    state: DurableAgentState,
    message: ChatMessage,
    finishReason: string | null,
    actions: KernelAction[],
): Decision<DurableAgentState, DurableAgentOutput> {
    actions.push(emit({ type: 'finished', usage: state.usage }));
    return {
        state,
        actions,
        next: { type: 'complete', output: { message, usage: state.usage, finishReason, exchanges: state.exchanges } },
    };
}

function initialState(input: DurableAgentInput): DurableAgentState {
    return {
        input: clone(input), phase: 'collecting', messages: [], dependencyOutputs: {},
        resolvedDependencyIds: [],
        usage: {}, exchanges: 0, pendingCalls: [], callIndex: 0,
    };
}

function waitForInput(state: DurableAgentState): Decision<DurableAgentState, DurableAgentOutput>['next'] {
    if (!state.capabilities) return { type: 'wait', on: { type: 'signal', id: CAPABILITY_SIGNAL } };
    const bindings = state.input.dependencyBindings ?? [];
    return bindings.length ? dependencyWait(bindings) : { type: 'continue' };
}

function requiresApproval(state: DurableAgentState): boolean {
    if (state.input.approval === 'all') return true;
    const external = new Set(state.input.externalToolIds ?? []);
    return state.input.approval === 'external'
        && state.pendingCalls.some(call => external.has(toolName(call)));
}

function appendRejected(state: DurableAgentState, reason: string): void {
    state.messages.push(...state.pendingCalls.map(call => ({
        role: 'tool' as const, tool_call_id: call.id, content: reason,
    })));
    state.pendingCalls = [];
}

function appendHumanResponse(state: DurableAgentState, value: JsonValue): void {
    const human = state.pendingCalls.find(call => isHumanTool(toolName(call)));
    state.messages.push(...state.pendingCalls.map(call => ({
        role: 'tool' as const,
        tool_call_id: call.id,
        content: call.id === human?.id ? String(value ?? '') : 'Skipped while waiting for human input',
    })));
    state.pendingCalls = [];
}

function isHumanTool(name: string): boolean {
    return name === 'human_input' || name === 'AskUserQuestion';
}

function withActions(
    decision: Decision<DurableAgentState, DurableAgentOutput>,
    prefix: KernelAction[],
): Decision<DurableAgentState, DurableAgentOutput> {
    return { ...decision, actions: [...prefix, ...(decision.actions ?? [])] };
}

function fail(
    state: DurableAgentState,
    message: string,
    code?: string,
): Decision<DurableAgentState, DurableAgentOutput> {
    return { state, next: { type: 'fail', error: { message, code } } };
}

function callInfo(call: ToolCall) { return { toolId: call.id, name: toolName(call), input: toolArguments(call) }; }
function clone<T>(value: T): T { return structuredClone(value); }
function jsonValue(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value ?? null)) as JsonValue; }

function validate(input: DurableAgentInput): void {
    if (!input.sessionId || !input.roundId || !input.connectionId) {
        throw new Error('DurableAgentProgram requires sessionId, roundId and connectionId');
    }
    if (!input.messages.length) throw new Error('DurableAgentProgram requires messages');
}
