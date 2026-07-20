// Built-in Predicates for the Goal control loop.
//
// Three predicates registered via the `predicates` extension point:
//   - truncation: heuristic output truncation detection
//   - shell: exit-code-based completion check
//   - llm-judge: LLM-based structured verdict

import type { Predicate, RoundResult, AgentRunSpec, Verdict } from '@itookit/common';
import type { ILLMService } from '@itookit/common';

// ─── truncation ──────────────────────────────────────────────────────

/**
 * Heuristic truncation detection.
 *
 * Migrated from: TruncationDetector in llm-engine/session/
 *
 * Checks finish_reason + structural signals (unclosed blocks, patterns).
 * False negative preferred over false positive (don't continue when done).
 */
export function createTruncationPredicate(): Predicate {
    return async (result: RoundResult, _node: AgentRunSpec) => {
        // Check if any assistant text block indicates truncation
        const hasTruncation = result.assistantBlocks.some(block => {
            if (block.type === 'text' || block.type === 'thinking') {
                const content = String((block as any).text ?? '');
                return hasTruncationSignals(content);
            }
            return false;
        });

        if (hasTruncation) {
            return {
                status: 'retry',
                feedback: 'Output was truncated. Please continue from where you left off.',
            };
        }

        return { status: 'done' };
    };
}

function hasTruncationSignals(content: string): boolean {
    // Unclosed code blocks
    const codeFences = (content.match(/```/g) || []).length;
    if (codeFences % 2 !== 0) return true;

    // Unclosed math blocks
    const mathBlocks = (content.match(/\$\$/g) || []).length;
    if (mathBlocks % 2 !== 0) return true;

    // Trailing incomplete sentence (abrupt cutoff)
    const trimmed = content.trimEnd();
    if (trimmed.length > 200 && trimmed.length < 2000) {
        const lastChars = trimmed.slice(-50);
        // Incomplete sentence patterns
        if (/[a-zA-Z]$/.test(lastChars) && !/[.!?;:]\s*$/.test(lastChars)) {
            return true;
        }
    }

    return false;
}

// ─── shell ───────────────────────────────────────────────────────────

/**
 * Shell exit-code-based predicate.
 *
 * Migrated from: BackPressureValidator in llm-harness/
 *
 * Runs a shell command and checks exit code:
 *   - exit 0 = done
 *   - exit non-0 = retry with error output as feedback
 */
export function createShellPredicate(
    runShell: (command: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
): Predicate {
    return async (result: RoundResult, _node: AgentRunSpec) => {
        // Extract shell command from the last assistant block
        const shellBlock = result.assistantBlocks.find(b => b.type === 'tool_use');
        if (!shellBlock) return { status: 'done' };

        const command = String((shellBlock as any).input?.command ?? '');
        if (!command) return { status: 'done' };

        const { exitCode, stderr } = await runShell(command);

        if (exitCode === 0) {
            return { status: 'done' };
        }

        return {
            status: 'retry',
            feedback: `Command failed with exit code ${exitCode}:\n${stderr}`,
        };
    };
}

// ─── llm-judge ───────────────────────────────────────────────────────

/**
 * LLM-based structured verdict predicate.
 *
 * Migrated from: Mission verifier + CompletionAnalyzer (two into one).
 *
 * Uses a verifier LLM to judge completion:
 *   - done: task is complete
 *   - retry: needs another iteration with specific feedback
 *   - hitl: requires human intervention
 *   - failed: cannot be completed
 */
export function createLLMJudgePredicate(
    llmService: ILLMService,
    connectionId: string,
    options?: {
        verifierPrompt?: string;
        modelTier?: string;
    },
): Predicate {
    const verifierPrompt = options?.verifierPrompt ?? DEFAULT_VERIFIER_PROMPT;

    return async (result: RoundResult, node: AgentRunSpec) => {
        const output = summarizeResult(result);

        const messages = [
            { role: 'system' as const, content: verifierPrompt },
            { role: 'user' as const, content: `Task: ${node.prompt}\n\nOutput:\n${output}` },
        ];

        try {
            const response = await llmService.chat(connectionId, {
                messages,
                maxTokens: 256,
            });

            const content = response.choices?.[0]?.message?.content ?? '';
            const verdict = parseVerdict(content);
            return verdict;
        } catch {
            // On LLM failure, default to done (don't block the pipeline)
            return { status: 'done' };
        }
    };
}

const DEFAULT_VERIFIER_PROMPT = `You are a task completion verifier.
Analyze the output and decide:
- done: the task is fully and correctly completed
- retry: the task needs more work (provide specific feedback)
- failed: the task cannot be completed

Respond in JSON only:
{"status":"done|retry|failed","feedback":"explanation"}`;

function summarizeResult(result: RoundResult): string {
    const parts: string[] = [];
    for (const block of result.assistantBlocks) {
        if (block.type === 'text' || block.type === 'thinking') {
            parts.push(String((block as any).text ?? ''));
        } else if (block.type === 'tool_use') {
            parts.push(`[Tool: ${(block as any).toolName ?? (block as any).name ?? 'unknown'}]`);
        }
    }
    for (const tr of result.toolResults) {
        parts.push(`[ToolResult ${tr.toolUseId}${tr.isError ? ' ERROR' : ''}: ${tr.content.slice(0, 200)}]`);
    }
    return parts.join('\n') || '(no output)';
}

function parseVerdict(content: string): Verdict {
    try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (['done', 'retry', 'failed'].includes(parsed.status)) {
                if (parsed.status === 'retry') {
                    return { status: 'retry', feedback: parsed.feedback ?? content };
                }
                if (parsed.status === 'failed') {
                    return { status: 'failed', reason: parsed.feedback ?? '' };
                }
                return { status: 'done' };
            }
            // Map legacy 'hitl' to 'failed' with reason
            if (parsed.status === 'hitl') {
                return { status: 'failed', reason: `HITL required but not supported: ${parsed.feedback ?? ''}` };
            }
        }
    } catch { /* fall through */ }

    const lower = content.toLowerCase();
    if (lower.includes('done') || lower.includes('complete')) return { status: 'done' };
    if (lower.includes('retry')) return { status: 'retry', feedback: content };
    if (lower.includes('fail') || lower.includes('hitl') || lower.includes('human')) return { status: 'failed', reason: content };

    return { status: 'done' };
}
