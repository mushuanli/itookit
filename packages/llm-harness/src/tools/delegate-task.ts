// @file: llm-harness/src/tools/delegate-task.ts
// delegate_task tool — spawns a sub-agent with a fresh context window.
//
// Handler factory captures a live ISubAgentRouter instance,
// wired up at harness creation time.

import type { ToolMeta, ToolDefinition, ToolHandler, ToolExecutionContext, ISubAgentRouter } from '@itookit/common';

export const delegateTaskMeta: ToolMeta = {
    id: 'delegate_task',
    name: 'Delegate Task',
    description: 'Delegate a research or analysis task to a sub-agent with a fresh context window',
    sideEffect: 'none',
    timeoutMs: 120_000,
    type: 'builtin',
    enabled: true,
    tags: ['agent', 'delegation'],
};

export const delegateTaskDefinition: ToolDefinition = {
    name: 'delegate_task',
    description:
        'Delegate a focused task to a sub-agent. ' +
        'Use when the task requires extensive file searches or multi-file analysis that would ' +
        'pollute the main context window. The sub-agent runs in isolation and returns a concise summary.',
    parameters: {
        type: 'object',
        properties: {
            instruction: {
                type: 'string',
                description: 'Self-contained task instruction for the sub-agent (do not reference prior context)',
            },
            allowed_tools: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tool IDs the sub-agent may use (default: file_read, glob_search, grep_search)',
            },
            response_format: {
                type: 'string',
                description: 'Expected response format hint (e.g. "file paths with line numbers")',
            },
            max_turns: {
                type: 'number',
                description: 'Maximum turns for the sub-agent (default: 10)',
            },
        },
        required: ['instruction'],
    },
};

/** Returns a ToolHandler that delegates tasks via the provided ISubAgentRouter. */
export function createDelegateTaskHandler(router: ISubAgentRouter): ToolHandler {
    return async (args, ctx: ToolExecutionContext) => {
        const result = await router.delegate({
            instruction: args['instruction'] as string,
            allowedTools: args['allowed_tools'] as string[] | undefined,
            responseFormat: args['response_format'] as string | undefined,
            maxTurns: args['max_turns'] as number | undefined,
            cwd: ctx.cwd,
        });
        if (!result.success) {
            return `Sub-agent failed (${result.error ?? 'unknown'}).\nPartial findings:\n${result.summary}`;
        }
        return result.summary;
    };
}
