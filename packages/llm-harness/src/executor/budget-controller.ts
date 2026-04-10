// @file: llm-harness/src/executor/budget-controller.ts
// 六维预算控制器实现。

import type { IBudgetController, AgentBudgetLimits, AgentUsageSnapshot } from '@itookit/common';
import { BudgetExhaustedError } from '@itookit/common';
import type { TokenUsage } from '@itookit/common';

const WARN_THRESHOLD = 0.8;

type DimKey = 'turns' | 'inputTokens' | 'outputTokens' | 'costUsd' | 'durationMs' | 'toolCalls';

interface CostModel {
    perInputToken: number;
    perOutputToken: number;
}

export class BudgetController implements IBudgetController {
    private readonly cost: CostModel;

    constructor(
        private readonly limits: AgentBudgetLimits,
        cost?: Partial<CostModel>,
    ) {
        this.cost = {
            perInputToken: cost?.perInputToken ?? 0.000003,
            perOutputToken: cost?.perOutputToken ?? 0.000015,
        };
    }

    createSnapshot(): AgentUsageSnapshot {
        return {
            turns: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            elapsedMs: 0,
            toolCalls: 0,
            startTime: Date.now(),
        };
    }

    updateUsage(snapshot: AgentUsageSnapshot, tokenUsage: TokenUsage, toolCallCount: number): void {
        const input = (tokenUsage as Record<string, unknown>)['prompt_tokens'] as number ?? 0;
        const output = (tokenUsage as Record<string, unknown>)['completion_tokens'] as number ?? 0;
        snapshot.turns += 1;
        snapshot.inputTokens += input;
        snapshot.outputTokens += output;
        snapshot.costUsd += input * this.cost.perInputToken + output * this.cost.perOutputToken;
        snapshot.elapsedMs = Date.now() - snapshot.startTime;
        snapshot.toolCalls += toolCallCount;
    }

    checkOrThrow(snapshot: AgentUsageSnapshot): void {
        const dims = this.getDims(snapshot);
        for (const [key, { used, limit }] of Object.entries(dims)) {
            if (limit > 0 && used >= limit) {
                throw new BudgetExhaustedError(key, used, limit);
            }
        }
    }

    getUsedRatios(snapshot: AgentUsageSnapshot): Record<string, number> {
        const dims = this.getDims(snapshot);
        return Object.fromEntries(
            Object.entries(dims).map(([k, { used, limit }]) => [
                k,
                limit > 0 ? Math.min(1, used / limit) : 0,
            ]),
        );
    }

    getMostConstrainedResource(snapshot: AgentUsageSnapshot): { resource: string; usedRatio: number } {
        const ratios = this.getUsedRatios(snapshot);
        let max = { resource: 'turns', usedRatio: 0 };
        for (const [resource, usedRatio] of Object.entries(ratios)) {
            if (usedRatio > max.usedRatio) max = { resource, usedRatio };
        }
        return max;
    }

    getApproachingLimits(snapshot: AgentUsageSnapshot, threshold = WARN_THRESHOLD): string[] {
        const ratios = this.getUsedRatios(snapshot);
        return Object.entries(ratios)
            .filter(([, r]) => r >= threshold)
            .map(([k]) => k);
    }

    getLimits(): AgentBudgetLimits {
        return { ...this.limits };
    }

    private getDims(snapshot: AgentUsageSnapshot): Record<DimKey, { used: number; limit: number }> {
        const elapsed = Date.now() - snapshot.startTime;
        return {
            turns:        { used: snapshot.turns,        limit: this.limits.maxTurns },
            inputTokens:  { used: snapshot.inputTokens,  limit: this.limits.maxInputTokens },
            outputTokens: { used: snapshot.outputTokens, limit: this.limits.maxOutputTokens },
            costUsd:      { used: snapshot.costUsd,      limit: this.limits.maxCostUsd },
            durationMs:   { used: elapsed,               limit: this.limits.maxDurationMs },
            toolCalls:    { used: snapshot.toolCalls,    limit: this.limits.maxToolCalls },
        };
    }
}
