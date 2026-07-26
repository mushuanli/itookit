import type {
    ChatMessage,
    ProcessContext,
    ProcessEvent,
    TokenUsage,
    ToolCall,
    ToolDefinition,
} from '@itookit/common';
import type {
    AgentExchangeResult,
    AgentProgramState,
} from './agent-types';

export async function* exchange(
    state: AgentProgramState,
    context: ProcessContext,
): AsyncGenerator<ProcessEvent, AgentExchangeResult> {
    const content: string[] = [];
    const thinking: string[] = [];
    const toolCalls = new Map<string, ToolCall>();
    let usage: TokenUsage = {};
    const stream = context.resources.llm.chatStream(
        state.connectionId,
        request(state, context, allowedTools(context)),
    );
    for await (const chunk of stream) {
        assertRunning(context);
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
            content.push(delta.content);
            yield event({ type: 'stream:content', delta: delta.content });
        }
        if (delta?.thinking) {
            thinking.push(delta.thinking);
            yield event({ type: 'stream:thinking', delta: delta.thinking });
        }
        mergeToolCalls(toolCalls, delta?.tool_calls ?? []);
        usage = chunk.usage ?? usage;
    }
    return result(content, thinking, [...toolCalls.values()], usage);
}

function request(
    state: AgentProgramState,
    context: ProcessContext,
    tools: ToolDefinition[],
) {
    return {
        messages: state.messages,
        model: state.model,
        temperature: state.temperature,
        maxTokens: state.maxTokens,
        thinking: state.thinking,
        reasoningEffort: state.reasoningEffort,
        tools,
        toolChoice: tools.length ? 'auto' as const : 'none' as const,
        signal: context.abortSignal,
    };
}

function allowedTools(context: ProcessContext): ToolDefinition[] {
    const allowed = new Set(context.capabilities.ids);
    return context.resources.tools.getToolDefinitions().filter(definition => {
        const name = definition.function?.name ?? definition.name;
        return Boolean(name && allowed.has(name));
    });
}

function mergeToolCalls(
    calls: Map<string, ToolCall>,
    deltas: Partial<ToolCall>[],
): void {
    for (const delta of deltas) mergeToolCall(calls, delta);
}

function mergeToolCall(calls: Map<string, ToolCall>, delta: Partial<ToolCall>): void {
    const id = delta.id ?? `tool-${delta.index ?? calls.size}`;
    const current = calls.get(id);
    const name = delta.function?.name ?? current?.function?.name ?? delta.name ?? '';
    const args = `${current?.function?.arguments ?? ''}${delta.function?.arguments ?? ''}`;
    calls.set(id, {
        id,
        index: delta.index ?? current?.index,
        type: delta.type ?? current?.type ?? 'function',
        function: { name, arguments: args },
    });
}

function result(
    content: string[],
    thinking: string[],
    toolCalls: ToolCall[],
    usage: TokenUsage,
): AgentExchangeResult {
    const message: ChatMessage = {
        role: 'assistant',
        content: content.join(''),
        ...(thinking.length ? { thinking: thinking.join('') } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
    return { message, toolCalls, usage };
}

function assertRunning(context: ProcessContext): void {
    if (!context.abortSignal.aborted) return;
    const error = new Error('Process cancelled');
    error.name = 'AbortError';
    throw error;
}

function event(agentEvent: import('@itookit/common').AgentEvent): ProcessEvent {
    return { type: 'agent-event', event: agentEvent };
}
