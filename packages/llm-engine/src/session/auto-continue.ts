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
    /** 最大续写次数，默认 5 */
    maxContinuations: number;
    /** 续写提示词 */
    continuePrompt: string;
    /** 仅对 high confidence 截断自动续写，默认 true */
    highConfidenceOnly: boolean;
    /** 单次续写最大等待时间（ms），超时则停止，默认 30s */
    continuationTimeout: number;
}

/** LLM 输出此标记表示内容已完整，无需续写 */
export const COMPLETION_MARKER = '<|COMPLETE|>';

/** 匹配标记的正则（允许前后有空白） */
const COMPLETION_MARKER_REGEX = /\s*<\|COMPLETE\|>\s*$/;

/**
 * 默认续写提示词
 *
 * 设计要点：
 * - 明确要求不重复已输出内容
 * - 要求在内容完整时输出特殊标记
 * - 标记放在末尾，不影响正文渲染
 * - 措辞简洁，减少 token 消耗
 */
const DEFAULT_CONTINUE_PROMPT = [
    'Continue from where you left off. Do not repeat any content already written.',
    '',
    'If your response is now complete and nothing more needs to be added,',
    `output exactly: ${COMPLETION_MARKER}`,
    'Otherwise, simply continue writing the remaining content.',
].join('\n');

export const DEFAULT_AUTO_CONTINUE: AutoContinueConfig = {
    enabled: true,
    maxContinuations: ENGINE_DEFAULTS.AUTO_CONTINUE_MAX,
    continuePrompt: DEFAULT_CONTINUE_PROMPT,
    highConfidenceOnly: true,
    continuationTimeout: 30_000,  // ← 补上缺失的默认值
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
 * - 判断是否需要续写
 * - 追踪续写次数
 * - 构建续写请求的历史上下文
 * 
 * 不负责：
 * - 实际的 LLM 调用（由 TaskRunner 执行）
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
     */
    evaluate(
        content: string,
        finishReason?: string
    ): ContinueDecision {
        if (!this.config.enabled) {
            return {
                shouldContinue: false,
                continuationCount: this.continuationCount,
            };
        }

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

        // ✅ 新增：检测 LLM 自判断的完成标记
        if (this.hasCompletionMarker(content)) {
            log.info('LLM signaled completion via marker', {
                count: this.continuationCount,
            });
            return {
                shouldContinue: false,
                reason: 'completion_marker',
                continuationCount: this.continuationCount,
            };
        }

        // 结构 + finish_reason 检测
        const detection = this.detector.detect(content, finishReason);

        if (!detection.truncated) {
            return {
                shouldContinue: false,
                continuationCount: this.continuationCount,
            };
        }

        // 仅 high confidence 时自动续写？
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
     * 从最终输出中剥离完成标记
     *
     * 在任务结束后调用，确保持久化和 UI 展示的内容不含标记。
     */
    static stripCompletionMarker(content: string): string {
        return content.replace(COMPLETION_MARKER_REGEX, '').trimEnd();
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

    // ============================================
    // 内部
    // ============================================

    /**
     * 检测内容末尾是否包含完成标记
     */
    private hasCompletionMarker(content: string): boolean {
        return COMPLETION_MARKER_REGEX.test(content);
    }
}
