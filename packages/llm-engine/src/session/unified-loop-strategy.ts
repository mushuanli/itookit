// @file: llm-engine/session/unified-loop-strategy.ts
//
// UnifiedLoopStrategy — 统一的 Agent Loop 实现，合并 ClaudeCodeStrategy 的流式能力
// 与 harness AgentLoopExecutor 的高级特性（预算、错误恢复、权限控制）。
//
// 设计原则：
//   - 流式优先 — 保留 content block 状态机解析（thinking / text / tool_use）
//   - 特性可配置 — 不传配置 = 功能关闭，行为等同于原 ClaudeCodeStrategy
//   - 轻量内联 — 预算和错误恢复直接内联实现，避免引入大型类依赖

import type { ChatCompletionParams, MessageContentPart, ILLMService } from '@itookit/common';
import type { OrchestratorEvent, SessionTokenUsage } from '../core/types';
import type {
    IAgentLoopStrategy,
    AgentLoopRequest,
    AgentLoopResult,
    AgentLoopContext,
    TurnRecord,
    IToolExecutor,
} from './agent-loop-strategy';
import { nullToolExecutor } from './agent-loop-strategy';

// ─── Content Block 内部类型 ────────────────────────────────────────────────────

interface ThinkingBlock { type: 'thinking'; thinking: string; signature: string; }
interface TextBlock { type: 'text'; text: string; }
interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; inputRaw: string; }
type ContentBlock = ThinkingBlock | TextBlock | ToolUseBlock;

// ─── 可配置特性 ────────────────────────────────────────────────────────────────

export interface BudgetConfig {
    maxTurns: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    maxCostUsd: number;
    maxDurationMs: number;
    /** Token→USD 费率 (per 1M tokens) */
    inputTokenPrice?: number;
    outputTokenPrice?: number;
}

export interface ErrorRecoveryConfig {
    /** Max retry count for rate-limited (429) errors */
    maxRetries: number;
    /** Base delay in ms for exponential backoff */
    baseRetryDelayMs: number;
    /** Max retries for truncated (finish_reason=length) responses */
    maxTruncationRetries: number;
}

export interface UnifiedLoopConfig {
    maxTurns?: number;                     // default 50
    budget?: Partial<BudgetConfig>;        // 不传 = 不检查
    errorRecovery?: Partial<ErrorRecoveryConfig>; // 不传 = 不重试
}

// ─── UnifiedLoopStrategy ───────────────────────────────────────────────────────

export class UnifiedLoopStrategy implements IAgentLoopStrategy {
    constructor(
        private readonly llmService: ILLMService,
        private readonly toolExecutor: IToolExecutor = nullToolExecutor,
        private readonly config: UnifiedLoopConfig = {},
    ) {}

    async run(request: AgentLoopRequest, ctx: AgentLoopContext): Promise<AgentLoopResult> {
        const maxTurns = this.config.maxTurns ?? request.maxTurns ?? 50;
        const { signal, messages: initialMessages, llmParams, connectionId } = request;
        const { nodeId, sessionId, onEvent } = ctx;

        const messages = [...initialMessages];
        const turns: TurnRecord[] = [];
        const startMs = Date.now();
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;
        let totalCost = 0;
        const budget = this.config.budget;
        const recovery = this.config.errorRecovery;

        for (let turn = 0; turn < maxTurns; turn++) {
            this.checkAbort(signal);

            // ── Budget check ──────────────────────────────────────────
            if (budget) {
                if (budget.maxTurns && turn >= budget.maxTurns) {
                    onEvent({ type: 'error', payload: { message: 'Budget exhausted: max turns reached', code: 'BUDGET_TURNS' } });
                    break;
                }
                if (budget.maxDurationMs && (Date.now() - startMs) >= budget.maxDurationMs) {
                    onEvent({ type: 'error', payload: { message: 'Budget exhausted: max duration reached', code: 'BUDGET_DURATION' } });
                    break;
                }
                if (budget.maxInputTokens && totalInput >= budget.maxInputTokens) {
                    onEvent({ type: 'error', payload: { message: 'Budget exhausted: max input tokens', code: 'BUDGET_INPUT_TOKENS' } });
                    break;
                }
                if (budget.maxOutputTokens && totalOutput >= budget.maxOutputTokens) {
                    onEvent({ type: 'error', payload: { message: 'Budget exhausted: max output tokens', code: 'BUDGET_OUTPUT_TOKENS' } });
                    break;
                }
                if (budget.maxCostUsd && totalCost >= budget.maxCostUsd) {
                    onEvent({ type: 'error', payload: { message: 'Budget exhausted: max cost exceeded', code: 'BUDGET_COST' } });
                    break;
                }
            }

            onEvent({ type: 'turn:start', payload: { sessionId, turn } });

            // ── LLM call with error recovery ──────────────────────────
            const { assistantBlocks, usage } = await this.callLLMWithRecovery(
                messages, llmParams, signal, onEvent, nodeId, recovery, connectionId,
            );

            if (usage) {
                totalInput  += usage.inputTokens ?? 0;
                totalOutput += usage.outputTokens ?? 0;
                totalCacheRead += usage.cacheReadTokens ?? 0;
                // Estimate cost
                if (budget?.inputTokenPrice) {
                    totalCost += (usage.inputTokens / 1_000_000) * budget.inputTokenPrice;
                    totalCost += (usage.outputTokens / 1_000_000) * (budget.outputTokenPrice ?? budget.inputTokenPrice);
                }
            }
            onEvent({ type: 'turn:end', payload: { sessionId, turn } });

            const toolUses = assistantBlocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
            const turnRecord: TurnRecord = {
                turn,
                assistantBlocks: assistantBlocks.map(b => this.toAssistantBlock(b)),
                toolResults: [],
                usage,
            };

            if (toolUses.length > 0) {
                // Permission gating: parallel reads, serial writes
                const readTools: ToolUseBlock[] = [];
                const writeTools: ToolUseBlock[] = [];
                for (const tool of toolUses) {
                    const meta = this.toolExecutor.getMeta?.(tool.name);
                    if (meta?.sideEffect === 'none') {
                        readTools.push(tool);
                    } else {
                        writeTools.push(tool);
                    }
                }

                // Execute reads in parallel
                const readResults = await Promise.allSettled(
                    readTools.map(t => this.execToolSafely(t, signal, onEvent, nodeId)),
                );
                for (const r of readResults) {
                    if (r.status === 'fulfilled') turnRecord.toolResults.push(r.value);
                    else turnRecord.toolResults.push({ toolUseId: 'unknown', content: String(r.reason), isError: true });
                }

                // Execute writes sequentially
                for (const tool of writeTools) {
                    const result = await this.execToolSafely(tool, signal, onEvent, nodeId);
                    turnRecord.toolResults.push(result);
                }

                messages.push({
                    role: 'assistant',
                    content: assistantBlocks.map(b => this.blockToApi(b)),
                });
                messages.push({
                    role: 'user',
                    content: turnRecord.toolResults.map(r => ({
                        type: 'tool_result' as const,
                        tool_use_id: r.toolUseId,
                        content: r.content,
                        ...(r.isError ? { is_error: true } : {}),
                    })),
                });

                turns.push(turnRecord);
                continue;
            }

            turns.push(turnRecord);
            break;
        }

        return {
            output: this.extractFinalText(turns),
            turns,
            totalUsage: {
                inputTokens: totalInput,
                outputTokens: totalOutput,
                cacheReadTokens: totalCacheRead > 0 ? totalCacheRead : undefined,
                costUsd: parseFloat(totalCost.toFixed(6)),
                contextUsageRatio: 0,
                turns: turns.length,
                durationMs: Date.now() - startMs,
                isEstimated: !budget?.inputTokenPrice,
            } satisfies SessionTokenUsage,
        };
    }

    // ─── LLM 流式调用 + 错误恢复 ────────────────────────────────────────────────

    private async callLLMWithRecovery(
        messages: ChatCompletionParams['messages'],
        llmParams: Omit<ChatCompletionParams, 'messages' | 'signal'>,
        signal: AbortSignal | undefined,
        onEvent: (e: OrchestratorEvent) => void,
        nodeId: string,
        recovery?: Partial<ErrorRecoveryConfig>,
        connectionId?: string,
    ): Promise<{ assistantBlocks: ContentBlock[]; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number } }> {
        const maxRetries = recovery?.maxRetries ?? 0;
        const maxTruncationRetries = recovery?.maxTruncationRetries ?? 0;
        const baseDelay = recovery?.baseRetryDelayMs ?? 1000;
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Truncation retry loop (nested)
                return await this.callLLMStreaming(
                    messages, llmParams, signal, onEvent, nodeId,
                    maxTruncationRetries, connectionId,
                );
            } catch (e: any) {
                lastError = e;
                const status = e?.status ?? e?.code;
                // Rate limit (429) — retry with backoff
                if (status === 429 && attempt < maxRetries) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                // Context overflow (413) — cannot recover without compression, stop retrying
                if (status === 413) break;
                // Other errors — stop retrying
                break;
            }
        }
        throw lastError ?? new Error('LLM call failed');
    }

    // ─── 单轮 LLM 流式调用（从原 ClaudeCodeStrategy 提取）────────────────────────

    private async callLLMStreaming(
        messages: ChatCompletionParams['messages'],
        llmParams: Omit<ChatCompletionParams, 'messages' | 'signal'>,
        signal: AbortSignal | undefined,
        onEvent: (e: OrchestratorEvent) => void,
        nodeId: string,
        maxTruncationRetries: number,
        connectionId?: string,
    ): Promise<{ assistantBlocks: ContentBlock[]; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number } }> {
        for (let truncRetry = 0; truncRetry <= maxTruncationRetries; truncRetry++) {
            const result = await this.streamOneCall(messages, llmParams, signal, onEvent, nodeId, connectionId);
            // If truncated, add continuation message and retry
            const hasToolUse = result.assistantBlocks.some(b => b.type === 'tool_use');
            const hasText = result.assistantBlocks.some(b => b.type === 'text');
            if (!hasToolUse && !hasText && truncRetry < maxTruncationRetries) {
                messages.push({ role: 'user', content: 'Please continue.' } as any);
                continue;
            }
            return result;
        }
        // Should not reach here; return last known result as fallback
        return { assistantBlocks: [], usage: undefined };
    }

    private async streamOneCall(
        messages: ChatCompletionParams['messages'],
        llmParams: Omit<ChatCompletionParams, 'messages' | 'signal'>,
        signal: AbortSignal | undefined,
        onEvent: (e: OrchestratorEvent) => void,
        nodeId: string,
        connectionId?: string,
    ): Promise<{ assistantBlocks: ContentBlock[]; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number } }> {
        const assistantBlocks: ContentBlock[] = [];
        let usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number } | undefined;

        let currentType: 'thinking' | 'text' | 'tool_use' | null = null;
        let thinkingBuf = '';
        let thinkingSig = '';
        let textBuf = '';
        let toolId = '';
        let toolName = '';
        let toolInputBuf = '';

        const params: ChatCompletionParams = { ...llmParams, messages, stream: true, signal };
        const stream = this.llmService.chatStream(connectionId ?? 'default', params);

        for await (const chunk of stream) {
            this.checkAbort(signal);

            if (chunk.usage) {
                usage = {
                    inputTokens: (chunk.usage as any).prompt_tokens ?? 0,
                    outputTokens: (chunk.usage as any).completion_tokens ?? 0,
                    cacheReadTokens: (chunk.usage as any).prompt_cache_hit_tokens
                        ?? (chunk.usage as any).cache_read_input_tokens,
                };
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            const finishReason = choice.finish_reason;

            if (delta?.thinking) {
                if (currentType !== 'thinking') {
                    currentType = 'thinking'; thinkingBuf = ''; thinkingSig = '';
                    onEvent({ type: 'stream:thinking:start', payload: { nodeId } });
                }
                thinkingBuf += delta.thinking;
                onEvent({ type: 'node_update', payload: { nodeId, chunk: delta.thinking, field: 'thought' } });
            }

            if (delta?.content) {
                if (currentType === 'thinking') {
                    assistantBlocks.push({ type: 'thinking', thinking: thinkingBuf, signature: thinkingSig });
                    onEvent({ type: 'stream:thinking:stop', payload: { nodeId, signature: thinkingSig } });
                }
                if (currentType !== 'text') {
                    if (currentType !== 'thinking') {
                        // from tool_use or null — start text
                    }
                    currentType = 'text'; textBuf = '';
                    onEvent({ type: 'stream:content:start', payload: { nodeId } });
                }
                textBuf += delta.content;
                onEvent({ type: 'node_update', payload: { nodeId, chunk: delta.content, field: 'output' } });
            }

            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (tc.id && tc.function?.name) {
                        this.commitCurrentBlock(assistantBlocks, currentType, thinkingBuf, thinkingSig, textBuf, onEvent, nodeId);
                        currentType = 'tool_use';
                        toolId = tc.id; toolName = tc.function.name;
                        toolInputBuf = tc.function.arguments ?? '';
                        onEvent({ type: 'tool:queued', payload: { nodeId, name: toolName, toolId } });
                    } else if (tc.function?.arguments) {
                        toolInputBuf += tc.function.arguments;
                        onEvent({ type: 'tool:input', payload: { nodeId, toolId, chunk: tc.function.arguments } });
                    }
                }
            }

            if (finishReason === 'tool_calls' || finishReason === 'tool_use') {
                if (currentType === 'tool_use') {
                    assistantBlocks.push(this.commitToolUse(toolId, toolName, toolInputBuf));
                    currentType = null;
                }
            } else if (finishReason === 'stop' || finishReason === 'end_turn') {
                this.commitCurrentBlock(assistantBlocks, currentType, thinkingBuf, thinkingSig, textBuf, onEvent, nodeId);
                currentType = null;
            }
        }

        // Stream end fallback
        this.commitCurrentBlock(assistantBlocks, currentType, thinkingBuf, thinkingSig, textBuf, onEvent, nodeId);
        if (currentType === 'tool_use' && toolName) {
            assistantBlocks.push(this.commitToolUse(toolId, toolName, toolInputBuf));
        }

        return { assistantBlocks, usage };
    }

    private commitCurrentBlock(
        blocks: ContentBlock[],
        currentType: string | null,
        thinkingBuf: string, thinkingSig: string, textBuf: string,
        onEvent: (e: OrchestratorEvent) => void,
        nodeId: string,
    ): void {
        if (currentType === 'thinking') {
            blocks.push({ type: 'thinking', thinking: thinkingBuf, signature: thinkingSig });
            onEvent({ type: 'stream:thinking:stop', payload: { nodeId, signature: thinkingSig } });
        }
        if (currentType === 'text') {
            blocks.push({ type: 'text', text: textBuf });
            onEvent({ type: 'stream:content:stop', payload: { nodeId } });
        }
    }

    // ─── 工具执行 ───────────────────────────────────────────────────────────────

    private async execToolSafely(
        tool: ToolUseBlock, signal: AbortSignal | undefined,
        onEvent: (e: OrchestratorEvent) => void, nodeId: string,
    ): Promise<TurnRecord['toolResults'][number]> {
        onEvent({ type: 'tool:running', payload: { nodeId, toolId: tool.id } });
        try {
            const result = await this.execTool(tool, signal);
            onEvent({ type: 'tool:success', payload: { nodeId, toolId: tool.id, result } });
            return { toolUseId: tool.id, content: result, isError: false };
        } catch (e: any) {
            const errMsg = e?.message ?? String(e);
            onEvent({ type: 'tool:error', payload: { nodeId, toolId: tool.id, error: errMsg } });
            return { toolUseId: tool.id, content: errMsg, isError: true };
        }
    }

    private async execTool(tool: ToolUseBlock, signal?: AbortSignal): Promise<string> {
        this.checkAbort(signal);
        const result = await this.toolExecutor.execute(tool.name, tool.input);
        this.checkAbort(signal);
        return result;
    }

    private commitToolUse(id: string, name: string, inputRaw: string): ToolUseBlock {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(inputRaw || '{}'); } catch {}
        return { type: 'tool_use', id, name, input, inputRaw };
    }

    // ─── 消息格式转换 ───────────────────────────────────────────────────────────

    private blockToApi(block: ContentBlock): MessageContentPart {
        switch (block.type) {
            case 'thinking': return { type: 'thinking', thinking: block.thinking, signature: block.signature };
            case 'text':     return { type: 'text', text: block.text };
            case 'tool_use': return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        }
    }

    private toAssistantBlock(block: ContentBlock): TurnRecord['assistantBlocks'][number] {
        return block.type === 'thinking'
            ? { type: 'thinking', thinking: block.thinking, signature: block.signature }
            : block.type === 'text'
            ? { type: 'text', text: block.text }
            : { type: 'tool_use', toolUseId: block.id, toolName: block.name,
                toolInput: block.input, toolInputRaw: block.inputRaw };
    }

    // ─── 辅助 ─────────────────────────────────────────────────────────────────────

    private checkAbort(signal?: AbortSignal): void {
        if (signal?.aborted) throw new DOMException('Agent Loop aborted', 'AbortError');
    }

    private extractFinalText(turns: TurnRecord[]): string {
        for (let i = turns.length - 1; i >= 0; i--) {
            for (let j = turns[i].assistantBlocks.length - 1; j >= 0; j--) {
                const b = turns[i].assistantBlocks[j];
                if (b.type === 'text' && b.text?.trim()) return b.text;
            }
        }
        return '';
    }
}
