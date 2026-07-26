import type {
    ChatMessage,
    ProcessContext,
    ProcessEvent,
    ToolCall,
    ToolInvokeResult,
} from '@itookit/common';
import type { ToolExecutionResult } from './agent-types';

export async function executeTools(
    calls: ToolCall[],
    context: ProcessContext,
    workingDirectory?: string,
): Promise<ToolExecutionResult> {
    const events = calls.flatMap(call => lifecycleEvents(call));
    const results = await context.resources.tools.invokeBatch(calls.map(call => ({
        toolId: toolName(call),
        args: toolArguments(call),
        cwd: workingDirectory,
        signal: context.abortSignal,
    })));
    return {
        messages: results.results.map((result, index) =>
            toolMessage(calls[index], result),
        ),
        events: [...events, ...completionEvents(calls, results.results)],
    };
}

export function rejectedToolMessages(
    calls: ToolCall[],
    reason: string,
): ChatMessage[] {
    return calls.map(call => ({
        role: 'tool',
        tool_call_id: call.id,
        content: reason,
    }));
}

export function humanToolCall(calls: ToolCall[]): ToolCall | undefined {
    return calls.find(call => toolName(call) === 'human_input');
}

export function toolArguments(call: ToolCall): Record<string, unknown> {
    try {
        return JSON.parse(call.function?.arguments ?? '{}') as Record<string, unknown>;
    } catch {
        return {};
    }
}

export function toolName(call: ToolCall): string {
    return call.function?.name ?? call.name ?? '';
}

function lifecycleEvents(call: ToolCall): ProcessEvent[] {
    const info = { toolId: call.id, name: toolName(call), input: toolArguments(call) };
    return [
        event({ type: 'tool:queued', call: info }),
        event({ type: 'tool:running', call: info }),
    ];
}

function completionEvents(
    calls: ToolCall[],
    results: ToolInvokeResult[],
): ProcessEvent[] {
    return results.map((result, index) => {
        const info = { toolId: calls[index].id, name: toolName(calls[index]) };
        return result.success
            ? event({ type: 'tool:success', call: { ...info, result: result.output } })
            : event({ type: 'tool:error', call: { ...info, error: result.error ?? result.output } });
    });
}

function toolMessage(call: ToolCall, result: ToolInvokeResult): ChatMessage {
    return {
        role: 'tool',
        tool_call_id: call.id,
        content: result.output,
    };
}

function event(agentEvent: import('@itookit/common').AgentEvent): ProcessEvent {
    return { type: 'agent-event', event: agentEvent };
}
