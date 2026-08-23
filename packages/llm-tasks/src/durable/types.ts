import type {
    ChatMessage,
    TokenUsage,
    ToolCall,
    ToolDefinition,
} from '@itookit/common';
import type { JsonValue } from '@itookit/durable-kernel';

export interface DurableDependencyBinding {
    taskId: string;
    input: string;
    output?: string;
    edgeId?: string;
}

export interface DurableProgramInput {
    sessionId: string;
    roundId: string;
    messages: ChatMessage[];
    connectionId: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    thinking?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'xhigh';
    /** stream !== false → LLM streams (default); false → non-streaming fallback. */
    stream?: boolean;
    /** 走底层内置 server-side search（如 DeepSeek/OpenAI Responses 的 web_search、Gemini 的 googleSearch）。 */
    webSearch?: boolean;
    dependencyBindings?: DurableDependencyBinding[];
}

export interface DurableAgentInput extends DurableProgramInput {
    maxExchanges?: number;
    workingDirectory?: string;
    approval?: 'none' | 'external' | 'all';
    tools?: ToolDefinition[];
    externalToolIds?: string[];
}

export interface DurableCapabilitySignal {
    llmHandleId: string;
    toolHandleId?: string;
}

export interface DurableChatOutput {
    message: ChatMessage;
    usage: TokenUsage;
    finishReason?: string | null;
}

export interface DurableAgentOutput extends DurableChatOutput {
    exchanges: number;
}

export interface DurableAgentState {
    input: DurableAgentInput;
    phase: 'collecting' | 'llm' | 'approval' | 'tool' | 'human';
    messages: ChatMessage[];
    dependencyOutputs: Record<string, JsonValue>;
    resolvedDependencyIds: string[];
    capabilities?: DurableCapabilitySignal;
    usage: TokenUsage;
    exchanges: number;
    pendingCalls: ToolCall[];
    callIndex: number;
}
