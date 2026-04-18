// @file: llm-harness/src/executor/sub-agent-router.ts
// 子代理路由器实现（上下文防火墙）。

import type {
    ISubAgentRouter,
    SubAgentTask,
    SubAgentResult,
    ILLMService,
    IToolService,
    AgentModelRoles,
    ChatMessage,
    ToolCall,
    ToolDefinition,
} from '@itookit/common';
import { resolveModelForTier } from '@itookit/common';
import { getToolName, getToolArgs } from '../utils/tool-call';

const DEFAULT_MAX_TURNS = 10;
const READ_ONLY_TOOLS = ['file_read', 'glob_search', 'grep_search'];

export class SubAgentRouter implements ISubAgentRouter {
    private abortController: AbortController | null = null;

    constructor(
        private readonly llm: ILLMService,
        private readonly toolService: IToolService,
        private readonly modelRoles: AgentModelRoles,
    ) {}

    async delegate(task: SubAgentTask): Promise<SubAgentResult> {
        this.abortController = new AbortController();
        const { signal } = this.abortController;

        const connectionId = task.connectionId ?? this.modelRoles.subAgent ?? this.modelRoles.primary;
        // Resolve effective model: explicit modelName > tier lookup > connection default.
        let effectiveModelId: string | undefined = task.modelName;
        if (!effectiveModelId && task.modelTier) {
            const connMeta = await this.llm.getConnection(connectionId);
            if (connMeta) effectiveModelId = resolveModelForTier(connMeta, task.modelTier);
        }
        const allowedTools = task.allowedTools ?? READ_ONLY_TOOLS;
        const maxTurns = task.maxTurns ?? DEFAULT_MAX_TURNS;

        const toolDefs: ToolDefinition[] = this.toolService
            .getToolDefinitions()
            .filter((d: ToolDefinition) => {
                const name = d.function?.name ?? d.name ?? '';
                return allowedTools.includes(name);
            });

        // Build system prompt: prefer task override, fall back to default
        let systemContent = task.systemPrompt
            ?? ('You are a focused sub-agent. Complete the given task using the provided tools. ' +
                'When done, provide a concise summary of your findings.');
        if (task.responseFormat) systemContent += ` Response format: ${task.responseFormat}`;
        if (task.contextFiles && task.contextFiles.length > 0) {
            systemContent +=
                '\n\nReference files for context (read these if needed):\n' +
                task.contextFiles.map(f => `- ${f}`).join('\n');
        }

        const messages: ChatMessage[] = [
            { role: 'system', content: systemContent },
            { role: 'user', content: task.instruction },
        ];

        let turns = 0;
        let inputTokens = 0;
        let outputTokens = 0;

        try {
            while (turns < maxTurns) {
                if (signal.aborted) break;
                turns++;

                const response = await this.llm.chat(connectionId, { messages, tools: toolDefs, signal, model: effectiveModelId });
                const choice = response.choices[0];
                inputTokens += (response.usage as Record<string, unknown>)?.['prompt_tokens'] as number ?? 0;
                outputTokens += (response.usage as Record<string, unknown>)?.['completion_tokens'] as number ?? 0;

                const text = choice?.message.content ?? '';
                const toolCalls: ToolCall[] = choice?.message.tool_calls ?? [];

                messages.push({ role: 'assistant', content: text, tool_calls: toolCalls.length > 0 ? toolCalls : undefined });

                if (toolCalls.length === 0) {
                    return { success: true, summary: text, turns, tokenUsage: { input: inputTokens, output: outputTokens } };
                }

                for (const call of toolCalls) {
                    const name = getToolName(call);
                    if (!allowedTools.includes(name)) {
                        messages.push({ role: 'tool', content: 'Error: tool not allowed in sub-agent context', tool_call_id: call.id });
                        continue;
                    }
                    const result = await this.toolService.invoke({ toolId: name, args: getToolArgs(call), cwd: task.cwd ?? (typeof process !== 'undefined' ? process.cwd() : '/'), signal });
                    messages.push({ role: 'tool', content: result.output, tool_call_id: call.id });
                }
            }

            return {
                success: false,
                summary: 'Sub-agent reached max turns without completing',
                turns,
                tokenUsage: { input: inputTokens, output: outputTokens },
                error: 'max_turns_exceeded',
            };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, summary: '', turns, tokenUsage: { input: inputTokens, output: outputTokens }, error: msg };
        }
    }

    abort(): void {
        this.abortController?.abort();
    }
}
