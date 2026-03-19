// @file: llm-engine/session/auto-continue.ts

import { TruncationDetector } from './truncation-detector';
import { ENGINE_DEFAULTS } from '../core/constants';
import { log } from '../utils/logger';

/**
 * 自动续写配置
 */
export interface AutoContinueConfig {
    /** 是否启用，默认 true */
    enabled: boolean;
    /** 最大续写次数 */
    maxContinuations: number;
    /** 续写提示词 */
    continuePrompt: string;
    /** 仅对 high confidence 截断自动续写，默认 true */
    highConfidenceOnly: boolean;
    /** 单次续写最大等待时间（ms），默认 30s */
    continuationTimeout: number;
    /**
     * 累积输出的最大字符数
     *
     * 超过此长度后停止续写，防止超出模型 context window。
     * 设为 0 表示不限制。
     */
    maxAccumulatedChars: number;
}

/**
 * 续写提示词
 *
 * 简洁明确，不引入任何特殊标记。
 * LLM 写完后会自然返回 finish_reason='stop'，这是最可靠的完成信号。
 */
const DEFAULT_CONTINUE_PROMPT =
    'Continue from where you left off. Do not repeat any content already written.';

export const DEFAULT_AUTO_CONTINUE: AutoContinueConfig = {
    enabled: true,
    maxContinuations: ENGINE_DEFAULTS.AUTO_CONTINUE_MAX,
    continuePrompt: DEFAULT_CONTINUE_PROMPT,
    highConfidenceOnly: true,
    continuationTimeout: 30_000,
    maxAccumulatedChars: 120_000,
};

/**
 * 自动续写结果
 */
export interface ContinueDecision {
    shouldContinue: boolean;
    reason?: string;
    continuationCount: number;
}

/**
 * 自动续写处理器
 *
 * 职责：
 * - 判断是否需要续写（finish_reason + Markdown 结构检测）
 * - 追踪续写次数
 * - 提供续写提示词
 * - 累积输出长度保护
 *
 * 判定信号优先级：
 * 1. finish_reason='stop'   → 不续写（API 确认完成，最可靠）
 * 2. finish_reason='length'  → 续写（API 确认截断，最可靠）
 * 3. Markdown 结构不封闭     → 续写（代码块/数学块/HTML 未关闭）
 * 4. 其他                    → 不续写（宁可漏检不误检）
 *
 * 不负责：
 * - 实际的 LLM 调用（由 TaskRunner 执行）
 * - 历史构建（由 TaskRunner 管理）
 * - 事件分发（透明拼接到同一节点）
 *
 * 每个任务创建独立实例，避免并发任务间状态污染。
 */
export class AutoContinueHandler {
    private detector = new TruncationDetector();
    private continuationCount = 0;
    private config: AutoContinueConfig;

    constructor(config?: Partial<AutoContinueConfig>) {
        this.config = { ...DEFAULT_AUTO_CONTINUE, ...config };
    }

    /**
     * 判断是否应该自动续写
     *
     * 判定优先级（短路求值）：
     * 1. 禁用 → 不续写
     * 2. 达到最大次数 → 不续写
     * 3. 累积输出过长 → 不续写（防止 context overflow）
     * 4. finish_reason='stop' → 不续写（API 确认完成）
     * 5. finish_reason='length' → 续写（API 确认截断）
     * 6. Markdown 结构不封闭 → 续写（highConfidenceOnly 时仅 high）
     * 7. 其他 → 不续写
     */
    evaluate(
        content: string,
        finishReason?: string
    ): ContinueDecision {
        // 1. 禁用检查
        if (!this.config.enabled) {
            return {
                shouldContinue: false,
                continuationCount: this.continuationCount,
            };
        }

        // 2. 次数限制
        if (this.continuationCount >= this.config.maxContinuations) {
            log.info('Auto-continue limit reached', {
                count: this.continuationCount,
                max: this.config.maxContinuations,
            });
            return {
                shouldContinue: false,
                reason: 'max_continuations_reached',
                continuationCount: this.continuationCount,
            };
        }

        // 3. 累积长度保护
        if (this.config.maxAccumulatedChars > 0 &&
            content.length >= this.config.maxAccumulatedChars) {
            log.warn('Accumulated output too large, stopping auto-continue', {
                contentLength: content.length,
                maxChars: this.config.maxAccumulatedChars,
                estimatedTokens: Math.ceil(content.length / 3),
            });
            return {
                shouldContinue: false,
                reason: 'output_too_large',
                continuationCount: this.continuationCount,
            };
        }

        // 4-6. TruncationDetector 综合判断（finish_reason + 结构检测）
        const detection = this.detector.detect(content, finishReason);

        if (!detection.truncated) {
            return {
                shouldContinue: false,
                continuationCount: this.continuationCount,
            };
        }

        // 仅 high confidence 时自动续写
        if (this.config.highConfidenceOnly && detection.confidence !== 'high') {
            log.debug('Truncation detected but confidence too low', {
                confidence: detection.confidence,
                reason: detection.reason,
            });
            return {
                shouldContinue: false,
                reason: `low_confidence: ${detection.reason}`,
                continuationCount: this.continuationCount,
            };
        }

        log.info('Auto-continue triggered', {
            reason: detection.reason,
            confidence: detection.confidence,
            count: this.continuationCount + 1,
        });

        return {
            shouldContinue: true,
            reason: detection.reason,
            continuationCount: this.continuationCount,
        };
    }

    /**
     * 递增续写计数（在实际执行 continue 时调用）
     */
    incrementCount(): void {
        this.continuationCount++;
    }

    /**
     * 获取续写提示词
     */
    getContinuePrompt(): string {
        return this.config.continuePrompt;
    }

    /**
     * 重置状态
     */
    reset(): void {
        this.continuationCount = 0;
    }

    /**
     * 获取当前状态
     */
    getStatus(): { count: number; max: number; enabled: boolean } {
        return {
            count: this.continuationCount,
            max: this.config.maxContinuations,
            enabled: this.config.enabled,
        };
    }
}
