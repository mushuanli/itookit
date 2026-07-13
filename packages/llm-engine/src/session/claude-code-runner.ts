// @file: llm-engine/session/claude-code-runner.ts
//
// ClaudeCodeStrategy — 内置 Agent Loop 主框架，实现 IAgentLoopStrategy。
//
// 设计要点：
//   - 完整实现 [LLM流式调用 → content block解析 → 工具执行 → messages拼接 → 循环]
//   - thinking signature 链自动维护（前轮 thinking 块原样回传，Anthropic 要求）
//   - 通过 OrchestratorEvent 向 llm-ui 暴露 content block 粒度事件
//   - 用户可通过 AbortSignal 随时中断

import type { ChatCompletionParams, MessageContentPart, ILLMService } from '@itookit/common';
import type { OrchestratorEvent } from '../core/types';
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

interface ThinkingBlock {
    type: 'thinking';
    thinking: string;
    signature: string;
}

interface TextBlock {
    type: 'text';
    text: string;
}

interface ToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
    inputRaw: string;
}

type ContentBlock = ThinkingBlock | TextBlock | ToolUseBlock;

// ─── ClaudeCodeStrategy ────────────────────────────────────────────────────────

export class ClaudeCodeStrategy implements IAgentLoopStrategy {
    constructor(
        private readonly llmService: ILLMService,
        private readonly toolExecutor: IToolExecutor = nullToolExecutor,
    ) {}

    async run(request: AgentLoopRequest, ctx: AgentLoopContext): Promise<AgentLoopResult> {
        const { maxTurns = 50, signal, messages: initialMessages, llmParams, connectionId } = request;
        const { nodeId, sessionId, onEvent } = ctx;

        const messages = [...initialMessages];
        const turns: TurnRecord[] = [];
        const startMs = Date.now();
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;

        for (let turn = 0; turn < maxTurns; turn++) {
            this.checkAbort(signal);
            onEvent({ type: 'turn:start', payload: { sessionId, turn } });

            const { assistantBlocks, usage } = await this.callLLM(
                messages, llmParams, signal, onEvent, nodeId, connectionId,
            );

            totalInput  += usage?.inputTokens  ?? 0;
            totalOutput += usage?.outputTokens ?? 0;
            totalCacheRead += usage?.cacheReadTokens ?? 0;
            onEvent({ type: 'turn:end', payload: { sessionId, turn } });

            const toolUses = assistantBlocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
            const turnRecord: TurnRecord = {
                turn,
                assistantBlocks: assistantBlocks.map(b => this.toAssistantBlock(b)),
                toolResults: [],
                usage,
            };

            if (toolUses.length > 0) {
                for (const tool of toolUses) {
                    onEvent({ type: 'tool:running', payload: { nodeId, toolId: tool.id } });
                    try {
                        const result = await this.execTool(tool, signal);
                        turnRecord.toolResults.push({ toolUseId: tool.id, content: result, isError: false });
                        onEvent({ type: 'tool:success', payload: { nodeId, toolId: tool.id, result } });
                    } catch (e: any) {
                        const errMsg = e?.message ?? String(e);
                        turnRecord.toolResults.push({ toolUseId: tool.id, content: errMsg, isError: true });
                        onEvent({ type: 'tool:error', payload: { nodeId, toolId: tool.id, error: errMsg } });
                    }
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
                costUsd: 0,
                contextUsageRatio: 0,
                turns: turns.length,
                durationMs: Date.now() - startMs,
                isEstimated: false,
            },
        };
    }

    // ─── 单轮 LLM 流式调用 ────────────────────────────────────────────────────────

    private async callLLM(
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
                    cacheReadTokens: (chunk.usage as any).prompt_cache_hit_tokens ?? (chunk.usage as any).cache_read_input_tokens,
                };
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            const finishReason = choice.finish_reason;

            // thinking delta
            if (delta?.thinking) {
                if (currentType !== 'thinking') {
                    currentType = 'thinking';
                    thinkingBuf = '';
                    thinkingSig = '';
                    onEvent({ type: 'stream:thinking:start', payload: { nodeId } });
                }
                thinkingBuf += delta.thinking;
                onEvent({ type: 'node_update', payload: { nodeId, chunk: delta.thinking, field: 'thought' } });
            }

            // text delta
            if (delta?.content) {
                if (currentType === 'thinking') {
                    assistantBlocks.push({ type: 'thinking', thinking: thinkingBuf, signature: thinkingSig });
                    onEvent({ type: 'stream:thinking:stop', payload: { nodeId, signature: thinkingSig } });
                    currentType = null;
                }
                if (currentType !== 'text') {
                    currentType = 'text';
                    textBuf = '';
                    onEvent({ type: 'stream:content:start', payload: { nodeId } });
                }
                textBuf += delta.content;
                onEvent({ type: 'node_update', payload: { nodeId, chunk: delta.content, field: 'output' } });
            }

            // tool_use delta
            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (tc.id && tc.function?.name) {
                        if (currentType === 'text') {
                            assistantBlocks.push({ type: 'text', text: textBuf });
                            onEvent({ type: 'stream:content:stop', payload: { nodeId } });
                            currentType = null;
                        }
                        if (currentType === 'thinking') {
                            assistantBlocks.push({ type: 'thinking', thinking: thinkingBuf, signature: thinkingSig });
                            onEvent({ type: 'stream:thinking:stop', payload: { nodeId, signature: thinkingSig } });
                            currentType = null;
                        }
                        currentType = 'tool_use';
                        toolId = tc.id;
                        toolName = tc.function.name;
                        toolInputBuf = tc.function.arguments ?? '';
                        onEvent({ type: 'tool:queued', payload: { nodeId, name: toolName, toolId } });
                    } else if (tc.function?.arguments) {
                        toolInputBuf += tc.function.arguments;
                        onEvent({ type: 'tool:input', payload: { nodeId, toolId, chunk: tc.function.arguments } });
                    }
                }
            }

            // finish_reason
            if (finishReason === 'tool_calls' || finishReason === 'tool_use') {
                if (currentType === 'tool_use') {
                    assistantBlocks.push(this.commitToolUse(toolId, toolName, toolInputBuf));
                    currentType = null;
                }
            } else if (finishReason === 'stop' || finishReason === 'end_turn') {
                if (currentType === 'thinking') {
                    assistantBlocks.push({ type: 'thinking', thinking: thinkingBuf, signature: thinkingSig });
                    onEvent({ type: 'stream:thinking:stop', payload: { nodeId, signature: thinkingSig } });
                }
                if (currentType === 'text') {
                    assistantBlocks.push({ type: 'text', text: textBuf });
                    onEvent({ type: 'stream:content:stop', payload: { nodeId } });
                }
                currentType = null;
            }
        }

        // 流结束兜底
        if (currentType === 'thinking' && thinkingBuf) {
            assistantBlocks.push({ type: 'thinking', thinking: thinkingBuf, signature: thinkingSig });
            onEvent({ type: 'stream:thinking:stop', payload: { nodeId, signature: thinkingSig } });
        }
        if (currentType === 'text' && textBuf) {
            assistantBlocks.push({ type: 'text', text: textBuf });
            onEvent({ type: 'stream:content:stop', payload: { nodeId } });
        }
        if (currentType === 'tool_use' && toolName) {
            assistantBlocks.push(this.commitToolUse(toolId, toolName, toolInputBuf));
        }

        return { assistantBlocks, usage };
    }

    // ─── 辅助 ─────────────────────────────────────────────────────────────────────

    private commitToolUse(id: string, name: string, inputRaw: string): ToolUseBlock {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(inputRaw || '{}'); } catch {}
        return { type: 'tool_use', id, name, input, inputRaw };
    }

    private async execTool(tool: ToolUseBlock, signal?: AbortSignal): Promise<string> {
        this.checkAbort(signal);
        const result = await this.toolExecutor.execute(tool.name, tool.input);
        this.checkAbort(signal);
        return result;
    }

    /** ContentBlock → Anthropic Messages API 格式（用于回传） */
    private blockToApi(block: ContentBlock): MessageContentPart {
        switch (block.type) {
            case 'thinking': return { type: 'thinking', thinking: block.thinking, signature: block.signature };
            case 'text':     return { type: 'text', text: block.text };
            case 'tool_use': return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        }
    }

    /** ContentBlock → TurnRecord.AssistantBlock（公共接口类型） */
    private toAssistantBlock(block: ContentBlock): TurnRecord['assistantBlocks'][number] {
        return block.type === 'thinking'
            ? { type: 'thinking', thinking: block.thinking, signature: block.signature }
            : block.type === 'text'
            ? { type: 'text', text: block.text }
            : { type: 'tool_use', toolUseId: block.id, toolName: block.name,
                toolInput: block.input, toolInputRaw: block.inputRaw };
    }

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

export type { IToolExecutor, TurnRecord };
