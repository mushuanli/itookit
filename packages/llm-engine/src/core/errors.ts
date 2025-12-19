// @file: llm-engine/src/core/errors.ts

/**
 * 错误码
 */
export enum EngineErrorCode {
    // 网络错误
    NETWORK_ERROR = 'NETWORK_ERROR',
    TIMEOUT = 'TIMEOUT',
    
    // 会话错误
    SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
    SESSION_BUSY = 'SESSION_BUSY',
    SESSION_INVALID = 'SESSION_INVALID',
    
    // 执行错误
    EXECUTION_FAILED = 'EXECUTION_FAILED',
    EXECUTOR_NOT_FOUND = 'EXECUTOR_NOT_FOUND',
    
    // 配额错误
    QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
    CONTEXT_LIMIT = 'CONTEXT_LIMIT',
    
    // 用户操作
    ABORTED = 'ABORTED',
    
    // 其他
    UNKNOWN = 'UNKNOWN'
}

/**
 * 引擎错误
 */
export class EngineError extends Error {
    constructor(
        public code: EngineErrorCode,
        message: string,
        public retryable: boolean = false,
        public originalError?: any
    ) {
        super(message);
        this.name = 'EngineError';
    }
    
    /**
     * 从任意错误创建 EngineError
     */
    static from(error: any): EngineError {
        if (error instanceof EngineError) {
            return error;
        }
        
        const message = error?.message || 'Unknown error';
        
        // 中止错误
        if (error?.name === 'AbortError' || message.includes('abort')) {
            return new EngineError(EngineErrorCode.ABORTED, 'Operation aborted', false, error);
        }
        
        // 超时错误
        if (message.includes('timeout') || error?.name === 'TimeoutError') {
            return new EngineError(EngineErrorCode.TIMEOUT, 'Request timed out', true, error);
        }
        
        // 速率限制
        if (message.includes('429') || message.includes('rate limit') || message.includes('quota')) {
            return new EngineError(EngineErrorCode.QUOTA_EXCEEDED, 'Rate limit exceeded', true, error);
        }
        
        // 上下文限制
        if (message.includes('context') || message.includes('token limit')) {
            return new EngineError(EngineErrorCode.CONTEXT_LIMIT, 'Context limit exceeded', false, error);
        }
        
        // 网络错误
        if (message.includes('network') || message.includes('fetch') || error?.name === 'TypeError') {
            return new EngineError(EngineErrorCode.NETWORK_ERROR, 'Network error', true, error);
        }
        
        return new EngineError(EngineErrorCode.UNKNOWN, message, true, error);
    }
    
    /**
     * 是否可重试
     */
    get canRetry(): boolean {
        return this.retryable;
    }
}
