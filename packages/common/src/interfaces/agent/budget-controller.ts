// @file: common/interfaces/agent/budget-controller.ts
// 预算控制器接口定义。

import type { TokenUsage } from '../llm/completion';
import type { AgentBudgetLimits, AgentUsageSnapshot } from './agent-types';

/**
 * 预算控制器接口。
 *
 * 六维预算控制，在每轮循环开始前检查：
 *   - turns:        最大轮次
 *   - inputTokens:  输入 token 上限
 *   - outputTokens: 输出 token 上限
 *   - costUsd:      费用上限（USD）
 *   - durationMs:   执行时间上限
 *   - toolCalls:    工具调用次数上限
 *
 * 达到 80% 时发出 BudgetWarning 事件，达到 100% 时抛出 BudgetExhaustedError。
 */
export interface IBudgetController {
    /**
     * 创建一个空白的使用量快照（会话开始时调用）。
     */
    createSnapshot(): AgentUsageSnapshot;

    /**
     * 累加 LLM 响应的 token 使用量。
     *
     * @param snapshot      当前使用量快照（原地修改）
     * @param tokenUsage    LLM 返回的 token 统计
     * @param toolCallCount 本轮执行的工具调用次数
     */
    updateUsage(
        snapshot: AgentUsageSnapshot,
        tokenUsage: TokenUsage,
        toolCallCount: number,
    ): void;

    /**
     * 检查预算是否超限，超限则抛出 BudgetExhaustedError。
     *
     * @throws BudgetExhaustedError 任一维度达到 100% 时抛出
     */
    checkOrThrow(snapshot: AgentUsageSnapshot): void;

    /**
     * 获取各维度已用比例（0~1）。
     *
     * key 为维度名称（turns / inputTokens / outputTokens / costUsd / durationMs / toolCalls）
     */
    getUsedRatios(snapshot: AgentUsageSnapshot): Record<string, number>;

    /**
     * 获取当前最紧张的资源维度。
     *
     * 用于 BudgetWarning 事件的 payload。
     */
    getMostConstrainedResource(snapshot: AgentUsageSnapshot): {
        resource: string;
        usedRatio: number;
    };

    /**
     * 检查哪些维度已接近上限（达到 threshold 比例）。
     *
     * @param snapshot  当前使用量快照
     * @param threshold 触发警告的阈值，默认 0.8
     * @returns 超过阈值的维度名称列表
     */
    getApproachingLimits(snapshot: AgentUsageSnapshot, threshold?: number): string[];

    /** 获取当前预算限制配置 */
    getLimits(): AgentBudgetLimits;
}

/**
 * 预算耗尽错误。
 *
 * 由 IBudgetController.checkOrThrow() 抛出，
 * AgentLoopExecutor 捕获后将会话标记为 'partial'。
 */
export class BudgetExhaustedError extends Error {
    constructor(
        public readonly resource: string,
        public readonly used: number,
        public readonly limit: number,
    ) {
        super(`Budget exhausted: ${resource} (${used} / ${limit})`);
        this.name = 'BudgetExhaustedError';
    }
}
