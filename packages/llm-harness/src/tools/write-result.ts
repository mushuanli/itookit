// @file: llm-harness/src/tools/write-result.ts
// Standardized mission result writer — enforces full + summary + journal structure.

import type { ToolDefinition, ToolMeta, IResultPersistenceService } from '@itookit/common';

export const writeResultMeta: ToolMeta = {
    id: 'write_result',
    name: 'write_result',
    description: 'Write task result to mission storage (full content + summary + journal entry)',
    sideEffect: 'local',
    timeoutMs: 30_000,
    type: 'builtin',
    enabled: true,
};

export const writeResultDefinition: ToolDefinition = {
    type: 'function',
    function: {
        name: 'write_result',
        description:
            'Persist your task output to mission storage. ' +
            'Writes full content and a concise summary, then appends a journal entry. ' +
            'Call this when you have completed your assigned task.',
        parameters: {
            type: 'object',
            properties: {
                mission_id: {
                    type: 'string',
                    description: 'Mission ID (provided in your task context)',
                },
                todo_id: {
                    type: 'string',
                    description: 'Todo ID of the task you completed',
                },
                full_content: {
                    type: 'string',
                    description: 'Complete output of your work (can be long)',
                },
                summary: {
                    type: 'string',
                    description: 'Concise summary (≤ 500 words) of what you accomplished and key findings',
                },
                journal_entry: {
                    type: 'string',
                    description: 'One-line status for the mission journal (≤ 120 chars)',
                },
            },
            required: ['mission_id', 'todo_id', 'full_content', 'summary', 'journal_entry'],
        },
    },
};

export function createWriteResultHandler(
    resultPersistence: IResultPersistenceService,
): (args: Record<string, unknown>) => Promise<string> {
    return async (args) => {
        const missionId    = String(args['mission_id']    ?? '');
        const todoId       = String(args['todo_id']       ?? '');
        const fullContent  = String(args['full_content']  ?? '');
        const summary      = String(args['summary']       ?? '');
        const journalEntry = String(args['journal_entry'] ?? '');

        if (!missionId || !todoId) return 'Error: mission_id and todo_id are required';

        const { resultPath, summaryPath } = await resultPersistence.saveResult(
            missionId, todoId, fullContent, summary,
        );
        await resultPersistence.appendJournal(missionId, journalEntry);

        return `Result saved. Full: ${resultPath} | Summary: ${summaryPath}`;
    };
}
