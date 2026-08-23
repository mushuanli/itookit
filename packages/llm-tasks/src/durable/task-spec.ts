// @file: llm-runtime/src/durable/task-spec.ts
// LLM TaskSpec 构造：统一 llm.agent / llm.chat 的 input 装配。
// 消除 llm-conversation（directTaskSpec）与 builtin-plugins（agentTask）两处重复的
// compact({ sessionId/roundId/messages/model/... }) 模板。

import type { ChatMessage, ToolDefinition } from '@itookit/common';
import type {
    DurableAgentInput,
    DurableDependencyBinding,
    DurableProgramInput,
} from './types';

export interface LlmTaskInputOptions {
    sessionId: string;
    roundId: string;
    messages: ChatMessage[];
    connectionId?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    thinking?: boolean;
    reasoningEffort?: DurableProgramInput['reasoningEffort'];
    webSearch?: boolean;
    stream?: boolean;
    maxExchanges?: number;
    workingDirectory?: string;
    approval?: DurableAgentInput['approval'];
    tools?: ToolDefinition[];
    externalToolIds?: string[];
    dependencyBindings?: DurableDependencyBinding[];
}

/** 装配 llm.agent / llm.chat 的 program input（去掉 undefined 字段，补 connectionId/approval 默认）。 */
export function buildLlmTaskInput(options: LlmTaskInputOptions): DurableAgentInput {
    return omitUndefined({
        sessionId: options.sessionId,
        roundId: options.roundId,
        messages: options.messages,
        connectionId: options.connectionId ?? 'default',
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        thinking: options.thinking,
        reasoningEffort: options.reasoningEffort,
        webSearch: options.webSearch,
        stream: options.stream,
        maxExchanges: options.maxExchanges,
        workingDirectory: options.workingDirectory,
        approval: options.approval ?? 'external',
        tools: options.tools,
        externalToolIds: options.externalToolIds,
        dependencyBindings: options.dependencyBindings,
    });
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => item !== undefined),
    ) as T;
}
