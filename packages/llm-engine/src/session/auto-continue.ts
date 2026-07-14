// @file: llm-engine/session/auto-continue.ts

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
 * 自动续写结果
 */
export interface ContinueDecision {
    shouldContinue: boolean;
    reason?: string;
    continuationCount: number;
}
