// @file: llm-harness/src/tools/human-input.ts
// Pauses current task execution and queues a request for human input.
// Other non-blocked todos continue executing while the human decides.

import type { ToolDefinition, ToolMeta } from '@itookit/common';
import { generateUUID } from '@itookit/common';
import type { HITLQueue } from '../services/hitl-queue';

export const humanInputMeta: ToolMeta = {
    id: 'human_input',
    name: 'human_input',
    description: 'Request human input when a decision requires human judgement',
    sideEffect: 'none',
    timeoutMs: 86_400_000, // 24h — human may take time
    type: 'builtin',
    enabled: true,
};

export const humanInputDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: 'human_input',
        description:
            'Request human input when you cannot proceed without a decision that requires human judgement. ' +
            'Execution pauses until the human responds. Provide all context needed for an informed decision.',
        parameters: {
            type: 'object',
            properties: {
                mission_id: {
                    type: 'string',
                    description: 'Mission ID (provided in your task context)',
                },
                todo_id: {
                    type: 'string',
                    description: 'Todo ID of the blocked task',
                },
                context: {
                    type: 'string',
                    description: 'Full context: what has been done so far, what is known, why human input is needed',
                },
                question: {
                    type: 'string',
                    description: 'The specific question or decision required from the human',
                },
                options: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional quick-select choices for the human (shown as buttons in UI)',
                },
                files: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'VFS paths of relevant files for the human to review',
                },
            },
            required: ['mission_id', 'todo_id', 'context', 'question'],
        },
    },
};

export function createHumanInputHandler(
    hitlQueue: HITLQueue,
): (args: Record<string, unknown>) => Promise<string> {
    return async (args) => {
        const missionId = String(args['mission_id'] ?? '');
        const todoId    = String(args['todo_id']    ?? '');
        const context   = String(args['context']    ?? '');
        const question  = String(args['question']   ?? '');
        const options   = Array.isArray(args['options'])
            ? (args['options'] as unknown[]).map(String)
            : undefined;
        const files     = Array.isArray(args['files'])
            ? (args['files'] as unknown[]).map(String)
            : undefined;

        if (!missionId || !todoId) return 'Error: mission_id and todo_id are required';

        const response = await hitlQueue.push({
            id: generateUUID(),
            missionId,
            todoId,
            context,
            question,
            options,
            files,
            createdAt: Date.now(),
        });

        return response || '(no response provided)';
    };
}
