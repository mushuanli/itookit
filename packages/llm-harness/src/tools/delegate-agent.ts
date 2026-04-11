// @file: llm-harness/src/tools/delegate-agent.ts
// Delegates a task to a specific registered AgentDefinition (by ID).
//
// Unlike delegate_task (which runs a generic sub-agent), delegate_agent uses
// the target agent's systemPrompt, model, and connection configuration.

import type {
    ToolDefinition,
    ToolMeta,
    ISubAgentRouter,
    IAgentLookup,
} from '@itookit/common';

export const delegateAgentMeta: ToolMeta = {
    id: 'delegate_agent',
    name: 'delegate_agent',
    description: 'Delegate a task to a specific registered agent by ID, using its full configuration',
    sideEffect: 'local',
    timeoutMs: 300_000,
    type: 'builtin',
    enabled: true,
};

export const delegateAgentDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: 'delegate_agent',
        description:
            'Delegate a task to a specific registered agent (by agent_id). ' +
            'The agent runs with its configured system prompt, model, and connection. ' +
            'Use this when you need a specialist agent for a specific task.',
        parameters: {
            type: 'object',
            properties: {
                agent_id: {
                    type: 'string',
                    description: 'ID of the registered AgentDefinition to delegate to',
                },
                instruction: {
                    type: 'string',
                    description: 'Task instruction for the agent (clear and self-contained)',
                },
                max_turns: {
                    type: 'number',
                    description: 'Maximum execution turns (default: 15)',
                },
            },
            required: ['agent_id', 'instruction'],
        },
    },
};

export function createDelegateAgentHandler(
    router: ISubAgentRouter,
    agentLookup: IAgentLookup,
): (args: Record<string, unknown>) => Promise<string> {
    return async (args) => {
        const agentId  = String(args['agent_id'] ?? '');
        const instruction = String(args['instruction'] ?? '');
        const maxTurns = typeof args['max_turns'] === 'number' ? args['max_turns'] : 15;

        if (!agentId) return 'Error: agent_id is required';
        if (!instruction) return 'Error: instruction is required';

        const agentDef = await agentLookup.getAgentConfig(agentId);
        if (!agentDef) return `Error: agent "${agentId}" not found`;

        const result = await router.delegate({
            instruction,
            systemPrompt: agentDef.config.systemPrompt,
            connectionId: agentDef.config.connectionId || undefined,
            modelName:    agentDef.config.modelName || undefined,
            maxTurns,
            allowedTools: ['file_read', 'glob_search', 'grep_search', 'file_write', 'write_result'],
        });

        if (!result.success) {
            return `Agent "${agentDef.name}" failed: ${result.error ?? result.summary}`;
        }
        return result.summary;
    };
}
