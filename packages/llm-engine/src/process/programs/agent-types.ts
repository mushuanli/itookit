import type {
    ChatMessage,
    ProcessEvent,
    TokenUsage,
    ToolCall,
} from '@itookit/common';

export interface AgentProgramInput {
    sessionId: string;
    roundId: string;
    messages: ChatMessage[];
    connectionId: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    thinking?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'xhigh';
    maxExchanges?: number;
    workingDirectory?: string;
    approval?: 'none' | 'external' | 'all';
}

export interface AgentProgramState extends AgentProgramInput {
    phase: 'ready' | 'waiting';
    exchange: number;
    usage: TokenUsage;
    pendingToolCalls: ToolCall[];
}

export interface AgentProgramOutput {
    message: ChatMessage;
    usage: TokenUsage;
    exchanges: number;
}

export interface AgentExchangeResult {
    message: ChatMessage;
    toolCalls: ToolCall[];
    usage: TokenUsage;
}

export interface ToolExecutionResult {
    messages: ChatMessage[];
    events: ProcessEvent[];
}
