// @file: llm-session/src/persistence/projection.ts
// Shared Round → UI projection helpers for tool invocations. Keeps the
// `assistantBlocks` + `toolResults` persistence shape (RoundResult) and the
// ExecutionNode tree shape (tool children) in one place.

import type { RoundResult } from '@itookit/common';
import type { ExecutionNode } from '../core/types';
import type { RoundProjection, ToolCallProjection } from './round-types';

/** Rebuild the flat tool-call list from a persisted RoundResult. */
export function toolCallsFromResult(result: RoundResult | undefined): ToolCallProjection[] {
    if (!result) return [];
    const toolResults = result.toolResults ?? [];
    return (result.assistantBlocks ?? [])
        .filter(block => block.type === 'tool_use')
        .map(block => {
            const id = String(block.toolUseId ?? block.id ?? '');
            const match = toolResults.find(item => item.toolUseId === id);
            return {
                toolId: id,
                name: String(block.name ?? ''),
                input: isRecord(block.input) ? block.input : undefined,
                result: match?.content,
                isError: match?.isError,
            };
        });
}

/** Build tool ExecutionNode children for an assistant message projection. */
export function buildToolChildren(projection: RoundProjection): ExecutionNode[] {
    const assistant = projection.assistantMessage;
    if (!assistant?.toolCalls?.length) return [];
    return assistant.toolCalls.map((call, index) => ({
        id: call.toolId || `tool-${projection.roundId}-${index}`,
        parentId: assistant.persistedNodeId,
        executorId: call.name,
        executorType: 'tool',
        name: call.name,
        status: call.isError ? 'failed' : 'success',
        startTime: projection.createdAt,
        data: {
            input: call.input,
            output: call.result ?? '',
            toolCall: { name: call.name, args: call.input, result: call.result },
        },
        children: [],
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
