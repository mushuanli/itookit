// @file: llm-engine/session/agent-loop-strategy.ts
//
// Agent Loop 策略接口 — 定义 Agent Loop 执行策略的调用约定。
//
// 关系：
//   UnifiedLoopStrategy — 内置主框架，通过 ILLMService 流式调用
//   HarnessStrategy       — 包装 llm-harness IAgentRuntime，向后兼容（已删除）

import type { ChatMessage, ChatCompletionParams } from '@itookit/common';
import type { SessionTokenUsage } from '../core/types';

// ─── TurnRecord ───────────────────────────────────────────────────────────────

export interface TurnRecord {
    turn: number;
    /** 模型返回的原始 content blocks（含 thinking / text / tool_use） */
    assistantBlocks: AssistantBlock[];
    /** 工具执行结果 */
    toolResults: ToolResult[];
    usage?: { inputTokens: number; outputTokens: number };
}

export interface AssistantBlock {
    type: 'thinking' | 'text' | 'tool_use';
    // thinking
    thinking?: string;
    signature?: string;
    // text
    text?: string;
    // tool_use
    toolUseId?: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolInputRaw?: string;
}

export interface ToolResult {
    toolUseId: string;
    content: string;
    isError: boolean;
}

// ─── Request / Result ─────────────────────────────────────────────────────────

export interface AgentLoopRequest {
    /** 初始 messages（含历史），Runner 会在循环中追加 */
    messages: ChatMessage[];
    /** 发往 LLM 的基础参数（model、tools、thinking 等），不含 messages/signal */
    llmParams: Omit<ChatCompletionParams, 'messages' | 'signal'>;
    /** 最大循环轮次，默认 50 */
    maxTurns: number;
    signal?: AbortSignal;
    /** LLM connection ID — forwarded to ILLMService.chatStream for provider selection */
    connectionId?: string;
}

export interface AgentLoopResult {
    /** 最终文本输出 */
    output: string;
    /** 每轮详情（ClaudeCodeStrategy 完整填充；HarnessStrategy 可能为空数组） */
    turns: TurnRecord[];
    totalUsage: SessionTokenUsage;
}

// ─── 策略接口 ─────────────────────────────────────────────────────────────────

export interface AgentLoopContext {
    nodeId: string;
    sessionId: string;
    onEvent: (event: { type: string; [key: string]: any }) => void;
}

/**
 * Agent Loop 执行策略接口。
 *
 * 实现：
 *   - ClaudeCodeStrategy — 内置主框架（claude-code-strategy.ts）
 *   - HarnessStrategy    — 包装 IAgentRuntime（harness-adapter.ts）
 */
export interface IAgentLoopStrategy {
    run(request: AgentLoopRequest, ctx: AgentLoopContext): Promise<AgentLoopResult>;
}

// ─── 工具执行器接口 ────────────────────────────────────────────────────────────

export interface IToolExecutor {
    execute(name: string, input: Record<string, unknown>): Promise<string>;
    /** Optional: return tool metadata for permission gating and parallel scheduling */
    getMeta?(name: string): { sideEffect: 'none' | 'local' | 'external' } | undefined;
}

/** 空实现：工具未配置时的 fallback */
export const nullToolExecutor: IToolExecutor = {
    execute: async (name: string) =>
        `[Tool "${name}" is not available in this session]`,
};
