// @file: llm-harness/src/utils/tool-call.ts
// Shared helpers for normalising ToolCall across Anthropic and OpenAI formats.

import type { ToolCall } from '@itookit/common';

/** Extract tool name (handles both Anthropic `name` and OpenAI `function.name`). */
export function getToolName(call: ToolCall): string {
    return call.function?.name ?? call.name ?? '';
}

/** Extract tool arguments (Anthropic returns `input`, OpenAI returns JSON string). */
export function getToolArgs(call: ToolCall): Record<string, unknown> {
    if (call.input) return call.input;
    if (call.function?.arguments) {
        try { return JSON.parse(call.function.arguments) as Record<string, unknown>; }
        catch { return {}; }
    }
    return {};
}
