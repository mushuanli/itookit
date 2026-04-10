// @file: common/interfaces/agent/error-recovery.ts
// 错误恢复服务接口定义。

import type { ChatCompletionParams, ChatCompletionResponse } from '../llm/completion';

/**
 * 错误恢复服务接口。
 *
 * 封装五类 LLM API 错误的分级恢复策略，
 * 使 AgentLoopExecutor 的主循环逻辑保持简洁：
 *
 *   429 RateLimit      → 指数退避重试（最多 5 次）
 *   413 ContextLarge   → 强制上下文压缩后重试（最多 3 次）
 *   529 Overload       → 切换 fallback 连接（只切换一次）
 *   MaxTokens Truncate → 静默重试（最多 3 次）
 *   Tool Error         → 包装为 is_error=true 的结果喂回 LLM（不抛出）
 */
export interface IErrorRecoveryService {
    /**
     * 执行 LLM 调用，自动处理错误恢复。
     *
     * @param connectionId LLM 连接 ID
     * @param request      LLM 调用参数
     * @param options      恢复策略选项
     * @returns            成功的 LLM 响应
     * @throws             不可恢复错误（超过重试次数或未知错误）
     */
    callWithRecovery(
        connectionId: string,
        request: ChatCompletionParams,
        options: RecoveryOptions,
    ): Promise<ChatCompletionResponse>;

    /**
     * 获取当前实际使用的连接 ID。
     *
     * Fallback 切换后，此值与初始 connectionId 不同。
     */
    getCurrentConnectionId(): string;

    /**
     * 是否已切换到 fallback 连接。
     */
    isFallbackActive(): boolean;

    /**
     * 重置 fallback 状态（允许下次再次切换）。
     */
    resetFallback(): void;
}

/**
 * 错误恢复选项。
 */
export interface RecoveryOptions {
    /** 最大 API 重试次数（针对 429/maxTokens） @default 5 */
    maxRetries: number;
    /** 重试基础延迟（毫秒），指数退避从此值开始 @default 1000 */
    baseDelayMs: number;
    /** 最大截断重试次数（针对 maxTokens） @default 3 */
    maxTruncationRetries: number;
    /** 压缩回调：413 错误时，先调此函数压缩上下文，再重试 */
    onCompressionNeeded: () => Promise<void>;
    /** Fallback 连接 ID（529 Overload 时切换） */
    fallbackConnectionId?: string;
    /** 重试事件回调（用于发出 agent:llm:retry 事件） */
    onRetry?: (attempt: number, reason: string, delayMs: number) => void;
    /** Fallback 切换回调（用于发出 agent:llm:fallback 事件） */
    onFallback?: (from: string, to: string, reason: string) => void;
}
