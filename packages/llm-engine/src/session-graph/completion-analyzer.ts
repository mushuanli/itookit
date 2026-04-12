// @file: llm-engine/session-graph/completion-analyzer.ts
// Advance-mode completion analysis: asks the LLM whether a session's
// output actually satisfied its task goal.
//
// Used only when SessionMeta.type === 'advance'. For 'standard' mode,
// completion is assumed as soon as the agent finishes without error.

import type { ILLMService } from '@itookit/common';
import type { CompletionVerdict } from './types';

const DEFAULT_ADVANCE_PROMPT = `You are a strict task verifier. Given the task description and the agent's output, determine whether the task was successfully completed.

Reply with a JSON object ONLY (no markdown, no explanation outside the JSON):
{ "completed": true/false, "reason": "one sentence explanation" }

If the output clearly accomplishes what the task asked for, return completed=true.
If the task was only partially done, failed, or the output is off-topic, return completed=false.`;

export class CompletionAnalyzer {
    constructor(private readonly llm: ILLMService) {}

    /**
     * Ask the LLM whether the task was truly completed.
     * @param connectionId  LLM connection to use
     * @param taskPrompt    The original task description (session file content)
     * @param agentOutput   The agent's final response
     * @param customPrompt  Optional override for the system prompt
     */
    async analyze(
        connectionId: string,
        taskPrompt: string,
        agentOutput: string,
        customPrompt?: string,
    ): Promise<CompletionVerdict> {
        const systemPrompt = customPrompt ?? DEFAULT_ADVANCE_PROMPT;
        const userMessage  = `TASK:\n${taskPrompt.slice(0, 3000)}\n\nAGENT OUTPUT:\n${agentOutput.slice(0, 6000)}`;

        try {
            const resp = await this.llm.chat(connectionId, {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userMessage },
                ],
                maxTokens: 256,
            });
            const raw = resp.choices[0]?.message.content ?? '';
            // Extract JSON from response (handle potential markdown wrapping)
            const jsonMatch = raw.match(/\{[\s\S]*?\}/);
            if (!jsonMatch) return { completed: false, reason: 'LLM returned non-JSON response' };
            const verdict = JSON.parse(jsonMatch[0]) as CompletionVerdict;
            return { completed: !!verdict.completed, reason: verdict.reason ?? '' };
        } catch (err: unknown) {
            return { completed: false, reason: `Analysis failed: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
}
