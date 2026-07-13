// @file: llm-engine/mission/lite-sub-agent-router.ts
//
// LiteSubAgentRouter — 基于 UnifiedLoopStrategy 的轻量级 ISubAgentRouter 实现。
//
// 替代 llm-harness 的 SubAgentRouter，使 Mission 系统不再依赖 harness。
// 子代理使用独立的 UnifiedLoopStrategy 实例（最小配置），在隔离的上下文中执行。

import type { ISubAgentRouter, SubAgentTask, SubAgentResult, ChatMessage } from '@itookit/common';
import type { LLMKernelAdapter } from '../adapters/llmkernel-adapter';
import type { IToolExecutor } from '../session/agent-loop-strategy';
import { nullToolExecutor } from '../session/agent-loop-strategy';
import { UnifiedLoopStrategy } from '../session/unified-loop-strategy';

export class LiteSubAgentRouter implements ISubAgentRouter {
    private activeAbortController: AbortController | null = null;

    constructor(
        private readonly kernelAdapter: LLMKernelAdapter,
        private readonly toolExecutor: IToolExecutor = nullToolExecutor,
    ) {}

    async delegate(task: SubAgentTask): Promise<SubAgentResult> {
        this.activeAbortController = new AbortController();
        const signal = this.activeAbortController.signal;

        try {
            const systemPrompt = task.systemPrompt
                ?? 'You are a sub-agent. Complete the task precisely. Return a concise summary of your findings. Do NOT ask follow-up questions.';

            const messages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: task.instruction },
            ];

            // Build filtered tool executor if allowed tools specified
            const executor = task.allowedTools
                ? this.filterExecutor(task.allowedTools)
                : this.toolExecutor;

            const strategy = new UnifiedLoopStrategy(
                this.kernelAdapter,
                executor,
                { maxTurns: task.maxTurns ?? 10 },
            );

            const result = await strategy.run(
                {
                    messages,
                    llmParams: {
                        model: task.modelName,
                    },
                    connectionId: task.connectionId,
                    maxTurns: task.maxTurns ?? 10,
                    signal,
                },
                { nodeId: `subagent-${Date.now()}`, sessionId: '', onEvent: () => {} },
            );

            return {
                success: true,
                summary: result.output,
                turns: result.turns.length,
                tokenUsage: {
                    input: result.totalUsage.inputTokens,
                    output: result.totalUsage.outputTokens,
                },
            };
        } catch (e: any) {
            return {
                success: false,
                summary: '',
                turns: 0,
                tokenUsage: { input: 0, output: 0 },
                error: e?.message ?? String(e),
            };
        } finally {
            this.activeAbortController = null;
        }
    }

    abort(): void {
        this.activeAbortController?.abort();
    }

    private filterExecutor(allowedTools: string[]): IToolExecutor {
        const allowed = new Set(allowedTools);
        const inner = this.toolExecutor;
        return {
            execute: (name, input) => {
                if (!allowed.has(name)) {
                    throw new Error(`Tool "${name}" is not allowed for this sub-agent`);
                }
                return inner.execute(name, input);
            },
            getMeta: (name) => inner.getMeta?.(name),
        };
    }
}
